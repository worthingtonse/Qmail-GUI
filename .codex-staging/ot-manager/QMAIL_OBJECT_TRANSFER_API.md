# QMail Object Transfer REST API

The Object Transfer API starts durable asynchronous operations. Request
parameters may be supplied in the query string or as URL-encoded form fields.
File content is not sent through HTTP: uploads reference a local source path
and downloads reference a local destination path.

All byte counts, generations, retention values, and timestamps that can exceed
JavaScript's safe integer range are returned as decimal strings.

## Endpoints

### `GET /api/qmail/net/objects/capabilities`

Parameters: `wallet_path`, `raida_id`.

Returns the live command 83 limits and storage classes for one QMail server.

### `POST /api/qmail/net/objects/upload`

Required: `wallet_path`, `source_path`.

Optional: `raida_id`, `file_type`, `object_id`, `locker_key`,
`retention_seconds`, `storage_class`, `preferred_chunk_bytes`, `operation`,
`expected_generation`, `target_generation`.

`operation=0` creates an object. `operation=1` replaces an object and requires
the original `object_id`, `locker_key`, and exact expected generation.

### `POST /api/qmail/net/objects/download`

Required: `wallet_path`, `object_id`, `destination_path`.

Optional: `raida_id`, `file_type`, `generation`, `preferred_range_bytes`.

The manager downloads into a unique `.qmail.part` file, verifies the complete
SHA-256 hash, then atomically moves it to `destination_path`.

### `POST /api/qmail/net/objects/delete`

Required: `wallet_path`, `object_id`, `expected_generation`,
`target_generation`.

Optional: `raida_id`, `file_type`.

### `GET /api/qmail/net/object-transfers/status`

Required: `operation_id`.

Returns durable state, task ID, progress, negotiated values, server status,
hash, and relevant local paths.

### `POST /api/qmail/net/object-transfers/resume`

Required: `operation_id`.

Clears the local retry count and resumes a paused operation. Failed,
cancelled, and completed operations are terminal.

### `POST /api/qmail/net/object-transfers/cancel`

Required: `operation_id`.

Uploads are aborted with command 80. Partial download files are removed.

## Persistence

Operations and pending byte ranges are stored in `qmail.db`. In-flight ranges
return to pending state after restart. Upload recovery retries the same
persisted Transfer ID, reconciles command 78 missing ranges, and commits
idempotently. Download recovery pins command 81 metadata and resumes only
unfinished ranges.
