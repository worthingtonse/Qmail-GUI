# QMail theme — visual smoke-test checklist

Tracks visual verifications that automated tests can't cover. Build /
lint / unit tests are gated by CI commands; this file is for the
"does it actually look right in the running app?" pass.

Scope: the theme work (P0–P5, Track B, E-tracks). Out of scope: unrelated
usability / QMail-app smoke tests.

---

## How to use this file

1. **Pick a section.** Sections are grouped by track. Each step has a
   golden-path test and 1–2 error-path tests where a silent regression
   would be costly.
2. **Run the steps in `npm run dev`** (or the Electron build, where
   noted).
3. **Mark each step** by replacing `PENDING` with `PASS YYYY-MM-DD <name>`
   on success, or `FAIL YYYY-MM-DD <name> — <one-line cause>` on
   failure. Push the file in the same commit as the fix if a FAIL
   leads to follow-up code.
4. **Mark the row in `theme.status.txt`** as smoke-verified once every
   step in the section reads PASS.

A step that turns out to be invalid (e.g. behaviour was deliberately
changed) gets edited in place with a note, not deleted.

Date convention: ISO 8601 (`2026-05-23`).
Observer: short name / handle / model (e.g. `sean`, `gpt`, `opu`).

---

## P0 — Phase 0 plumbing (commit `0b8a563`)

Verifies the FOUC-prevention script and the token/theme CSS plumbing.

| # | Step | Status |
|--:|------|--------|
| P0.1 | First-load with empty localStorage on a system set to **dark** OS preference. Expect: page paints in dark immediately, no flash of light/unstyled content. | PENDING |
| P0.2 | First-load with empty localStorage on a system set to **light** OS preference. Expect: page paints in light immediately. | PENDING |
| P0.3 | Inspect `<html>` in DevTools after load — confirm `data-theme="dark"` (or `light`) is set before React mounts. | PENDING |
| P0.4 | **Error path:** disable JavaScript in the browser. Expect: page still loads with `data-theme="dark"` because the inline FOUC script is a `<script>` tag that runs before JS-disabled blocks the rest. Actually — this is informational only; the app needs JS to function, but the FOUC behaviour shouldn't crash the page. | PENDING |

---

## P1 — Phase 1 ThemePicker + provider (commit `0b8a563`)

Verifies the picker UI and the dark↔light↔high-contrast switching.

| # | Step | Status |
|--:|------|--------|
| P1.1 | Open Account → Application Settings. Expect: the ThemePicker fieldset is visible with Dark / Light / High Contrast / Custom radio rows. | PENDING |
| P1.2 | Click each of Dark, Light, High Contrast. Expect: the theme changes immediately; `<html data-theme>` updates; the radio's selected state follows. | PENDING |
| P1.3 | Reload after picking Light. Expect: page paints in light theme (FOUC script reads localStorage). | PENDING |
| P1.4 | **Error path:** open DevTools, clear `localStorage.qmail.theme`, reload. Expect: theme falls back to OS preference (matches P0.1/P0.2). | PENDING |
| P1.5 | **Error path:** set `localStorage.qmail.theme = "midnight"` (an invalid id), reload. Expect: provider rejects the invalid id and falls back to OS preference / dark. | PENDING |

---

## P2 (a) — High-contrast functional refinements (commit `4665ff4`)

Verifies focus rings, scrollbars, glow suppression, motion collapse,
particle suppression.

| # | Step | Status |
|--:|------|--------|
| P2a.1 | Switch to High Contrast. Tab through the page (Account, NavigationPane, etc.). Expect: every focusable element shows a thick yellow outline (3px). No purple/blue rgba glow halos. | PENDING |
| P2a.2 | Hover an interactive element. Expect: no transition; the change is instant (motion-scale 0). | PENDING |
| P2a.3 | Inspect `body::after` in DevTools. Expect: `opacity: 0` (particles hidden); no colour smear on the black background. | PENDING |
| P2a.4 | Scroll a long pane. Expect: scrollbar thumb is solid white against the black track. | PENDING |
| P2a.5 | Focus a text input. Type. Expect: caret is yellow (`#ffff00`). | PENDING |
| P2a.6 | Find a status banner (success/error/warning/info) — easiest path is to trigger one via the notification system, e.g. save then revert a setting. Expect: banner background is solid black with a coloured border, not a faint rgba tint. | PENDING |
| P2a.7 | **Error path:** open with OS reduced-motion preference ON, then switch to Dark. Expect: motion stays collapsed (the @media block in tokens.css forces `--motion-scale: 0` regardless of theme). | PENDING |

---

## P2 (b) — WCAG palette swap (commit `fd0187d`)

Verifies the light-theme contrast fixes and the HC error-red bump.
Numbers were re-audited by script; this checks the visual result.

| # | Step | Status |
|--:|------|--------|
| P2b.1 | Switch to Light theme. Look at any primary-coloured button (e.g. Save in the ThemeEditorModal). Expect: deeper purple `#5b21b6`, white label clearly readable. | PENDING |
| P2b.2 | Find a secondary-accent element (e.g. a link, an info icon). Expect: deep blue `#075985`, clearly readable on white. | PENDING |
| P2b.3 | Trigger a success banner / button (e.g. successful save). Expect: deep emerald `#065f46` (not the previous lighter green); white text readable on top. | PENDING |
| P2b.4 | Trigger an error banner. Expect: dark red `#991b1b` (more grounded than the previous fire-red); white text readable. | PENDING |
| P2b.5 | Inspect a tertiary text element (timestamps, secondary labels). Expect: slate-600 `#475569` — visibly darker than the prior `#64748b`. | PENDING |
| P2b.6 | Inspect a "muted" element (e.g. a placeholder or low-priority hint). Expect: visible but de-emphasised — still distinguishable from `--text-secondary`. | PENDING |
| P2b.7 | Switch to High Contrast. Trigger an error state. Expect: error red is `#ff6666` (barely distinguishable from the previous `#ff5555`; the change is for AAA, not aesthetics). | PENDING |
| P2b.8 | **Error path:** screenshot a Light-theme screen + drop it into a WCAG checker (or use DevTools' built-in contrast inspector on a button label). Expect: AAA at 7:1+ on every accent label. | PENDING |

---

## P3 — Custom theme runtime + editor (commit `18d5d03`)

Verifies the ThemeEditorModal, the save/clear flow, and the `<style id="qmail-user-theme">` injection.

| # | Step | Status |
|--:|------|--------|
| P3.1 | Open Account → Settings → Custom radio's **Edit** button. Expect: modal opens; 8 controls (4 colours, radius, font-scale, glass-blur, motion-scale); current document values pre-fill each control. | PENDING |
| P3.2 | Change the accent-primary colour to lime (`#22c55e`). Click Save. Expect: modal closes; the picker now shows Custom selected; lime appears on every primary-accent element instantly. | PENDING |
| P3.3 | Reload the page. Expect: the lime theme persists (custom file is fetched from server). | PENDING |
| P3.4 | Reopen the modal. Click Reset. Confirm the prompt. Expect: theme reverts to base (dark or whichever you started from); custom slot is empty. | PENDING |
| P3.5 | Inspect `<head>` while a custom theme is active. Expect: a `<style id="qmail-user-theme">` tag with the overrides. After Reset, the tag is gone. | PENDING |
| P3.6 | Toggle the "Reduced motion" a11y checkbox; save. Expect: every transition in the app collapses (`--motion-scale: 0`). | PENDING |
| P3.7 | Toggle the "Large print" a11y checkbox; save. Expect: type scales up to 125%. | PENDING |
| P3.8 | **Error path:** with DevTools open, manually place a malformed JSON in `localStorage.qmail.theme = "custom"` then ensure server has a corrupted custom_theme.txt (paste invalid JSON via the system endpoint). Reload. Expect: GUI falls back to base theme without crashing; console shows a one-time warning. | PENDING |
| P3.9 | **Error path:** in the editor, attempt to set a name with 100 characters. Expect: input truncates at 64. | PENDING |

---

## P5 — Export / Import (commit `d4ed744`)

Verifies the Blob-download export, the file-input import, and the
validation reuse.

| # | Step | Status |
|--:|------|--------|
| P5.1 | Open the editor, change accent-primary to red, click Export. Expect: a file `qmail-theme-my-theme.json` (or similar based on name) downloads. Open it; confirm it's pretty-printed JSON with `schema: "qmail-theme/1"`, the changed token, and the unchanged defaults. | PENDING |
| P5.2 | Without saving, close the modal. Reopen, click Import, pick the file you just exported. Expect: editor populates from the file (red accent appears in the preview controls). Click Save. Expect: theme applies. | PENDING |
| P5.3 | Edit the exported file by hand: change `--accent-primary` to `#22c55e`. Save the file. In the editor, Import it. Expect: hand-edited value lands in the editor. | PENDING |
| P5.4 | **Error path:** create a file with invalid JSON (e.g. drop a closing brace). Import. Expect: the editor's error banner shows "Imported file is not valid JSON: ..." — no draft replacement happens. | PENDING |
| P5.5 | **Error path:** create a file with `"--accent-primary": "#fff; background:url(x)"` (semicolon injection). Import. Expect: the error banner shows "Imported theme failed validation: ... value contains forbidden sequence ';'" — no draft replacement. | PENDING |
| P5.6 | **Error path:** create a file with `"base": "midnight"`. Import. Expect: the error banner rejects the unknown base. | PENDING |

---

## Phase 4 E-tracks (commits TBD per file)

Each E-track ships per plan §12.4. The smoke test for an E-track is
the same shape: open the screen the file styles, toggle dark / light /
high-contrast / custom, confirm the screen still looks correct under
each. Add a row when an E-track lands.

| # | Track | File | Status |
|--:|------|------|--------|
| E.smoke.1 | E1 | wallet/components/MainDashboard.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.2 | E2 | wallet/components/tabs/ExportTab.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.3 | E3 | wallet/components/tabs/AuthenticateTab.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.4 | E4 | wallet/components/tabs/LockerTab.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.5 | E5 | qmail/screens/AccountPane.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.6 | E6 | App.css (+ update-modal extract) | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.7 | E7 | screens/ServiceSelectionScreen.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.8 | E8 | qmail/screens/ComposeModal.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.9 | E9 | qmail/screens/EmailListPane.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.10 | E10 | wallet/components/DicewarePasswordCreator.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.11 | E11 | qmail/screens/ContactsPane.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.12 | E12 | qmail/screens/QMailDashboard.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.13 | E13 | qmail/screens/ReadingPane.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.14 | E14 | qmail/screens/NavigationPane.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.15 | E15 | wallet/components/PasswordScreen.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.16 | E16 | components/common/notifications/NotificationContainer.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.17 | E17 | wallet/components/USBCheckScreen.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.18 | E18 | qmail/screens/AddContactModal.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.19 | E19 | wallet/components/tabs/ReceiptModal.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.20 | E20 | wallet/components/WelcomeScreen.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.21 | E21 | qmail/screens/WalletSetupScreen.css | PENDING (status row REVIEWED; smoke pending) |
| E.smoke.22 | E22 | index.css cleanup pass | PENDING (status row REVIEWED; smoke pending) |

For each E-track, the smoke check is:

1. Open the screen the CSS file styles.
2. Toggle Dark → Light → High Contrast → Custom (with a saved custom theme).
3. For each: visual diff against the screen pre-E-track. Allow Phase-4
   intentional changes (BEM rename, token-driven values), reject any
   change that visibly degrades the look.
4. Verify the §12.4 acceptance criteria already pass:
   `rg '#[0-9a-fA-F]{3,8}\b|rgba\(' <file>` → empty,
   `rg 'font-size:\s*[0-9.]+(px|rem|em)' <file>` → empty.

---

## Cross-cutting checks (any theme commit)

| # | Step | Status |
|--:|------|--------|
| X.1 | Build size sanity: `npm run build` reports ≤ 250 KB CSS gzipped + ≤ 130 KB JS gzipped. (Current: ~32 KB CSS / ~119 KB JS.) | PENDING |
| X.2 | Lint: `npx eslint src/ --max-warnings 0` is clean. | PENDING |
| X.3 | Unit tests: `npm test` is 30/30 (or higher). | PENDING |
| X.4 | First-paint check (DevTools Performance tab): the FCP under Dark/Light/HC is within 100ms of each other. (HC has fewer effects so may be faster — that's fine; just no theme should be > 1s slower than the others.) | PENDING |

---

## Failure protocol

When a smoke step FAILs:

1. Write `FAIL YYYY-MM-DD <observer> — <one-line cause>` in the Status cell.
2. Open an issue or write a follow-up commit. Reference the failing
   step in the commit message: e.g. `Fix focus ring colour (P2a.1)`.
3. After the fix lands and the step is re-run, replace with
   `PASS YYYY-MM-DD <observer>` and link the fix commit in a "Fixed by:"
   note appended to the cell.

---

## Related

- `docs/opu.theme.plan.txt` — the master plan; per-phase acceptance criteria.
- `docs/theme.status.txt` — work-claim tracker.
- `docs/theme.wcag-values.md` — measured contrast ratios (gates P2 (b)).
- `docs/theme.custom-format.md` — JSON format reference (gates P5 power users).
