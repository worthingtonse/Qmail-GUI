# SPEC: Fix round — GUI encryption contract update (review findings)

You are continuing work in D:\Code\p2\gui (branch phase2). A previous round
updated the encryption flow; the adversarial review found issues. Apply ONLY
the fixes below. The code is ground truth — READ each file before editing.
Do NOT run builds, tests, or git commands.

## HARD FILE BOUNDARY
1. `src/api/qmailApiServices.js` — only `setCoinEncryptionPassword`
2. `src/qmail/screens/CoinEncryptionModal.jsx`
3. `src/api/qmailApiServices.encryption.test.js`

## FIX 1 — `setCoinEncryptionPassword`: do not fail a 200 on missing key_set
Current code (~line 2320) throws when `data?.success === false ||
!isTruthyApiFlag(data?.key_set)`. Change it to throw ONLY on
`data?.success === false`. On any 200, derive everything from `key_state`
as now (`keyState`, `confirmed`, `raida`); set `keySet:
isTruthyApiFlag(data?.key_set)` instead of hardcoded true.

## FIX 2 — `setCoinEncryptionPassword`: sanitize the generic error branch
The final catch-all return (non-401, non-503) currently passes
`error.message` straight through, and the modal displays it. A 400/405 body
could contain the words "wrong password" / "bad password", which the UI must
only ever show for HTTP 401. In that generic branch: if the message matches
/wrong\s+password|bad\s+password/i, replace the user-facing `error` with
"The password could not be processed. Please try again." and keep the
original message in `detail`. Otherwise pass it through unchanged.

## FIX 3 — `CoinEncryptionModal.jsx`: establishing_ready only satisfies ENCRYPT
`needsPassword` currently treats `establishing_ready` as "no password
needed" for every action. Decrypt and unlock require `confirmed`. Change to:
```js
const needsPassword = !(
  keyState === "confirmed" ||
  (isEncrypting && keyState === "establishing_ready")
);
```
Apply the same rule in the `statusCopy` block: the "key already loaded"
copy for decrypt/unlock must only trigger on `confirmed`; for encrypt it may
trigger on `confirmed` or `establishing_ready`.

## FIX 4 — `CoinEncryptionModal.jsx`: operation-generation guard
The submit handler runs a long sequential wallet loop. If the modal's
`action` changes or it is closed/reopened mid-run, the effect that resets
state does not cancel the old loop: the stale loop keeps mutating state,
can call the old `onComplete`, and the reset re-enables the submit button.
Also, after the decrypt path calls `quitApp()`, the `finally` block still
calls setState on a tearing-down renderer.

Fix with a generation counter:
- `const operationRef = useRef(0);` (import useRef).
- In the existing reset `useEffect` (the one keyed on `[action, isOpen]`),
  increment `operationRef.current` as its first statement.
- At the top of `handleSubmit`: `const operation = ++operationRef.current;`
  and a helper `const isStale = () => operationRef.current !== operation;`
- After EVERY `await` in `handleSubmit` (login, wallet-list, each start
  call, each waitForTaskCompletion, getCoinFileState): `if (isStale())
  return;` BEFORE any setState or onComplete call.
- Immediately BEFORE `await shutdownCore()` on the decrypt-complete path,
  set `operationRef.current += 1;` so the finally block is skipped (see
  next line) and nothing updates state during app teardown. Note this also
  makes `isStale()` true, so place it after the last needed setState
  (`setProgressMessage("Decryption complete. Closing QMail securely...")`).
- Wrap the `finally` body: `if (!isStale()) { setProgressMessage("");
  setIsWorking(false); }`.

## FIX 5 — `CoinEncryptionModal.jsx`: de-duplicate wallet paths
Before the loop, de-duplicate the wallets array by normalized path
(`path.trim().toLowerCase()` — Windows paths are case-insensitive), keeping
first occurrence. A backend list that returns the same path twice must not
run the bulk job twice.

## FIX 6 — `CoinEncryptionModal.jsx`: surface the extra counts
In the completion summary string, append `, N already done` when
`aggregateCounts.alreadyTarget > 0` and `, N conflicts` when
`aggregateCounts.conflict > 0` (keep the existing
"X encrypted, Y skipped, Z errors." base).

## FIX 7 — tests (`qmailApiServices.encryption.test.js`)
Add, in the existing style:
- 200 with `key_state: "establishing_ready"` and `key_set: true` →
  `success: true`, `data.keyState === "establishing_ready"`,
  `data.confirmed === false`.
- 200 with `key_state: "confirmed"` but `key_set` MISSING from the body →
  still `success: true`, `confirmed: true` (FIX 1 regression test).
- 400 response whose body message is "bad password detected" →
  `success: false`, no `badPassword` flag, and `result.error` does NOT
  match /wrong password|bad password/i (FIX 2 regression test); original
  text preserved in `result.detail`.

## RULES
Match surrounding style. No new dependencies. No refactors beyond the
deltas. Print a short per-file summary when done.
