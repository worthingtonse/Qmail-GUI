# GUI encryption re-review — round 2

Scope: current uncommitted diff in `src/api/qmailApiServices.js`,
`src/qmail/screens/CoinEncryptionModal.jsx`, `electron.cjs`, and
`src/api/qmailApiServices.encryption.test.js`, reviewed against
`docs/fabl.spec-gui-encryption.md` and the round-fix instructions.

## Round-1 findings

### Major — valid `establishing_ready` success can be rejected: FIXED

`src/api/qmailApiServices.js:2325-2341` now rejects only an explicit
`data.success === false`, derives `keyState`/`confirmed` from `key_state`, and
normalizes `keySet` from `key_set`. The regression test at
`src/api/qmailApiServices.encryption.test.js:146-158` covers
`establishing_ready` success.

### Major — “wrong password” can be shown outside the 401 branch: FIXED

`src/api/qmailApiServices.js:2371-2388` sanitizes generic errors containing
wrong-password wording while preserving the original text in `detail`. The
400 regression test at `src/api/qmailApiServices.encryption.test.js:174-190`
also verifies that no `badPassword` flag is returned.

### Major — 503 string uses the wrong punctuation: WITHDRAWN

The authoritative spec explicitly requires the em dash. `rg -n 'please try
again' docs/fabl.spec-gui-encryption.md` confirms that the required text is
`safe — please try again.` The current API and test use that authoritative
string at `src/api/qmailApiServices.js:2361-2365` and
`src/api/qmailApiServices.encryption.test.js:123-125`.

### Major — decrypt is allowed with unconfirmed `establishing_ready`: FIXED

`src/qmail/screens/CoinEncryptionModal.jsx:144-147` permits
`establishing_ready` without a password only for encryption. The same
action-specific rule is used by the status copy at lines 395-399 and by the
post-password `canProceed` check at lines 208-211.

### Major — async work survives a modal/action change: NOT-FIXED

The generation guard is present and protects the awaited results, but the
reset effect returns before incrementing the generation when `isOpen` becomes
false (`src/qmail/screens/CoinEncryptionModal.jsx:91-94`). Closing/unmounting
without an immediate reopen therefore does not invalidate an in-flight
operation. The progress callback at lines 290-301 also calls
`setProgressMessage` without checking `isStale()`, so a late task update can
still mutate the closed or newly changed modal.

### Major — React state is updated after quit: FIXED

When `quitApp` exists, `src/qmail/screens/CoinEncryptionModal.jsx:318-323`
invalidates the generation before shutdown and the guarded `finally` at lines
382-385 cannot update renderer state. When `quitApp` is absent, shutdown is
followed by a staleness check before the summary path, as required.

### Major — duplicate registered paths are processed more than once: FIXED

`src/qmail/screens/CoinEncryptionModal.jsx:250-260` trims and lowercases each
wallet path and keeps the first occurrence before the sequential loop.

### Minor — aggregate counts are not fully surfaced: FIXED

Counts are aggregated across wallet tasks and the completion summary now
appends `already done` and `conflicts` when nonzero at
`src/qmail/screens/CoinEncryptionModal.jsx:333-344`.

### Minor — wallet-loop and modal contract branches have no tests: NOT-FIXED

The requested API regression tests were added, including establishing-ready,
missing `key_set`, generic 400 sanitization, wallet-path normalization, and
the 503 load-password case. However, this file still has no modal tests for
the sequential loop, duplicate-path behavior, empty-list fallback, aggregate
counts, action gating, or generation cancellation; it also does not cover
wallet-list failure/empty responses. This remains a minor coverage gap.

### Call-site compatibility check: VERIFIED

The current diff preserves the expected `keySet` field and uses the new
one-argument per-wallet encryption/decryption signatures. No old production
callers were found in the reviewed repository search.

## New findings

### Major — close transition does not invalidate the generation

`src/qmail/screens/CoinEncryptionModal.jsx:91-94` checks `!isOpen` before the
generation increment. On a close transition, the stale operation can
continue through its next await and call state setters or `onComplete` while
the modal is closed. Move the increment before the early return (or perform
the invalidation in cleanup).

### Major — task progress callback is not generation-guarded

`src/qmail/screens/CoinEncryptionModal.jsx:290-301` updates progress directly
from `waitForTaskCompletion`'s callback. If the operation becomes stale while
polling, a late callback can overwrite the current modal's progress even
though the awaited-result checks at lines 303-304 return. Guard the callback
with `if (isStale()) return;` before any setter.

## Verdict

REQUEST_CHANGES

## Round 3

### Major — close transition does not invalidate the generation: FIXED

`src/qmail/screens/CoinEncryptionModal.jsx:91-94` now increments
`operationRef.current` before the `isOpen` early return, and the effect
cleanup also increments it at lines 124-128. Thus close, action changes, and
unmount invalidate the prior operation. The two increments on an action or
open-state transition cannot mark the current submission stale: cleanup
invalidates the old operation, the new effect establishes the new generation,
and `handleSubmit` captures its generation afterward at lines 154-157.

### Major — task progress callback is not generation-guarded: FIXED

The `waitForTaskCompletion` `onUpdate` callback at
`src/qmail/screens/CoinEncryptionModal.jsx:292-295` now returns immediately
when `isStale()` is true, before calling `setProgressMessage`.

### Handle-submit state-update audit: VERIFIED

No unguarded asynchronous state-update path remains in `handleSubmit`.
Post-await branches check `isStale()`, the task callback checks it before its
setter, and `catch`/`finally` are guarded. Setters before the first await and
between a completed staleness check and the next await belong to the current
captured submission and cannot be interleaved by another operation.

## Final verdict

APPROVE
