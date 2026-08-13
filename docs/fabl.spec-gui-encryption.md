# SPEC: Update QMail GUI encryption flow to the live Type 10 core contract

You are working in D:\Code\p2\gui (branch phase2), an Electron + React (Vite) app.
The code is ground truth — READ every file listed below before editing it.
Do NOT run builds, tests, git commands, or install anything. The orchestrator
verifies with eslint + vitest afterward.

## Background

The core's coin-file encryption REST API is now fully implemented and
live-verified. The GUI already has a working encryption UX (startup unlock
gate, Security menu, CoinEncryptionModal, API functions) but it was written
against a PRE-implementation draft contract. Your job is to update it to the
real contract below. This is a surgical update, not a rewrite — preserve the
existing structure, style, naming, and CSS classes.

## HARD FILE BOUNDARY — touch ONLY these files

1. `src/api/qmailApiServices.js` — ONLY the encryption-related functions
   (`getCoinEncryptionStatus`, `setCoinEncryptionPassword`,
   `encryptExistingCoinFiles`, `decryptExistingCoinFiles`) plus ONE new
   exported helper `listRegisteredWalletPaths` (place it near
   `lookupWalletPathByName`, ~line 3038, and reuse its fetch pattern).
   Do not touch any other function in this 3400-line file.
2. `src/qmail/screens/CoinEncryptionModal.jsx`
3. `src/qmail/screens/CoinEncryptionModal.css` — only if you add new UI
   elements that need styles; follow the existing class naming.
4. `electron.cjs` — ONLY the Security submenu block (~lines 1762-1781).
5. `src/api/qmailApiServices.encryption.test.js` — update to match.

Nothing else. Not QMail.jsx, not QMailDashboard.jsx, not preload.cjs.

## THE LIVE CORE CONTRACT (verified against production — this is fact)

### GET /api/system/encryption-status → 200
```json
{
  "command": "encryption-status", "success": true,
  "key_state": "none|establishing_ready|establishing|candidate|confirmed",
  "state": "encrypted|decrypted|mixed",
  "encrypted_count": 372, "plaintext_count": 0,
  "legacy_unsupported_files": 0,
  "corrupt_type10": 0, "salt_domains": 1,
  "encrypted_files_exist": true, "login_required": true, "key_set": false
}
```
503 = scan failed (transient; retry).
`login_required` is true when encrypted files exist AND key_state != "confirmed".

### POST /api/system/load-password  (form body `password=`)
- 200 confirmed:   `{"success":true,"key_set":true,"key_state":"confirmed","raida":{"pass":25,"fail":0,"usable":25}}`
- 200 candidate:   same shape, `"key_state":"candidate"`, message says wallet
  is read-only until RAIDA confirmation succeeds (network was flaky — the
  password might be right or wrong, we could not get a quorum).
- 200 establishing_ready: `"key_state":"establishing_ready"` — no encrypted
  files exist yet; password is held in RAM for the first encryption run.
- 401: `{"error":true,"message":"bad password","detail":"(or coins are counterfeit)","key_state":"none","key_set":false,"raida":{...}}`
  — DEFINITIVE wrong password (a RAIDA quorum rejected it). The only case
  where the UI may say "wrong password".
- 503: corrupt Type 10 present, OR wallet scan failed. INCONCLUSIVE — the UI
  must NOT say "wrong password"; it must say verification could not complete
  and offer retry.
- 405 on GET; 400 on missing password.

### POST /api/system/encrypt_existing_files  (form body, optional `wallet_path=`)
- PER-WALLET: `wallet_path` defaults to the Default wallet ONLY. It does NOT
  scan all registered wallets (the old JSDoc claim is wrong).
- There is NO `folders` parameter anymore. The core walks a fixed folder set
  (Bank, Fracked, Limbo, Suspect, Grade, Pending, Import, Imported). Remove
  all `folders` handling.
- 200 kickoff: `{"success":true,"task_id":"...","url":"...","wallet_path":"...","key_state":"establishing|confirmed","key_set":true,"message":"..."}`
- 400 "No password held — call /api/system/load-password first" (first
  encryption without a held password)
- 400 "Type 10 files present; confirmed key required" (+ key_state field)
- 400 corrupt Type 10 present; 400 bad/unregistered wallet_path; 405; 503 scan.
- Task counts (in task data.counts): processed, encrypted, skipped, errors,
  already_target, skipped_multi, conflict. Task status "failed" if
  errors>0 or conflict>0. Idempotent — re-run finishes the job.

### POST /api/system/decrypt_existing_files — mirror of encrypt
- Requires key_state "confirmed", else 400 "Confirmed key required for
  decrypt_existing_files". Same per-wallet default, no folders param.
- NO MORE 501 — the endpoint is fully implemented. DELETE the 501
  special-case in decryptExistingCoinFiles.
- Counts: processed, decrypted, skipped, errors, already_target,
  skipped_multi, conflict.

### GET /api/wallets/list → `{"wallets":[{"wallet_name":"Default","wallet_path":"E:\\...\\Wallets\\Default", ...}]}`
(field names may be `wallet_name`/`name` and `wallet_path`/`path` — normalize
both, as lookupWalletPathByName already does).

## CHANGES

### A. `getCoinEncryptionStatus` (qmailApiServices.js ~2266)
Keep existing normalized fields (keySet, encryptedFilesExist, loginRequired)
and ADD:
- `state`: String(data?.state || "") — "encrypted"|"decrypted"|"mixed"
- `keyState`: String(data?.key_state || "none")
- `encryptedCount`, `plaintextCount`, `corruptType10`, `saltDomains`:
  Number(...) || 0

### B. `setCoinEncryptionPassword` (~2299)
Keep the byte validation and form-encoded POST exactly as-is. Change response
handling:
- On success (200): return `{success:true, data:{...data, keySet:true,
  keyState, confirmed: keyState==="confirmed", raida: data?.raida || null}}`.
  Delete the `passwordVerified` / `verifierCreated` fields (they never
  existed in the real contract).
- On failure: inspect `error.httpStatus` (read how `handleResponse` attaches
  it — follow the existing pattern in this file):
  - 401 → `{success:false, badPassword:true, httpStatus:401, error:"Wrong
    password. Please try again."}`
  - 503 → `{success:false, inconclusive:true, httpStatus:503, error:"The
    password could not be verified (network or file problem). Your coins are
    safe — please try again."}`
  - anything else → current behavior.
The thrown-error message from the body should be preserved in a `detail`
field if available, but the top-level `error` strings above are what the UI
shows.

### C. `encryptExistingCoinFiles` / `decryptExistingCoinFiles` (~2384/~2436)
- New signature: `(walletPath = null)`. Delete the `folders` parameter, its
  validation, and `body.set("folders", ...)` entirely.
- Delete the 501 special-case in the decrypt catch block.
- Everything else (task_id extraction, error wrapping) stays.

### D. NEW `listRegisteredWalletPaths()` export (near line 3038)
Fetch `${API_BASE_URL}/wallets/list`; return
`{success:true, data:{wallets:[{name, path}]}}` with both field spellings
normalized, or `{success:false, error}` on any failure. No throw.

### E. `CoinEncryptionModal.jsx`
1. `getEncryptionCounts`: also read `already_target`, `skipped_multi`,
   `conflict` (camelCase in the returned object: alreadyTarget, skippedMulti,
   conflict).
2. `needsPassword`: replace `!keyAlreadySet` logic with:
   `const keyState = encryptionStatus?.keyState || "none";`
   `const needsPassword = !(keyState === "confirmed" || keyState === "establishing_ready");`
3. Password submit (all actions): branch on the new result shape:
   - `result.badPassword` → setError(result.error) — this is the ONLY branch
     that may show a wrong-password message.
   - `result.inconclusive` → setError(result.error) with wording that does
     NOT accuse the password (use the API error string).
   - success + `result.data.keyState === "candidate"` → do NOT proceed and do
     NOT call onComplete. Show a warning (reuse the error styling or a new
     `__status--warning`): "The RAIDA could not fully verify the password.
     The wallet stays read-only. Check your connection and try again." For
     the unlock action the gate must stay up.
   - success + confirmed (or establishing_ready when isEncrypting) → proceed
     as today.
4. WALLET LOOP (encrypt and decrypt): instead of one call with no
   wallet_path, do:
   - `const walletsResult = await listRegisteredWalletPaths();`
   - If it fails or returns zero wallets, fall back to a single call with no
     wallet_path (core defaults to the Default wallet).
   - Otherwise loop the wallets SEQUENTIALLY: for each, call
     encrypt/decryptExistingCoinFiles(wallet.path), then
     `waitForTaskCompletion` with onUpdate showing
     `Encrypting coin files (walletName)... NN%`. Aggregate the counts
     across wallets (sum each field). Abort the loop on the first failed
     start or failed task and show which wallet failed.
   - Keep the existing decrypt completion behavior (shutdownCore + quitApp)
     AFTER the loop finishes all wallets.
5. Mixed-state copy: when `encryptionStatus?.state === "mixed"`, the intro
   text and submit button should read "Finish Encrypting" / "Finish
   Decrypting" (an interrupted run is being resumed). Keep the modal titles
   as-is.
6. Support signals in the status area (non-blocking, shown alongside
   statusCopy):
   - `corruptType10 > 0` → warning: "N damaged encrypted coin file(s) were
     detected. Contact support — do not delete any files."
   - `saltDomains > 1` → warning: "Some coin files were encrypted under a
     different password (e.g. copied from another wallet). They will be
     skipped."
7. The completion state update currently sets
   `{keySet: isEncrypting, encryptedFilesExist: isEncrypting, ...}` — also
   set `keyState: isEncrypting ? "confirmed" : "none"` and
   `state: isEncrypting ? "encrypted" : "decrypted"` for consistency.

### F. `electron.cjs` Security submenu (~1762-1781)
When `coinFileState.state === 'mixed'`, the two item labels become
'Finish Encrypting Coins' and 'Finish Decrypting Coins' (enabled logic
unchanged). Otherwise labels stay 'Encrypt Coins' / 'Decrypt Coins'.

### G. `src/api/qmailApiServices.encryption.test.js`
Read the existing tests first and preserve their style/harness. Update:
- encrypt/decrypt: assert `folders` is NOT sent; assert wallet_path IS sent
  when provided and absent when null; remove any 501 expectation.
- load-password: add cases — 401 → `badPassword: true` and the fixed error
  string; 503 → `inconclusive: true`; 200 confirmed → `data.confirmed ===
  true`, `data.keyState === "confirmed"`; 200 candidate → success but
  `confirmed === false`.
- encryption-status: assert the new normalized fields (state, keyState,
  corruptType10, saltDomains).
- Add a small test for `listRegisteredWalletPaths` (URL + normalization of
  wallet_name/wallet_path vs name/path).

## RULES
- Plain JS/JSX. No TypeScript, no new dependencies, no refactors outside the
  listed deltas. Match surrounding code style (the file uses 2-space indent,
  double quotes, trailing commas).
- NEVER put the password in a URL or log it.
- The string "wrong password" (any casing) must not be reachable from any
  branch except the 401 path.
- Do not run npm/vitest/eslint/git. Just edit the files.
- When done, print a short summary listing each file changed and the delta.
