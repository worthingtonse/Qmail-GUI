# Test Plan: First-Run Import, Convert Recovery, Import Transparency

**Companion to:** `claude.first-run-import-fixes.md`
**Date:** 2026-08-11
**Status:** Environment surveyed, harness ready. Awaiting coin locations from Sean.

---

## What I found on this machine

| Item | State |
|---|---|
| `gui/backend/Client_Data/Wallets/` | `Default` and `Mail` registered |
| `Default/Bank`, `Fracked`, `Counterfeit`, `Limbo`, `Imported`, `Suspect`, `Pending`, `Recovery`, `Grade` | **all empty** |
| `Default/Import/` | contains only empty `CCv1/` and `CCv2/` subfolders — no stray coins |
| `gui/backend/core.exe` | **Aug 5, 2395136 bytes — six days STALE** |
| `core/build-msvc/Release/core.exe` | Aug 11, 2404352 bytes — my build, with all changes |

**Two things to note before we start.**

1. **The deployed core.exe does not contain any of my changes.** Testing
   through the GUI as-is would test the Aug 5 binary. We need to either deploy
   my build or point the test at it directly. See "Deploying the new core"
   below — I have NOT done this yet because it overwrites a file the GUI
   depends on, and that is your call.

2. **The existing Default wallet is empty of value but is a real registered
   wallet.** I would rather not use it. The plan below creates a separate test
   wallet so your live setup is untouched.

---

## What I need from you

1. **Paths to CCv1 (`.stack`), CCv2 (`.bin`), and CCv3 (`.bin`) coins.**
   Small denominations are fine — a handful of 1 CC notes per type is plenty.

2. **Confirm these are expendable test coins.** Deposit is a MOVE. Anything I
   point it at leaves its current folder. If they are the only copies, please
   copy them to a scratch folder first and give me that path — or tell me to
   make the copy myself.

3. **Whether RAIDA is reachable right now.** Several tests need live servers.
   If the network is degraded, results will be ambiguous (that is exactly the
   Limbo case) and we should wait rather than misread it.

4. **A decision on deploying the new core.exe** (see below).

---

## Deploying the new core

Three options, your pick:

| Option | Command | Effect |
|---|---|---|
| **A. Repo-confined build** (recommended) | `cmake -S . -B build-gui -DQMAIL_GUI_DIR=D:/Code/p2/gui` then `cmake --build build-gui --config Release --target core` | Writes `gui/backend/core.exe` via the documented path in `BUILD.md`. Uses **Android SDK cmake 3.22** — that tree's configured generator |
| **B. Manual copy** | back up `gui/backend/core.exe`, then copy from `build-msvc/Release/` | Fastest; bypasses the deploy target |
| **C. Run core standalone** | run `build-msvc/Release/core.exe` from a scratch dir, drive it over HTTP | Never touches the GUI at all — best for the core-only tests below |

I suggest **C for tests 1-6** (core behavior, no GUI needed) and **A for tests
7-8** (the GUI-facing changes). C keeps your deployed binary untouched while we
validate the risky core changes.

`BUILD.md` warns the two CMake installs are not interchangeable — `build-gui`
is a 3.22 tree, `build-msvc` is a 4.2 tree. I will use the right one for each.

---

## Test matrix

Ordered so cheap/safe tests run before destructive ones.

### Test 1 — Baseline: empty wallet, CCv3 deposit
**Covers:** nothing new; confirms the harness and RAIDA connectivity work.
**Setup:** fresh test wallet, no coins anywhere.
**Action:** deposit CCv3 coins.
**Expect:** POWN SUM unencrypted path (empty wallet -> no helper coin), coins
land in Bank. Log shows `POWN phase: No encryption key available, using POWN
SUM (unencrypted)`.
**Fails if:** anything other than a clean Bank result — stop and diagnose
before continuing.

### Test 2 — First-run CCv1 deposit (the original question)
**Covers:** legacy park -> convert -> grade on an empty wallet; Change 2's
unencrypted retry.
**Setup:** fresh test wallet, completely empty.
**Action:** deposit `.stack` CCv1 files.
**Expect:** files park to `Import/CCv1/`, Phase 5 UPGRADE runs, convert
succeeds, converted CCv3 notes graded to Bank.
**Log lines to capture:**
- `Legacy coins detected: N CCv1, 0 CCv2`
- **NEW:** `UPGRADE: used encrypted mode (error N, converted=N)` **or**
  `UPGRADE: encrypted convert failed (error N) with nothing converted,
  retrying with ENC_TYPE_NONE`
- `UPGRADE: converted=N expired=N counterfeit=N`

This is the single most important test — it is the question that started all
of this, and it has never been run against this code.

### Test 3 — First-run CCv2 deposit
Same as Test 2 with CCv2 `.bin` files. Expect `Import/CCv2/` parking and
`SHARD_ID_LEGACY_CC2` handling.

### Test 4 — Mixed deposit
**Covers:** CCv3 + CCv1 + CCv2 in one folder — the realistic "point at my old
wallet folder" case.
**Expect:** CCv3 goes through POWN, legacy parks and converts, all graded. No
interference between paths.

### Test 5 — Journal written BEFORE the switch (Change 3)
**Covers:** the write-ahead reordering — the core claim of Change 3.
**Method:** deposit legacy coins and, during Phase 5, check for
`<wallet>/Recovery/*.bin` **while the convert is still in flight**. Because
convert can be fast, the reliable version is to watch the folder in a tight
loop from a second shell, or temporarily point at an unreachable RAIDA so
Step 2 hangs.
**Expect:** a journal file exists on disk before SwitchShard returns, and it is
430*N + 404 bytes.
**Expect on success:** journal deleted at the end.

### Test 6 — Fault injection: kill mid-convert (Change 4, the big one)
**Covers:** the entire recovery reader. **This is the test that matters most
for the riskiest change.**

**6a — kill between Step 1.5 and Step 2** (journal written, switch not sent):
- Kill core during Phase 5 before the network call.
- Restart core.
- **Expect:** boot log `Found N convert recovery journals`, then the reader
  probes, finds the CCv3 coins were never issued -> graded Counterfeit, legacy
  originals still in `Import/CCv1/` for a retry, journal deleted.

**6b — kill between Step 2 and Step 4** (switch landed, coins not written):
- Harder to time; may need a deliberate delay inserted before Step 4.
- **Expect:** reader probes, finds the CCv3 coins ARE authentic, writes them to
  `Grade/`, grades to Bank. **This is the coin-loss case the whole reordering
  exists to fix** — before this change these coins were gone.

**6c — RAIDA unreachable at recovery time:**
- Leave a journal, restart with the network down.
- **Expect:** `detect failed ... journal RETAINED for a later attempt`, journal
  still on disk, nothing disposed. Restart with network up -> resolves.

**Note:** I may need to add a temporary debug delay or kill-switch to core to
make 6a/6b reliably reproducible. I would add it behind an env var, test, then
remove it before any commit — with your approval first.

### Test 7 — GUI: onboarding no longer dead-ends (Change 1)
**Covers:** the Pierre scenario.
**Setup:** fresh Client_Data so the GUI shows first-run onboarding; coins that
will fail (counterfeit, or a folder with no valid coins).
**Expect:** "No funds were added to the Default wallet." **plus the new
notice** naming `Default\Imported`. Import controls **stay enabled**. Footer
does **not** become "Retry Identity Setup". No 422 in the log.
**Before this change:** controls locked, 422 fired, only "Retry Identity Setup"
offered, which failed forever.

### Test 8 — GUI: import move warning (Change 5)
**Covers:** the pre-import warning.
- Select files from a folder **outside** Client_Data -> warning appears, names
  the count.
- Select a **folder** outside Client_Data -> warning names the folder.
- Select something **inside** Client_Data -> **no warning**.
- Locker method -> **no warning**.
- Mixed selection -> count reflects only the external files.

Also worth eyeballing: how it renders with a long folder name, and in both
light and dark themes.

---

## Harness

I have written `docs/claude.import-test.sh` to reduce this to a few commands.
It does **not** run anything destructive on its own — every deposit requires an
explicit path argument from you.

```bash
# start the freshly-built core against an isolated data dir
bash docs/claude.import-test.sh start

# create + register a clean test wallet
bash docs/claude.import-test.sh new-wallet TestImport

# snapshot every folder's coin count
bash docs/claude.import-test.sh snapshot TestImport

# deposit (MOVES the files — pass a scratch copy)
bash docs/claude.import-test.sh deposit TestImport /path/to/coins

# watch Recovery/ during a convert (Test 5)
bash docs/claude.import-test.sh watch-recovery TestImport

# tail the interesting log lines
bash docs/claude.import-test.sh logs

bash docs/claude.import-test.sh stop
```

---

## What I will record for each test

- Full `main.log` excerpt for the task
- Folder counts before/after (`snapshot`)
- The specific new log lines from Changes 2/3/4
- Receipt JSON where one is produced
- Pass/fail against the stated expectation

I will report failures exactly as they occur, including any that show my
changes are wrong.

---

## Risks I want to flag before we start

1. **Deposit is a MOVE.** Every coin I point the harness at leaves its source
   folder. I will not run any deposit against a path you have not explicitly
   given me for that purpose.

2. **Tests 6a/6b may need temporary instrumentation in core.** I will ask
   before adding it and remove it afterward.

3. **Old-format journals.** If any `Recovery/*.bin` exists from a build before
   Change 3, the new reader will log it as unreadable and leave it. That is by
   design, but do not mistake it for a bug. All Recovery folders here are
   currently empty, so this should not arise.

4. **If RAIDA is degraded, results are ambiguous.** Coins landing in Limbo
   during a network problem is correct behavior, not a failure of these
   changes. Worth confirming network health before Test 2.
