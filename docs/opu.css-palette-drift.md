# CSS palette drift analysis (Phase 2.1 deferred — replaced by this doc)

**Date:** 2026-05-23
**Author:** Claude Opus 4.7 (1M context)
**Sources:** `docs/css-audit/literal-map.md`, `docs/css-audit/clusters.md`,
hand-grep of E1–E7 files
**Replaces:** Phase 2.1 mechanical colour sweep (planned in
`docs/opu.css-refactor.txt` v2.5 §4)

---

## Why this doc exists (and why Phase 2.1 didn't ship as a swap commit)

The plan v2.5 §4 sized Phase 2.1 at ~3 hours, framing it as a mechanical
`raw-colour → token` find-and-replace across E1–E7. The Phase 0 audit's
`literal-map.md` was the input.

After choosing the **conservative scope** (only swap clear matches to
existing tokens, no new tokens), the actual mappable surface turned
out to be:

> **One swap**: `#1a1f2e` in `App.css:616` (`.update-modal { background-color }`) → `var(--primary-bg-mid)` (which itself isn't a real CSS token — see §4.1).

That's not a sweep, that's a token-naming question. The reason is that
the dirty E1–E7 files use **a different colour palette** than the
runtime tokens. They're not just unmigrated — they're from an earlier
design system that diverges from the current accent palette in roughly
parallel ways (different purples, different greens, different
slates, etc.).

So Phase 2.1 as written can't be done conservatively. This doc
catalogues the drift, proposes a "lineage wins" decision per colour
family, and queues per-cluster work for Phase 3 (primitive extraction)
to consume.

---

## §1 The current token palette (runtime — `src/styles/tokens.css`)

These are the colours that win whenever a file uses `var(--token)`. They
are the AAA-verified set from Track B / commit `fd0187d`.

| Token                | Value (dark)   | Role                     |
| -------------------- | -------------- | ------------------------ |
| `--primary-bg`       | gradient       | full-page background     |
| `--secondary-bg`     | `#151921`      | card / panel surface     |
| `--accent-primary`   | `#a78bfa`      | primary accent (purple)  |
| `--accent-secondary` | `#7dd3fc`      | secondary accent (sky)   |
| `--accent-tertiary`  | `#fbbf24`      | tertiary accent (amber)  |
| `--accent-success`   | `#34d399`      | success (emerald)        |
| `--accent-error`     | `#f87171`      | error (coral)            |
| `--accent-warning`   | `#fbbf24`      | warning (amber)          |
| `--text-primary`     | `#f8fafc`      | dominant text            |
| `--text-secondary`   | `#cbd5e1`      | secondary text           |
| `--text-tertiary`    | `#94a3b8`      | muted text               |

Light + high-contrast variants exist in `src/styles/themes.css`.

---

## §2 The drifted palette in E1–E7 (by hue family)

Per-hex occurrences in the 7 dirty files. Total raw hex occurrences:
145. Of those, **1** matches a current token. The other **144** form a
parallel palette below.

### 2.1 Purples (current token: `#a78bfa`)

| Drifted value | Hits | Files                                      |
| ------------- | ---: | ------------------------------------------ |
| `#8b5cf6`     | 11 | App, MainDashboard, ExportTab, Authenticate, LockerTab |

Both `#a78bfa` and `#8b5cf6` are Tailwind violet-400 and violet-500
respectively. Half a tier apart. Visually distinguishable but in the
same family.

**Proposal:** `#8b5cf6` → `var(--accent-primary)`. Visual diff is
"slightly lighter purple"; acceptable.

### 2.2 Greens (current token: `#34d399`)

| Drifted value | Hits | Notes                                           |
| ------------- | ---: | ----------------------------------------------- |
| `#10b981`     | 10 | Tailwind emerald-500 (token is emerald-400)        |
| `#28a745`     |  2 | Bootstrap success green                            |
| `#0d9488`     |  1 | Inside a gradient; teal-600                        |
| `#0f766e`     |  1 | Inside a gradient; teal-700                        |
| `#059669`     |  1 | Inside a gradient; emerald-600 (Track B's LIGHT-theme token) |

**Proposal:**
- `#10b981` → `var(--accent-success)`. Half-tier difference; acceptable.
- `#28a745` → `var(--accent-success)`. Bootstrap legacy; collapse.
- The teal gradients are component-specific (different visual intent
  than "success"); flag for Phase 3 primitive review, NOT swap to
  `--accent-success`.

### 2.3 Reds (current token: `#f87171`)

| Drifted value | Hits | Notes                                  |
| ------------- | ---: | -------------------------------------- |
| `#ef4444`     |  8 | Tailwind red-500 (token is red-400)       |
| `#dc3545`     |  3 | Bootstrap danger red                      |
| `#c82333`     |  2 | Bootstrap danger:hover red                |

**Proposal:**
- `#ef4444` → `var(--accent-error)`. Half-tier; acceptable.
- `#dc3545`, `#c82333` → `var(--accent-error)`. Bootstrap legacy; collapse.

### 2.4 Ambers / yellows (current token: `#fbbf24`)

| Drifted value | Hits | Notes                                   |
| ------------- | ---: | --------------------------------------- |
| `#f59e0b`     |  4 | Tailwind amber-500 (token is amber-400)    |
| `#ffc107`     |  2 | Bootstrap warning                          |
| `#fff3cd`     |  3 | Bootstrap warning-bg (light pastel)        |
| `#856404`     |  2 | Bootstrap warning-text (dark on light bg)  |

**Proposal:**
- `#f59e0b`, `#ffc107` → `var(--accent-warning)`. Collapse.
- `#fff3cd` + `#856404`: these are a paired light-bg + dark-text combo
  for warning notices. Genuinely **NOT** mappable to existing tokens
  (the current theme has no "light warning surface" token). Flag for
  Phase 3 — likely deserves a `.status-message--warning` primitive.

### 2.5 Blues / cyans (current token: `#7dd3fc`)

| Drifted value | Hits | Notes                                          |
| ------------- | ---: | ---------------------------------------------- |
| `#3b82f6`     |  5 | Tailwind blue-500. NOT in current palette.        |
| `#2563eb`     |  5 | Tailwind blue-600. Pairs with `#3b82f6` in gradients. |
| `#4a90e2`     |  8 | Custom blue. ServiceSelectionScreen + MainDashboard.  |
| `#357abd`     |  4 | Pairs with `#4a90e2` (hover/active tone).             |
| `#60a5fa`     |  2 | Tailwind blue-400                                     |
| `#0ea5e9`     |  2 | Tailwind sky-500 (close to token `#7dd3fc` = sky-300)|
| `#1e40af`     |  1 | Inside a gradient; blue-800                           |

This is the messiest family. Three distinct "blue" lineages co-exist:

1. **Sky tokens** (existing): `#7dd3fc` (`--accent-secondary`)
2. **Tailwind blue scale**: `#3b82f6`/`#2563eb` family
3. **Custom blue scale**: `#4a90e2`/`#357abd` family

**Proposal:**
- `#0ea5e9` (sky-500, only 2 hits) → `var(--accent-secondary)`. Collapse.
- The `#3b82f6`/`#2563eb` and `#4a90e2`/`#357abd` families are *button
  gradients* in their contexts (e.g. CTAs). They're not equivalent to
  `--accent-secondary` (which is used for info badges, not CTAs). Flag
  for Phase 3 — likely deserve a `.btn--primary-blue` primitive or
  similar, NOT a token swap.

### 2.6 Slates / neutrals (current tokens: `#cbd5e1`, `#94a3b8`)

| Drifted value | Hits | Notes                                  |
| ------------- | ---: | -------------------------------------- |
| `#556c7c`     | 13 | Paired in a disabled-button gradient      |
| `#4a5f6e`     | 13 | Pairs with `#556c7c` (gradient end)       |
| `#333`        |  7 | Inline-block hint text (MainDashboard)    |
| `#ddd`        |  4 | Light border / divider                    |
| `#ccc`        |  4 | Slightly darker border                    |
| `#666`        |  4 | Generic muted text                        |
| `#95a5a6`     |  1 | Bootstrap "secondary text"                |
| `#e9ecef`     |  5 | Bootstrap light surface                   |
| `#f8f9fa`     |  3 | Bootstrap very-light surface              |

**The `#556c7c / #4a5f6e` gradient is the DISABLED-BUTTON pattern**,
repeated 13× across the 5 files. This is a clear primitive candidate
for Phase 3 — almost certainly becomes
`.btn[disabled] { background: ... }` in `primitives.css`.

**Proposal:**
- `#666` (hint text, 4 hits) → `var(--text-tertiary)`. Same logic as
  Phase 0.5's `#666` extraction.
- `#333` → `var(--text-primary)` IF dark-theme-specific, OR flag for
  Phase 3 if it's a light-theme-on-light-surface choice.
- `#ddd`, `#ccc` → likely `var(--border-medium)` / `var(--border-subtle)`
  but need site-by-site review.
- The `#556c7c / #4a5f6e` gradient and `#e9ecef`/`#f8f9fa` Bootstrap
  surfaces: Phase 3 primitive layer.

### 2.7 Pure colours

| Value      | Hits | Verdict                                   |
| ---------- | ---: | ----------------------------------------- |
| `white`    |  42  | Keep as literal (user decision — see plan §7) |
| `#ffffff`  |   1  | Normalise to `white` for consistency      |

---

## §3 The Bootstrap echo

A clear signal in §2: at least 8 of the drifted colours
(`#28a745`, `#dc3545`, `#c82333`, `#ffc107`, `#fff3cd`, `#856404`,
`#95a5a6`, `#e9ecef`, `#f8f9fa`) are **Bootstrap 4 / 5** default
values. The codebase was probably scaffolded against a Bootstrap
template before the current token palette was introduced, and these
literals survived the migration.

This isn't drift in the architectural sense — it's residual debt
from a prior framework. Phase 2.1 can't address it cleanly because
the values map to *different concepts* in Bootstrap (warning,
success, danger, light, dark) than in the current token palette.
Phase 3 primitive extraction is the right home: `.status-message`,
`.notice-banner`, etc. own the Bootstrap-like semantics and
internally resolve to the current tokens.

---

## §4 Per-file drift summary

The drift is heavily concentrated:

| File | Hex hits | Top drift |
| --- | ---: | --- |
| `MainDashboard.css` (E1) | 101 | `#8b5cf6`, `#10b981`, `#333`, `#556c7c`+`#4a5f6e` disabled gradient (x4) |
| `ServiceSelectionScreen.css` (E7) | 70 | `#3b82f6`/`#2563eb` + `#4a90e2`/`#357abd` action-button gradients |
| `App.css` (E6) | 54 | The update-modal: `#1a1f2e`, `#3b82f6`, `#2563eb`, `#f59e0b`, `#10b981`, `#ef4444` |
| `AuthenticateTab.css` (E3) | 41 | `#556c7c`+`#4a5f6e` disabled gradient (x5), `#ef4444` for errors |
| `LockerTab.css` (E4) | 33 | Disabled gradient again, `#ef4444` |
| `ExportTab.css` (E2) | 32 | `#8b5cf6` (purple action gradient stops), `#556c7c`+`#4a5f6e` |
| `AccountPane.css` (E5) | 11 | Mostly small; least drifted |

### 4.1 Note on the audit's `--primary-bg-{start,mid,end}` tokens

The audit's `config.json` had three aspirational tokens
(`--primary-bg-start`, `--primary-bg-mid`, `--primary-bg-end`) that
matched the dark-theme gradient stops. These are **not real CSS
tokens** — only `--primary-bg` (the whole gradient) exists in
`tokens.css`.

This produced the misleading "1 exact match" reading on the
audit. Two options:

- **(a)** Remove the aspirational tokens from `config.json`. Drops
  the false-positive but loses the ability to surface "this rule
  is using the middle gradient stop".
- **(b)** Define the three tokens for real in `tokens.css`. Mildly
  useful for solid-overlay surfaces (the update-modal use case),
  but adds three tokens.

My read: **(a)**. The update-modal's `background-color: #1a1f2e`
becomes a Phase 3 question — is the modal's background `--secondary-bg`
(`#151921`, close), or does it deserve a new `--modal-bg` token? Flag
it on the Phase 3 backlog instead of leaving config.json lying about
what's real.

---

## §5 Recommended next steps

1. **Apply §4.1 fix to `config.json`** — drop the three aspirational
   `--primary-bg-{start,mid,end}` tokens. Tiny commit. Re-run audit
   to confirm the literal-map narrows.

2. **Skip Phase 2.1 colour swaps entirely.** The mechanical sweep
   path was the wrong frame. Defer all colour work to Phase 3
   primitive extraction, where the disabled-button gradient, the
   notice-banner pattern, the CTA-button gradient, etc. get proper
   semantic homes.

3. **Proceed to Phase 2.2 (font-size sweep).** Per the literal-map,
   font-size collisions are clean: `0.85rem` × 29 → `var(--font-size-sm)`,
   etc. The user's "10 buckets" instinct applies here: every raw
   font-size maps to one of the existing 6 `--font-size-*` tokens
   within the 5% tolerance, with no design-system drift to wrestle.

4. **Then Phase 2.3 (spacing sweep)** — similarly clean.

5. **Then Phase 3 (primitive extraction)** with rich context: the
   30× outline focus-ring cluster, the 13× disabled-button gradient,
   the 42 cross-file collisions, AND this drift doc all feeding the
   primitive design. The primitives absorb the colour decisions
   that Phase 2.1 couldn't.

6. **Phase 1 (inline tail)** last, with tokens settled.

This trades Phase 2.1's promised mechanical commit for a clearer
overall sequence. The `literal-map.md` from Phase 0 is the contract
for what's left; Phase 3 has the budget to honor it.

---

## §6 Decisions queued for user / GPT

| # | Decision | Default I'd pick |
| - | --- | --- |
| D1 | `#8b5cf6` (11×) → `--accent-primary`? | Yes — Tailwind half-tier, acceptable visual diff |
| D2 | `#10b981` (10×) → `--accent-success`? | Yes |
| D3 | `#ef4444` (8×) → `--accent-error`? | Yes |
| D4 | `#f59e0b` (4×) → `--accent-warning`? | Yes |
| D5 | Bootstrap reds (`#dc3545`, `#c82333`) → `--accent-error`? | Yes — kill Bootstrap echo |
| D6 | Bootstrap greens (`#28a745`) → `--accent-success`? | Yes |
| D7 | Bootstrap ambers (`#ffc107`) → `--accent-warning`? | Yes |
| D8 | `#666` (4×) → `--text-tertiary` (matches Phase 0.5)? | Yes |
| D9 | Bootstrap warning pair (`#fff3cd`/`#856404`) — extract `.notice--warning` primitive in Phase 3? | Yes |
| D10 | `#556c7c`/`#4a5f6e` disabled gradient — extract `.btn[disabled]` rule in Phase 3? | Yes |
| D11 | `#3b82f6`/`#2563eb` + `#4a90e2`/`#357abd` action-button gradients — extract `.btn--primary-blue` (or rename `--accent-secondary` to absorb) in Phase 3? | Decide in Phase 3 |
| D12 | Update modal `#1a1f2e` solid background — define `--modal-bg` token? | Decide in Phase 3 |
| D13 | Aspirational `--primary-bg-{start,mid,end}` in `scripts/css-analysis/config.json` — drop? | Yes |

D1–D8 are conservative mechanical decisions (no new tokens, just
remap drifted values to existing tokens). They could be done in a
single Phase 2.1-bis commit if you want some colour debt reduction
before Phase 2.2.

D9–D12 are Phase 3 primitive-extraction questions.

D13 is housekeeping; one-line config edit.

---

## §7 Open question for the user

If you want to ship a small "drift consolidation" commit now (D1–D8
above), I can do it as Phase 2.1-bis: ~10 swap classes, no new tokens
added, ~36 raw hex literals eliminated. Visual diff will be subtle
(half-tier shifts across purples/greens/reds/ambers), worth a
visual smoke after.

If you'd rather defer all colour work to Phase 3, that's also clean —
the Phase 0 audit + this doc give Phase 3 everything it needs.

The framing question is whether D1–D8 deliver enough value to be worth
a separate commit, or whether they should ride into Phase 3 along
with D9–D12.

---

## §8 Post-GPT-review corrections (2026-05-23)

GPT reviewed §6's recommendations and pushed back hard on D1–D3. After
re-checking against live CSS, **GPT was right on two counts**.

### 8.1 D1–D3 are NOT safe blanket remaps (gradient-stop pattern)

The drifted purples/greens/reds aren't standalone literals in most
places — they're the **end-stop of two-tone gradients** that already
START with the current token. Pattern looks like:

    background: linear-gradient(135deg, var(--accent-primary) 0%, #8b5cf6 100%);
    background: linear-gradient(135deg, var(--accent-success) 0%, #10b981 100%);
    background: linear-gradient(135deg, var(--accent-error) 0%, #ef4444 100%);

Verified live-CSS hit counts in E1–E7 (from grep across non-commented
declarations):

  D1 `#8b5cf6` → `--accent-primary`     **11 of 11** are gradient-stop pairs
  D2 `#10b981` → `--accent-success`      **8 of 10** are gradient-stop pairs
  D3 `#ef4444` → `--accent-error`        **8 of 8** are gradient-stop pairs

Blanket-remapping would **collapse a two-tone gradient into a
single-colour gradient**. Every primary button, every success banner,
every error toast loses its visual depth. Material visual regression,
not "half-tier shift" as §6 framed it.

**Revised verdict on D1–D3:** defer to Phase 3 primitive extraction.
The right home is a `.btn--primary-gradient` (or similar) primitive
that internally encodes the gradient. The token+drift pair becomes
a *single* component-level choice instead of an app-wide swap.

There are 2 standalone `#10b981` sites (the gradient pairs cover 8 of
the 10 hits in the literal-map). These could be remapped individually,
but it's not worth a separate commit — Phase 3 will see them.

### 8.2 D5–D7 are mostly dead code in comments

GPT also noticed that `MainDashboard.css` contains commented-out legacy
CSS that grep picks up but the audit (parsed declarations) does not.
Cross-checked against `docs/css-audit/literal-map.md`:

  Value      grep count   audit count   verdict
  ---------- ----------   -----------   --------------------------
  #dc3545          3          0         all 3 commented
  #c82333          2          0         all 2 commented
  #28a745          2          0         all 2 commented
  #ffc107          2          0         all 2 commented
  #fff3cd          3          1         2 of 3 commented
  #856404          2          1         1 of 2 commented
  #95a5a6          1          1         live

So D5–D7 are largely chasing dead code. The real Bootstrap-echo live
debt is just `#fff3cd`/`#856404` (the warning notice pair) plus
`#95a5a6` (one site).

**Revised verdict on D5–D7:** also defer. `#fff3cd`/`#856404` are the
notice-banner primitive (D9 territory). `#95a5a6` is one site — too
small for its own decision.

### 8.3 What survives the corrections

  D4  `#f59e0b` → `--accent-warning`    4 live, all standalone `color:` uses, no gradient pairs. **Safe to swap.** Smoke-check recommended.
  D8  `#666`   → `--text-tertiary`     4 live `color:` uses in MainDashboard.css. **Safe to swap.** Same logic as Phase 0.5.
  D13 drop aspirational primary-bg-* from `scripts/css-analysis/config.json`. **Ship immediately.**

D1–D3, D5–D7, D9–D12 all defer to Phase 3.

So the post-correction Phase 2.1-bis surface is **8 raw literal
swaps** (not the ~36 §6 implied):
- 4× `#f59e0b → var(--accent-warning)`
- 4× `#666 → var(--text-tertiary)`

That's small enough to skip as its own commit and roll into Phase 3
or a later cleanup pass. GPT's recommendation is to **skip the colour
commit entirely** and move to Phase 2.2 (font-size sweep), which has
much cleaner cluster signal and no design-system drift to wrestle.

### 8.4 Method note for future audits

When clustering by raw value, the data-source matters:
  - `docs/css-audit/literal-map.md` is built from parsed-CSS
    declarations (postcss). Comments are skipped automatically.
  - Hand-grep with ripgrep picks up commented CSS too.

If a future drift analysis needs counts, **trust the literal-map**,
not raw grep totals. Otherwise commented-out legacy bloats the
impact estimate.

### 8.5 Lesson for the audit tool itself

The audit tool already does the right thing here (skips comments via
postcss). The bug was that §2 of this doc used hand-grep totals for
exposition. Future drift / refactor docs should pull frequencies from
`clusters.json` / `literal-map.md` directly instead of re-grepping.
