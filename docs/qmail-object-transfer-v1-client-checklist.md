# QMail Object Transfer v1: Client Checklist

Status: stable v1 wire protocol; wire and command execution layers implemented

This document maps the proposed QMail Object Transfer v1 protocol onto the
QMail GUI. It is not a wire-protocol specification. The authoritative protocol
artifacts are:

- `protocol/spec/qmail-object-transfer-v1.json`
- `protocol/spec/qmail-object-transfer-v1-vectors.json`
- `protocol/spec/qmail-object-transfer-v1-client-note.md`

They were frozen on June 11, 2026. Packet serializers must continue to match
every frozen vector byte-for-byte.

## Current Client Boundary

The GUI does not currently encode RAIDA QMail commands.

- `ComposeModal.jsx` stages local attachment paths.
- `qmailApiServices.sendEmail()` sends those paths to the local `rest_core`
  endpoint `/qmail/net/messages/upload_and_tell`.
- `rest_core` reads the files and performs the RAIDA upload.
- Incoming attachment downloads use
  `/qmail/db/attachments/get` and convert the complete response to a browser
  `Blob` before saving it.

Object Transfer v1 should therefore be implemented in two layers:

1. `rest_core` implements the RAIDA wire protocol, transfer persistence,
   hashing, capability enforcement, and resume state.
2. The GUI uses a versioned REST and Electron IPC contract exposed by
   `rest_core` and the Electron main process.

The GUI must not duplicate command numbers, binary packet layouts, payment
rules, or server storage policy.

## Client Invariants

- Do not hard-code a 1 MiB chunk size. Treat it only as an initial preference.
- Treat server-accepted limits as authoritative even when DRD data says
  otherwise.
- Represent object sizes and offsets as unsigned 64-bit values.
- Encode 64-bit values as decimal strings in JSON. JavaScript `Number` is not
  exact above `2^53 - 1`, and `JSON.stringify()` cannot serialize `BigInt`.
- Never load an entire large attachment into renderer memory.
- Never allocate memory based only on a remote or user-declared total size.
- Downloads must stream to a temporary file and become visible at the final
  destination only after successful verification.
- Upload retries must be idempotent. Progress counts unique acknowledged bytes,
  not attempted bytes.
- A transfer is complete only after the server accepts `UPLOAD_COMMIT`.
- Cancellation must stop new work and call abort when a transfer ID exists.
- Legacy upload/download remains available until Object Transfer v1 support is
  confirmed.

## Implementation Status

The first `rest_core` implementation slice now provides:

- typed request serializers and response parsers for commands 76 through 84
- the final 144-byte command 76 request layout
- symmetric 32-bit request and response framing
- TCP transport support for extended response lengths
- Object Transfer v1 status codes
- 72-byte Tell manifest v2 serialization
- byte-for-byte tests for every frozen request, response, error, and manifest
  vector
- typed command wrappers for commands 76 through 84
- execution through the existing TCP executor, encryption, challenge/CRC,
  transport, logging, telemetry, response decryption, and signature validation
- request-ID correlation and owned response buffers with non-owning typed data
  views
- request-specific pre-allocation response limits plus a 64 MiB process-wide
  transport ceiling
- per-RAIDA payment identity AN selection independent of transport encryption
- strict frozen-v1 reserved-field, flag, and exact-header validation
- reusable command results with explicit initialize/reset/free ownership
- raw SHA-256 digest support through the existing BCrypt/OpenSSL utility
- mock-transport integration tests for every typed command wrapper

Persistent transfer state, multi-server orchestration, capability caching,
REST endpoints, streaming file I/O, and GUI integration remain to be
implemented.

## Review Decisions

Manifest v1 remains permanently tied to the legacy 256 KiB page geometry.
Those entries do not contain page size, so recompiling them with a different
constant would silently reinterpret stored attachments. Object Transfer v1 and
manifest v2 use negotiated byte ranges independently of that legacy constant.

The command result owns the complete decrypted response body. Typed response
data pointers are non-owning views into that buffer. Callers initialize a
result once, command execution resets it before reuse, and free releases the
owned body. The request builder transfers ownership of its allocated body into
the executor, removing the extra protocol-request copy. Packet construction
still performs one body-to-packet copy; eliminating that final copy belongs
with the later streaming/pipelined transfer implementation.

## Proposed REST Contract

Endpoint names are placeholders. The contract matters more than the URL names.
All `uint64` fields are decimal strings.

### Capabilities

`GET /qmail/net/object-transfer/capabilities`

The response should include:

- supported protocol versions
- maximum object size
- preferred and maximum upload chunk sizes
- maximum download range
- maximum parallelism
- supported transports
- supported hash algorithms
- retention options
- capability timestamp and expiration
- source, such as local server or DRD

### Upload Operations

- `POST /qmail/net/object-transfer/uploads/begin`
- `PUT /qmail/net/object-transfer/uploads/{transfer_id}/chunks`
- `GET /qmail/net/object-transfer/uploads/{transfer_id}/status`
- `POST /qmail/net/object-transfer/uploads/{transfer_id}/commit`
- `DELETE /qmail/net/object-transfer/uploads/{transfer_id}`

`begin` should accept metadata, total size, whole-object hash, preferred chunk
size, retention, and file type. It should return a transfer ID, accepted chunk
size, limits, and expiration.

Each chunk request should identify its byte offset, data length, and chunk hash.
The response should identify the accepted range and whether it was new or an
idempotent duplicate.

Status responses should be paginated and return received or missing ranges
without requiring a bitmap proportional to object size.

### Download Operations

- `GET /qmail/net/object-transfer/objects/{object_id}`
- `GET /qmail/net/object-transfer/objects/{object_id}/ranges`

Object information should include total size, hash, type, protocol version,
availability, and recommended range size.

Range responses must echo object ID, offset, actual length, total size, and
hash information. Upload and download chunk sizes must remain independent.

### Progress Events

Long-running local operations should expose task IDs and progress over the
existing task/SSE mechanism, or a versioned replacement. Events should contain:

- transfer ID and object ID
- phase
- file index and filename
- unique transferred bytes
- total bytes
- retry count
- current throughput
- estimated remaining time when reliable
- terminal success, cancellation, or structured error

## Electron IPC Checklist

Large file I/O should run in the Electron main process, not the renderer.

- Add an upload file-handle API created only from a native file picker.
- Keep absolute paths and raw filesystem access out of general renderer APIs.
- Read bounded ranges using positioned file reads.
- Limit concurrent reads and requests using server capabilities.
- Support cancellation through `AbortController` and an IPC cancellation token.
- Detect file replacement or modification after selection.
- Compute hashes incrementally.
- Add a native save dialog or validated destination selection for downloads.
- Stream downloads to a same-directory temporary file.
- Flush, verify, atomically rename, and then report the final absolute path.
- Preserve partial files only when resume metadata is valid; otherwise remove
  them after failure or cancellation.
- Expose `openPath` only for paths produced or selected by trusted workflows.

An opaque handle is preferable to passing unrestricted paths:

```text
select file -> renderer receives handle + display metadata
renderer requests transfer using handle
main process resolves handle and reads allowed ranges
handle expires when compose closes or transfer finishes
```

## GUI Transfer Service

Create one transfer service rather than adding protocol logic directly to
`ComposeModal` or `ReadingPane`.

Suggested operations:

```text
getCapabilities()
beginUpload(file, metadata, options)
resumeUpload(transferId, file)
pauseUpload(transferId)
commitUpload(transferId)
abortUpload(transferId)
getObjectInfo(objectId)
downloadObject(objectId, destination, options)
resumeDownload(downloadId)
cancelDownload(downloadId)
```

The internal transfer state should include:

- stable local operation ID
- server transfer ID and final object ID
- protocol version
- source file handle or destination handle
- total size as a decimal string
- accepted upload chunk size
- recommended download range size
- acknowledged ranges
- current phase and retry state
- expected whole-object hash
- capability record version/expiration
- cancellation and terminal error state

Persist only the minimum state needed for safe resume. Never persist reusable
authentication secrets in renderer storage.

## Compose Checklist

- Fetch capabilities before accepting a large transfer.
- Show the server's maximum attachment/object size before send.
- Validate every attachment and the aggregate message policy.
- Keep legacy `upload_and_tell` for compatible small messages.
- Route supported large attachments through transfer sessions.
- Show per-file and aggregate byte progress.
- Show preparing, hashing, uploading, retrying, committing, and completed
  phases distinctly.
- Add pause, resume, retry, and cancel controls.
- Keep the compose window recoverable after an interrupted transfer.
- Revalidate capabilities when an expired DRD record was used.
- Surface structured errors such as size limit, quota, expired transfer, hash
  mismatch, payment failure, and TCP required.
- Do not mark the email sent until all attachment objects commit and the Tell
  operation succeeds.

## Download Checklist

- Obtain object information before choosing ranges.
- Ask the user for a destination or use the configured Downloads directory.
- Display the exact destination before transfer begins.
- Preflight free disk space with safety headroom.
- Write ranges directly to a temporary file at their byte offsets.
- Bound parallel range requests according to server and local limits.
- Verify range hashes when provided.
- Verify the whole-object hash before final rename.
- Show bytes downloaded, total bytes, speed, retries, and destination.
- Keep an Open Folder button after successful completion.
- Report partial-file location and resume availability after interruption.
- Never report success merely because the HTTP request started.

## Compatibility And Rollout

1. Add capability discovery without changing current behavior.
2. Add the `rest_core` REST adapter and validate it against published vectors.
3. Add Electron streaming and hashing behind a feature flag.
4. Enable Object Transfer v1 for explicit test accounts/servers.
5. Keep legacy transfer for servers without the capability.
6. Prefer Object Transfer v1 after interoperability and recovery tests pass.
7. Remove legacy large-object code only after all supported servers advertise
   the replacement protocol.

Protocol selection must be capability-based, not inferred from attachment size
alone.

## Client Test Checklist

- Exact REST fixtures derived from every normative wire test vector.
- Zero-byte, one-byte, final partial chunk, and maximum chunk.
- Metadata for objects above 4 GiB and a 25 GB sparse test file without reading
  or allocating the whole object.
- File modified, truncated, replaced, or deleted during upload.
- Duplicate acknowledgements and idempotent chunk retries.
- Interrupted upload followed by status lookup and resume.
- Expired and aborted transfers.
- Out-of-order range downloads and duplicate range responses.
- Offset plus length overflow and total-size mismatch.
- Chunk and whole-object hash mismatch.
- Stale DRD capabilities followed by stricter local server rejection.
- Runtime reduction of server maximum size or parallelism.
- TCP-required, quota, payment, retention, and authentication errors.
- Cancellation during hashing, upload, commit, download, and verification.
- Disk-full, permission, filename collision, and atomic-rename failures.
- Renderer reload and application restart during resumable transfers.
- Memory remains bounded as object size increases.
- Legacy fallback against servers without Object Transfer v1.

## Remaining Server Handoff

The GUI integration still requires:

1. A `rest_core` REST contract using decimal strings for all 64-bit values.
2. Capability discovery independent of DRD availability.
3. Persistent transfer status suitable for process restart and resume.
4. Structured errors with stable machine-readable codes.
5. Streaming endpoints that do not require `rest_core`, Electron, or the
   renderer to hold the complete object in memory.

The next implementation phase is the `rest_core` transfer state machine and
REST adapter. The React and Electron layers should remain on the legacy path
until those endpoints pass resume, cancellation, quota, and streaming tests.
