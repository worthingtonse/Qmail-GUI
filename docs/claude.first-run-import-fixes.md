# Change Review: First-Run Legacy Import, Convert Recovery, and Import Transparency

**Author:** Claude (Opus 5)
**Date:** 2026-08-11
**Status:** Implemented, built, unit-tested. **NOT tested end-to-end against real coins or real RAIDAs.**
**Repos touched:** `p2/core`, `p2/gui`

---

## Reviewer: start here

This document describes five changes made in one session. They came from
investigating a field incident (Pierre's CloudCoin Desktop wallet appearing to
lose 11 coins during QMail first-run setup) and a question about whether
first-run CCv1/CCv2 deposit works at all.

**What I most want reviewed, in priority order:**

1. **Change 4 (convert recovery reader)** — the largest and riskiest. It is
   recovery code, which by definition only runs when something has already
   gone wrong. It is entirely unexercised.
2. **Change 3 (write-ahead reordering)** — changes the meaning of a retained
   journal from "the switch happened" to "the switch may have happened."
   Anything downstream that assumed the old meaning is a bug I may have missed.
3. **Change 2 (fallback guard widening)** — I got the failure codes wrong on
   the first attempt (see "Corrections" below). Please re-derive independently
   rather than trusting my reasoning.

**Files changed (mine only):**

```
core/src/commands/cmd_convert.c   +485/-~   (reader, reordering, journal format)
core/src/commands/cmd_deposit.c   +43/-19   (fallback guard, logging)
core/include/cmd_convert.h        +45       (three new public declarations)
core/api_src/main_rest.c          +29       (boot recovery wiring)
gui/electron.cjs                  +28       (path classification, external flag)
gui/src/qmail/screens/WalletActionModal.jsx  +37/-~  (gate provisioning, warning)
gui/src/qmail/screens/WalletActionModal.css  +13     (warning style)
gui/src/qmail/screens/depositReceipts.js     +47     (two pure helpers)
gui/src/qmail/screens/depositReceipts.test.js +71    (10 new cases)
```

**Pre-existing modifications in the working tree that are NOT mine and should
not be attributed to this work:** `gui/src/api/qmailApiServices.js`,
`gui/src/api/qmailApiServices.version.test.js`, `gui/src/version.js`,
`gui/ci/bump_qmail_client_version.sh`, `gui/src/platform.js`,
`gui/src/platform.test.js`, and everything under `gui/docs/`.

---

## Background: the two questions that started this

**Q1: Will first startup accept CCv1/CCv2, and what encryption does it use
when there is no coin to encrypt with?**

Answer: yes, deliberately. The GUI advertises `.bin, .stack`
(`WalletActionModal.jsx:56`) and the Electron picker filters on
`extensions: ['bin', 'stack']`. Folder import does not filter at all. Core
parks legacy files into `Import/CCv1/` and `Import/CCv2/` during UNPACK and
converts them in deposit Phase 5 (`cmd_deposit.c:1162-1225`).

Both network paths already had unencrypted fallbacks:

- **POWN** (`cmd_deposit.c:527-556`): target wallet key -> any wallet key ->
  POWN SUM unencrypted.
- **CONVERT** (`cmd_deposit.c:1171-1188`): encrypted attempt, then retry with
  `ENC_TYPE_NONE`.

The empty-wallet first-run case worked. The defect was narrower — see Change 2.

**Q2: What throws "Default has no QMail identity coin worth at least 1 CC"?**

`core/api_src/api_handlers_qmail_identity.c:434`, in
`api_handle_qmail_provision_identity` (`POST
/api/qmail/local/identity/provision-from-default`), HTTP 422. Fires when
`wallet_find_highest_eligible_coin(default_path, 0, 4, &candidate)` returns
`RESULT_NOT_FOUND` — no denomination 0-4 coin in Default's **Bank or Fracked**.
Counterfeit, Limbo, and Pending coins are not eligible.

---

## Change 1 — Onboarding no longer dead-ends after an empty deposit

**File:** `gui/src/qmail/screens/WalletActionModal.jsx` (~lines 717-745)

**Problem.** `handleAddFunds` called `provisionIdentity()` unconditionally after
every onboarding deposit, including deposits that banked nothing. The line
directly above already computed `depositAddedNothing(totals)` and displayed
"No funds were added to the Default wallet" — but did not branch on it.

Consequence: a user whose coins all graded counterfeit saw "No funds were
added" immediately followed by the 422 above. Worse, `setDepositCompleted(true)`
had already fired, and that flag:

- disables every import control (lines ~944-1018),
- swaps the footer button to "Retry Identity Setup" (line ~1221).

"Retry Identity Setup" re-POSTs the same endpoint against the same empty
Default and fails identically. There is no path back to the import step. This
is the dead end Pierre hit.

**Change.** Hoist the value and use it twice:

```js
const addedNothing = depositAddedNothing(totals);
...
setDepositCompleted(!(onboardingMode && addedNothing));
...
if (onboardingMode && !addedNothing) {
  await provisionIdentity();
}
```

**Why this shape.** One flag does both halves. Not setting `depositCompleted`
suppresses the doomed 422 *and* leaves the Files/Folder/Locker controls live so
the user can try different coins. No new state, no new UI branch.

**Scope.** Non-onboarding deposits are unaffected (`onboardingMode` guards
both). A successful onboarding deposit behaves exactly as before.

**Review question:** is there any caller that depends on `depositCompleted`
becoming true even for an empty onboarding deposit? I checked all 14 references
and found none, but a second pass is worthwhile.

---

## Change 2 — Widened the convert unencrypted-retry guard

**File:** `core/src/commands/cmd_deposit.c` (~lines 1177-1200)

**Problem.** The retry guard was:

```c
if (legacy_upgrade_res == RESULT_NOT_FOUND && converted == 0 &&
    !options->use_unencrypted) {
```

`RESULT_NOT_FOUND` covers "no helper coin anywhere" — the empty-wallet
first-run case. But `convert` selects its helper with
`encryption_key_select()`, which sets `search_other_wallets = true` internally
(`encryption_key.c:668-670`) and does **not** validate the coin against RAIDA.

So a stale or counterfeit helper coin in an unrelated registered wallet is
selected happily, and the failure surfaces later as the *encrypted request*
being rejected — reported as `RESULT_NETWORK_ERROR` (`cmd_convert.c:666, 895,
939, 1067`) or a non-SUCCESS `executor_run` code (`:733, :1143`), never as
`NOT_FOUND`. Those skipped the fallback entirely and hard-failed a legacy
import that never needed encryption.

**Change.** Guard now covers `RESULT_NOT_FOUND | RESULT_NETWORK_ERROR |
RESULT_ERROR`, still gated on `converted == 0`. Added logging on all three
branches (encrypted / unencrypted-retry / unencrypted-by-request).

**Why `converted == 0` makes this safe.** With nothing converted, no legacy
coin has been switched, so a retry cannot double-spend. If the failure really
was a network outage, the retry fails too and the original error still reaches
the user.

**Why the logging matters.** The existing bug reports in `gui/docs/` could not
distinguish their own hypotheses because nothing recorded which encryption mode
convert used. POWN logs this (`cmd_deposit.c:536`); convert did not. One log
line turns the next incident from speculation into a grep.

### Corrections — please verify these independently

I made two wrong claims during this work and corrected them. Both are worth
re-deriving because they show where my model of this codebase was weak:

1. **First attempt guarded on `RESULT_BAD_KEY` / `RESULT_HELPER_REJECTED`.**
   Wrong — those are produced only by `cmd_detect.c`, `cmd_get_ticket.c`, and
   `cmd_heal.c`. Convert never emits them, so that guard would have been dead
   code. Caught by grepping for producers before committing.

2. **I claimed the convert path "has no Pending backup at all."** Wrong. It has
   a `Recovery/` journal (`cmd_convert.c`, originally ~:1381-1443) that is
   deliberately designed and documented. I had grepped for the string "Pending"
   and concluded absence from a negative result.

**Reviewer: the widened guard rests on my reading that `RESULT_NETWORK_ERROR`
is what a bad helper actually produces here. I traced it but did not reproduce
it. If that reading is wrong, this change is either dead code (harmless) or
too broad (masks genuine outages behind a doubled attempt).**

---

## Change 3 — Write-ahead reordering of the convert recovery journal

**File:** `core/src/commands/cmd_convert.c`

**Background — the wire format.** Command 10/175 (`SwitchShardNoSum`) body
(`switch_shard_no_sum_build_body`):

```
sessionID(4) + shardID(1) + reserved(1) +
legacyCount(2) + [DN(1)+SN(4)+AN(16)] x N +
raidaKey(16)                                  <- the PANG
newCount(2) + [DN(1)+SN(4)] x M               <- new coins: NO AN on the wire
```

New coins are sent as **DN+SN only**. The AN never crosses the wire. Both sides
derive it (`convert_derive_ans`, ref `switchshard.go:113-123`):

```
AN = MD5( DN(1) + SN(4,BE) + raidaKey[raida_id][5:16](11) )
```

The PANG is generated **client-side** (`crypto_random_bytes`, byte 7 stamped to
the RAIDA index). **Consequence: the client knows every post-switch AN before
it sends the request, and the PANG is the only input that yields them.**

**Problem.** The original order was:

```
Step 2:   convert_switch_shard_no_sum()   <- PANG generated INSIDE, RAIDA rotates
Step 3:   convert_derive_ans()
Step 3.5: convert_write_recovery_journal() <- journal written AFTER
Step 4:   convert_write_new_coins()
```

The journal covered a **disk-write failure in Step 4** — exactly what its own
comments claimed, so this was not a bug against its design. What it did not
cover: a crash, power loss, or hard timeout **during Step 2**. In that window
the RAIDA may have rotated while the PANG existed nowhere but process RAM, with
the legacy source already consumed. Those coins were unrecoverable by any means.

CCv3 deposit does not have this hole: it pre-commits PANs to `Suspect/` before
POWN (`cmd_deposit.c:558-617`, "Write-Ahead Log"). Convert derived the
equivalent secret but persisted it too late.

**Change.** New Step 1.5 before the network call:

```
Step 1:   convert_get_sns()
Step 1.5: generate PANGs -> journal -> fflush + fsync/_commit   <- NEW
Step 2:   convert_switch_shard_no_sum()   (takes PANGs as const in-param)
Step 3:   convert_derive_ans()
Step 3.5: rewrite journal (real alloc count + derived ANs)
Step 4:   convert_write_new_coins()
```

Supporting changes:

- **Signature:** `convert_switch_shard_no_sum` takes
  `const uint8_t raida_keys_in[RAIDA_COUNT][AN_LENGTH]` instead of writing
  `raida_keys_out`. Static function, single call site.
- **Journal format:** 400-byte PANG block inserted after the 4-byte count
  header, before the per-coin records. Per-coin record layout unchanged
  (`RECOVERY_COIN_SIZE` = 430).
- **Durability:** added `fflush` + `_commit`/`fsync`. A write-ahead record in
  the page cache is worthless against power loss. Required `<io.h>` /
  `<unistd.h>`.
- **Fail closed:** if the journal cannot be written, abort before SwitchShard.
  Nothing is switched yet, so aborting is free and the legacy files stay put.
- **Failure path:** the SwitchShard error branch now **retains** the journal.

**The semantic shift — most important thing for a reviewer to check.**

Before: a retained journal meant *the RAIDA definitely rotated these coins*.
After: it means *the RAIDA may have rotated these coins* — because the journal
now also survives a crash where the request never landed.

That is the entire point (it is what makes the coins recoverable), but it means
**any consumer that assumed the old meaning is now wrong.** I updated the two
comments in `convert_phase_execute` that asserted it. I found no code consumer
because no reader existed. **Please verify that independently** — a missed
consumer is the most likely latent bug in this change.

**Compatibility:** journals written by older builds lack the PANG block and
will fail the length check in the new reader. They are logged as unreadable and
**left on disk**, not misparsed or deleted. Relevant if test machines have old
journals.

---

## Change 4 — Convert recovery reader (highest risk)

**Files:** `core/src/commands/cmd_convert.c`, `core/include/cmd_convert.h`,
`core/api_src/main_rest.c`

**Problem.** After Change 3 the journal is written at the right time and
retained on every failure — but nothing read it. Recovery was manual/offline.

**Change.** Four new functions:

| Function | Role |
|---|---|
| `convert_read_recovery_journal()` (static) | Inverse of the writer; bounds-checks the count field |
| `convert_recover_one_journal()` (static) | Derive ANs from PANGs -> DETECT -> write to `Grade/` -> `grade_folder()` |
| `convert_process_recovery()` (public) | Per-wallet sweep of `Recovery/*.bin` |
| `convert_scan_recovery_journals()` (public) | Cheap startup count, mirrors `deposit_scan_suspect_folders` |
| `convert_process_recovery_all()` (public) | All-wallet sweep, takes `deposit_mutex_lock()` per wallet |

**Key design decision: disposition is delegated, not reinvented.**

Rather than writing my own pass-count thresholds, the reader populates
`pown_status` from `detect_execute` and hands off to the existing
`grade_folder()`, which already sorts Bank / Fracked / Limbo / Counterfeit
using the project's thresholds. A split or unreachable quorum lands in Limbo
through that same existing logic.

This follows the "existing functions as single points of truth" rule and avoids
a duplicated threshold that could drift from the live path.

**Why DETECT.** `detect_execute` verifies an AN without rotating it, so it is
safe to run unattended at boot.

**Why CCv3-side only.** I originally scoped a two-sided probe (legacy shard and
CCv3 shard). The legacy side turned out unnecessary: if the switch never
landed, the CCv3 coins come back counterfeit and the legacy originals are still
in `Import/` for a normal retry. Probing the legacy shard would add a round trip
to confirm what the CCv3 answer already implies.

**Retention discipline.** A journal is deleted **only** when recovery genuinely
resolves it. Retained when: detect cannot reach the RAIDA, the file is
unreadable, or the coin write fails. Unreachable RAIDAs are the case where
disposing of anything would be actively harmful — we still do not know which
side of the switch the coins are on.

**Boot wiring** (`main_rest.c`): added `convert_journal_count` to the startup
scan and to `recovery_thread_args_t`; the recovery thread runs convert recovery
**last**, after deposit recovery and the legacy sweep, because the legacy sweep
can itself be interrupted and leave a fresh journal. Spawn gate widened to
include the journal count.

**Encryption decision (Option A) — documented in code.** The journal stays
**plaintext**. Encrypting under Type 10 would make boot recovery impossible:
no password is held at startup, so `t10_session` returns `RESULT_LOCKED`. That
trades a certain availability loss for an uncertain secrecy gain. Exposure is
narrow — a PANG yields the AN for one specific DN+SN on one shard, and only
while an unrecovered journal exists. Journals are deleted as soon as recovery
resolves them.

Note this **supersedes** the existing code comment (originally ~`:1372-1375`)
warning that the plaintext decision must be revisited if an automated reader is
added. A reader now exists. The rationale is written into the code above the
reader so the next person inherits it. **If the reviewer disagrees with Option
A, the migration path is to encrypt and retrigger recovery after login rather
than at boot.**

**Review questions:**

- Is `CS_AUTH_UNTRIED` the right seed status before `convert_derive_ans`? I set
  all 25 slots so the derivation fills every slot, expecting detect to
  overwrite with real verdicts. If detect leaves some slots untouched on
  partial response, those coins carry an optimistic status into grading.
  **This is my main self-doubt about this change.**
- Is taking `deposit_mutex_lock()` per wallet (rather than once for the sweep)
  the right granularity? I followed `cmd_upgrade.c:1155`.
- The reader calls `convert_write_new_coins` with a `convert_options_t` that
  has only `wallet_path` set. Are any other fields load-bearing?

---

## Change 5 — Import transparency (GUI)

**Files:** `gui/electron.cjs`, `gui/src/qmail/screens/WalletActionModal.{jsx,css}`,
`gui/src/qmail/screens/depositReceipts.{js,test.js}`

**Background — why NOT copy-on-import.** The original diagnosis in
`gui/docs/grok-.setup-qmail.bug.txt` recommends changing import to copy. I
recommend against it, and the user confirmed the invariant: **a coin must never
exist in two places at once.**

`fs_move_file` (`core/src/filesystem.c:213-266`) already enforces this
correctly — `rename()` first, then copy + verify size + delete source
cross-volume, and if the source delete fails it **removes the destination** to
prevent duplicates. The rollback-copy exception also already exists:
`cmd_deposit.c:494` copies to `Pending/` ("intentional copy, not move") and
`cmd_grade.c:239-248` deletes that copy once graded, keeping it only for Limbo.

Decisive finding: **the user's original file is never destroyed.**
`cmd_unpack.c:597-601` moves each source file to `<wallet>/Imported/` with the
comment "Always move the original file to Imported for a clear audit trail."
Pierre's 11 coins are in `Default/Imported/` right now.

So copy-on-import would violate the invariant for no gain. The real defect is
that **nothing tells the user the move will happen, and nothing tells them
where the files went.** `Imported/` is an audit trail nobody surfaces.

**Change 5a — pre-import move warning.** Applies to all imports (files and
folders, legacy and CCv3).

- `electron.cjs`: `isPathOutsideClientData()` uses `path.relative` against the
  resolved `Client_Data` root, not string-prefix matching, so
  `Client_Data_backup` is not mistaken for internal. Unresolvable paths return
  `true` (warn) — a spurious warning is harmless, silence on a genuinely
  external file is not. Both pickers now return an `external` flag.
- `depositReceipts.js`: `getImportMoveWarning(method, selection)`, pure,
  returns `""` when nothing external is selected. Counts only external files in
  a mixed selection; names the folder for folder imports; silent for locker.
- `WalletActionModal.jsx` / `.css`: rendered between the pickers and the memo
  field so it covers both methods. Uses existing `--status-warning` tokens
  (theme-aware).

**Change 5b — where-the-files-went notice.** `getImportedFilesNotice(totals,
walletName)` appended to the "No funds were added" message. Names
`<wallet>\Imported` always, adds `<wallet>\Counterfeit` when notes were
rejected. This is the piece that directly addresses Pierre's report.

**Known limitations:**

- The `external` flag is computed at selection time, not at submit. Fine in
  practice; not a live check.
- The flag only comes from the native pickers. Any code path that sets
  `selectedFiles`/`selectedFolder` without going through
  `pickCoinFilesFromDisk`/`pickCoinFolderFromDisk` (drag-and-drop, a resumed
  session) yields entries with no `external` field, treated as internal, no
  warning. I found no such path by reading, but did not exercise the UI.

---

## Verification performed

| Check | Result |
|---|---|
| `gcc -fsyntax-only` on both core files | clean (gcc verified to report errors on a deliberate bad file) |
| MSVC build, `build-msvc`, system CMake 4.2 | `core.exe` links |
| `cmd_convert.c`, `cmd_deposit.c`, `main_rest.c` force-recompiled | **zero warnings** |
| `qmail_sdk_abi_check` | PASS |
| `qmail_sdk_link_check` | clean |
| GUI unit tests | 271 passing / 26 files (up from 261) |
| `node --check electron.cjs` | clean |
| `vite build` | 1813 modules, clean |

Pre-existing warning at `cmd_deposit.c:404` (`strdup` deprecation) is not mine
and was left alone.

**Build note:** `BUILD.md` warns the two CMake installations on this machine
are not interchangeable. `build-msvc` was configured by system CMake 4.2
(verified via `CMAKE_CACHE_MAJOR_VERSION`), which is what I used.

---

## What has NOT been verified — read this before approving

**Nothing in this change set has been run end-to-end against real coins and
real RAIDAs.** Everything above is compile-time and unit-level.

Specifically unexercised:

1. **The entire convert recovery reader.** It only executes on failure paths.
   No journal has been written by a real interrupted convert and then read
   back.
2. **The reordered write-ahead path.** No crash has been injected between
   Step 1.5 and Step 2.
3. **The widened fallback guard.** No bad-helper-coin scenario has been
   reproduced.
4. **First-run CCv1/CCv2 deposit itself** — the original question — has not
   been run once against this code.
5. **The GUI move warning** has not been seen rendered in the running app.

**Minimum bar I would want before shipping:** fault-injected convert runs (kill
the process between Steps 1.5/2 and between Steps 2/4), verifying the reader
reaches the correct disposition for each. That needs real coins against real
RAIDAs.

---

## Still open — deliberately not addressed

- **Move-before-auth product decision.** Resolved as "keep moving, add
  transparency" (Change 5). If the reviewer disagrees, the alternative is
  copy-then-delete-on-success for external sources, which violates the
  stated no-two-copies invariant.
- **Journal encryption.** Option A (plaintext) chosen. See Change 4.
- **`Recovery/` orphan sweep.** Journals that can never be resolved (RAIDA
  permanently gone) accumulate. No age-based cleanup exists.
