# CSS refactor — Phase 3 implementation plan

**Date:** 2026-05-24 (rev 1.2 — 3.6 deferred after evidence inspection)
**Author:** Claude Opus 4.7 (1M context)
**Status:** 3.1 + 3.5 + 3.3 + 3.4 shipped; 3.6 deferred; 3.2 next
**Plan reference:** `docs/opu.css-refactor.txt` v2.5 §4 + GPT review trail
**Prerequisite commits:** through `9780b84` (Phase 3.4)

**Changelog:**

- **v1.2 (2026-05-24)** — 3.6 (`.upload-box` family) deferred to
  Phase 4 after inspection revealed the plan's premise was wrong:
  LockerTab.css has zero `.upload-*` selectors (the plan said
  "Auth + Locker"); the actual second file is MainDashboard, and
  Auth's glass design vs MainDashboard's Bootstrap drift don't
  share a shape. Skip 3.6 entirely; proceed directly to 3.2 (.btn
  family). The MainDashboard upload variant is already tracked in
  `opu.css-palette-drift.md` D5–D8.

- **v1.1 (2026-05-24)** — Applied six GPT review items:
  1. §3.1 scope the universal focus rule to interactive selectors,
     not bare `:focus-visible`; flagged as repo-wide behaviour change.
  2. §3.2 added explicit App.css reconciliation step listing the
     existing `button`/`button.primary`/`button.secondary`/etc. rules
     that must be folded into `.btn` to avoid two competing sources.
  3. §10 Q2 corrected — `12px 24px` is NOT cleaner than `10px 24px`
     on "tier purity" grounds (12px is off-tier too). Canonical
     padding stays `10px 24px` (the actual majority shape) or moves
     to a modifier system if the size-variant survey shows demand.
  4. §3.6 explicitly marked as a 2-file threshold exception with
     rationale (same archetype family).
  5. §10 Q3 resolved — gradient end-stop literals inside primitives
     are intentional, documented as approved primitive-owned
     literals; no audit-tool change needed.
  6. §10 Q4 resolved — `fadeIn`/`slideIn`/etc. keyframes extracted
     to primitives.css alongside the rules that use them.
- **v1.0 (2026-05-24)** — Initial draft (commit `1e32cab`).

This is the operational plan for Phase 3 (primitive extraction). It
replaces the placeholder §4-Phase 3 block in the refactor plan with
concrete primitives, evidence, ordering, and commit cadence.

GPT's framing from the Phase 2.3+2.4 review: _"the main remaining
debt now really does look structural: button paddings, gradient/
button families, focus-ring duplication, shared status/results/
progress blocks. Those are primitive-extraction problems, not more
find/replace problems."_ Phase 3 is the home for that work.

---

## §1 Scope

**IN scope:**

- Extracting shared component patterns from E1–E7 into a new
  `src/styles/primitives.css`.
- Renaming the per-component duplicates to use the primitive class +
  their existing block name (e.g. `<div class="results-grid main-dashboard__results-grid">`).
- Importing `primitives.css` from `src/index.css` after `themes.css`
  (per GPT review item 6, plan v2.4).
- A small number of new global tokens IF they're genuinely re-usable
  (`--modal-bg`, possibly `--btn-disabled-bg` — TBD per primitive).
- Updating JSX `className` attributes to add the primitive class
  WHERE the rename is non-trivial.
- Re-running `npm run css:audit` after each primitive lands so the
  inventory tracks the consolidation in real time.

**OUT of scope (Phase 4 / Phase 5):**

- Per-file BEM block-and-element rename pass. That's Track F + Phase 4.
- Touching the 15 IN-REVIEW E-tracks (E8–E22). They're done as far as
  acceptance regex goes.
- Visual-design changes. Primitives encode existing visual contracts;
  if they merge close-but-different rules, the deferred-list captures
  what gets the canonical look.
- Inline `style={{...}}` cleanup (Phase 1 — runs after primitives
  land per the v2.5 §7 sequencing).

---

## §2 Architecture

### 2.1 File location

```
src/styles/
  tokens.css        (vocabulary — unchanged)
  themes.css        (per-theme overrides — unchanged)
  primitives.css    (NEW — this phase's deliverable)
```

### 2.2 Import order (per GPT review v2.4 item 6)

```css
/* src/index.css — order matters */
@import url('./styles/tokens.css');
@import url('./styles/themes.css');
@import url('./styles/primitives.css');   /* NEW */
```

Token vocabulary loads first; per-theme overrides redefine values;
primitives reference the (now-resolved) tokens; component CSS reads
the primitives.

### 2.3 Composition pattern (the BEM-adjacent rule)

Each primitive is a "block" in BEM terms. Components compose by
listing the primitive first, then their own block class:

```jsx
<button className="btn btn--primary main-dashboard__save-btn">
  Save
</button>
```

The primitive owns the *shape*: padding, radius, font-size, focus
behaviour, disabled state. The component class owns *placement and
local overrides*: width, margin, an icon's position, theme-specific
tweaks.

### 2.4 No utility-class layer (per all three prior plans)

Primitives are SEMANTIC (`.btn`, `.card`, `.status-message`). NO
`.p-md`, `.fs-sm`, `.text-center` utilities. That would break the
theme runtime and contradict the architecture every model agreed on.

---

## §3 Primitive candidates (evidence + design)

Each candidate lists the audit evidence, the proposed primitive
shape, and the per-component rename targets.

### 3.1 `.focus-ring` (or universal `:focus-visible`)

**Audit evidence:** 30 selectors / 30 sites across 9 files, all with
identical rules:

```css
outline: 2px solid var(--accent-primary);
outline-offset: 2px;
```

Sites range from `.diceware-screen button:focus-visible` to
`.account-pane__edit-profile-btn:focus`. All P2 (a) work that
got copy-pasted across components.

**Proposed primitive — scoped to interactive elements, not bare `:focus-visible`:**

```css
/* primitives.css */
button:focus-visible,
a:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible,
[role="button"]:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

Per GPT review item 1: bare `:focus-visible` would apply the outline
to anything that can receive focus, including elements that
deliberately suppress focus rings (e.g. a `<div tabindex="-1">` used
for programmatic focus management). Scoping to the same interactive-
element list the P2 (a) high-contrast block uses keeps the behaviour
predictable and consistent with the existing theme override.

**This IS a repo-wide behavior change** — not scoped to E1–E7. Any
component anywhere in `src/` that didn't previously have a focus
ring will inherit one. Phase 0.5 was the same shape (`.field-hint`
is repo-wide too), but the surface is much larger here. Worth
noting in the commit message; visual smoke should hit:

- The 7 E1–E7 dirty files (where the 30 removed `:focus` rules live)
- A few sample IN-REVIEW E-tracks (e.g. AccountPane.css, PasswordScreen.css)
- The ThemeEditorModal + ThemePicker (custom-theme + Phase 1 work)
- Any QMail screen with form fields

**Per-component removals:** 30 `:focus` rules across 9 files, all
the same. Audit re-run should show this cluster vanish entirely.

**Risk:** if any site needs a *different* focus ring (e.g. dark
ring on a light surface), the universal rule needs to be defeated
by a per-component selector with higher specificity. The drift
doc didn't surface any such case. Worth confirming in smoke.

**Sized:** ~30 minutes. Smallest primitive; ship first.

### 3.2 `.btn` family

**Audit evidence:** Multiple clusters point here:
- 13 sites: `linear-gradient(135deg, #556c7c 0%, #4a5f6e 100%)`
  (disabled-button gradient, drift doc D10)
- 11 sites: `linear-gradient(135deg, var(--accent-primary) 0%, #8b5cf6 100%)`
  (primary-button gradient end-stop, drift doc D1 pushback)
- 8 sites each: same for accent-success / accent-error
- 11 sites: `cursor: not-allowed; opacity: 0.6` (disabled-button decorations)
- 26 of the 42 cross-file collisions are button-shaped:
  `.browse-button`, `.clear-button`, `.import-button`, `.submit-wallet-btn`,
  `.switch-wallet-btn`, `.test-cli-btn`, `.backup-btn`, etc.
- Phase 2.3's deferred off-tier shorthand pairs (`10px 24px` ×7,
  `14px 16px` ×5, `14px 24px` ×4, `10px 20px` ×3) are mostly
  button paddings.

**Proposed primitive surface:**

```css
/* primitives.css */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: 10px 24px;           /* Canonical button padding */
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-primary);
  font-size: var(--font-size-md);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-base);
}

.btn:disabled {
  background: linear-gradient(135deg, #556c7c 0%, #4a5f6e 100%);
  cursor: not-allowed;
  opacity: 0.6;
}

.btn--primary {
  background: linear-gradient(
    135deg,
    var(--accent-primary) 0%,
    #8b5cf6 100%
  );
  color: var(--text-primary);
}

.btn--success {
  background: linear-gradient(
    135deg,
    var(--accent-success) 0%,
    #10b981 100%
  );
  color: var(--text-primary);
}

.btn--error {
  background: linear-gradient(
    135deg,
    var(--accent-error) 0%,
    #ef4444 100%
  );
  color: var(--text-primary);
}

.btn--ghost {
  background: transparent;
  border: 1px solid var(--border-medium);
  color: var(--text-primary);
}
```

**Note on the gradient end-stops:** the `#8b5cf6` / `#10b981` /
`#ef4444` values stay as literals inside the primitive even though
they're "drifted" Tailwind colours. GPT's Phase 2.1 review caught
that these are intentional two-tone gradients (token → drifted-stop)
that produce visual depth. Collapsing them to monotones would be a
visual regression. The primitive houses them once; per-component
sites no longer carry the literal. Net effect: 30+ gradient literals
collapse to 3 primitive variants.

**Per-component rename surface:** ~50 button-like classes across
the 7 dirty files. Each becomes `<class>` → `class="btn btn--<variant>
<existing-class>"`. JSX touches required.

**App.css reconciliation (per GPT review item 2):**

App.css already declares broad button styling that overlaps the new
primitive:

```
src/App.css:11   button { ... }              ← bare-element base styles
src/App.css:53   button:disabled { ... }
src/App.css:61   button.primary { ... }
src/App.css:70   button.primary:hover { ... }
src/App.css:78   button.secondary, .browse-button { ... }
src/App.css:88   button.secondary:hover, .browse-button:hover { ... }
src/App.css:97   button.success { ... }
src/App.css:105  button.success:hover { ... }
src/App.css:112  button.danger { ... }
src/App.css:120  button.danger:hover { ... }
src/App.css:127  button.ghost, ... { ... }
src/App.css:136  button.ghost:hover { ... }
```

3.2 MUST reconcile these as part of the `.btn` extraction, not
leave them as a parallel ruleset. Concretely:

  (a) The bare-element `button { ... }` rule moves to primitives.css
      AS the base of `.btn`, so any `<button>` without a `.btn`
      class still gets a reasonable default — but the canonical
      path is `.btn` + a variant.
  (b) `button.primary` → fold into `.btn--primary` in primitives.css
      AND delete from App.css. Same for `button.secondary`/`success`/
      `danger`/`ghost`. The JSX rename of `<button className="primary">`
      to `<button className="btn btn--primary">` happens in the
      same commit.
  (c) `.browse-button` was already a multi-file collision — drops
      into `.btn--ghost` or `.btn--secondary` (TBD per look) and
      gets its own per-component class for layout.
  (d) `button:disabled`, `button:hover`, `button:focus` rules: the
      `:disabled` portion folds into `.btn:disabled` in primitives.
      `:hover` and `:focus` are universal in 3.1 (`:focus-visible`)
      and per-variant hover (each `.btn--<variant>:hover`) in 3.2.

If App.css's existing button rules are LEFT in place alongside the
new primitives, the codebase has two competing button-styling
sources and reviewers will guess which wins. The 3.2 commit must
make `.btn` the single owner of button shape.

**Sized:** ~3 hours including JSX updates. Biggest primitive;
ship after focus-ring proves the pattern.

### 3.3 `.progress-bar` family (`-container` + `-bar`)

**Audit evidence:**
- `.progress-bar-container`: 3 files (Export, Auth, Locker) converged;
  MainDashboard.css has a Bootstrap-drift variant (different colour,
  raw `15px` radius, `30px` height — actually commented out).
- `.progress-bar`: 3 same-pattern definitions; MainDashboard variant uses
  the drifted `#4a90e2`/`#357abd` blue gradient.

**Proposed primitive:**

```css
/* primitives.css */
.progress-bar-container {
  width: 100%;
  height: 12px;
  background: var(--tertiary-bg);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: var(--space-lg);
}

.progress-bar {
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--accent-primary),
    var(--accent-secondary)
  );
  border-radius: var(--radius-lg);
  transition: width var(--transition-base);
  display: flex;
  align-items: center;
  justify-content: center;
}
```

Three components keep their existing classes (they're already
identical). MainDashboard's variant gets deleted; the dashboard
inherits the primitive automatically.

**Sized:** ~30 minutes.

### 3.4 `.results-grid` + `.result-item` family

**Audit evidence:** `.results-grid` (4 files), `.results-section`,
`.results-header`, `.result-item`, `.result-label`, `.result-value`,
`.results-close-button` (3 files each). All from the wallet-tabs
results-display pattern (after Authenticate, Export, Locker
operations).

The minmax/gap drift (200px / 280px columns; 15px / var(--space-md)
gap) is genuine — Export has wider columns because each result is
richer. The primitive needs to pick one default and let the wider
variant be a modifier OR a per-component override.

**Proposed primitive:**

```css
/* primitives.css */
.results-section {
  margin-top: var(--space-xl);
  padding: var(--space-lg);
  background: var(--card-bg);
  border-radius: var(--radius-lg);
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-lg);
}

.results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-md);
}

.results-grid--wide {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.result-item { /* ... */ }
.result-label { /* ... */ }
.result-value { /* ... */ }
.results-close-button { /* ... */ }
```

ExportTab.jsx adds `results-grid--wide` to its existing
`results-grid`; the rest stay as-is.

**Sized:** ~1 hour. Multiple sub-primitives but each is tiny.

### 3.5 `.status-message`

**Audit evidence:** 3 files with the same shape (Auth, Locker,
Export); MainDashboard's variant is commented out. Audit reports
3-file collision but the dead-code copy doesn't count.

**Proposed primitive:**

```css
.status-message {
  font-size: var(--font-size-md);
  color: var(--text-secondary);
  text-align: center;
  margin: 0;
  line-height: 1.6;
  animation: fadeIn calc(300ms * var(--motion-scale)) ease-out;
}
```

This is literally the rule from AuthenticateTab.css / LockerTab.css
verbatim. The 3 existing copies get deleted. The `fadeIn` keyframe
needs to live in primitives.css too (currently defined inline in
multiple files).

**Sized:** ~30 minutes (including `fadeIn` keyframe extraction).

### 3.6 `.upload-box` / upload-area family — **DEFERRED to Phase 4**

**Status (post-3.4 inspection):** _Skipped. Plan premise falsified;
not a valid primitive candidate._

**What v1.1 said:** 2-file threshold exception, Auth+Locker, same
archetype family with identical shape.

**What inspection found (2026-05-24, after Phase 3.4):**

1. **LockerTab.css has zero `.upload-*` selectors.** The plan's
   premise — "pattern used by both Authenticate and Locker" — is
   wrong. Locker doesn't host this pattern at all.

2. **The actual second file is MainDashboard.css**, which carries
   a fully Bootstrap-drifted variant (`3px dashed #4a90e2`,
   `#f8f9fa` solid bg, `48px` raw font-size, `#333` / `#666`
   colours, `#357abd` hover border).

3. **Auth's and MainDashboard's shapes are wholly different**, not
   "near-identical with minor drift":
   - Auth: glass-morphism aesthetic (`var(--glass-bg)`, backdrop
     blur, dashed `--border-medium`, `4rem` icon with drop-shadow
     and infinite `floatIcon` animation, `--text-primary` /
     `--text-tertiary` text colours).
   - MainDashboard: Bootstrap legacy (solid surface, no animation,
     `18px` raw text, drifted blue scheme).

4. The MainDashboard variant is already tracked in
   `docs/opu.css-palette-drift.md` decisions D5–D8.

**Decision:** Skip 3.6 entirely. The plan's evidence was incorrect
and the actual surface doesn't justify even a 2-file threshold
exception (the shapes don't match). Auth's design stays per-file
until Phase 4 per-file work decides whether to:
- Reconcile MainDashboard's variant to Auth's design language
  (large visual diff for the dashboard upload area)
- Or document MainDashboard's variant as intentional (Bootstrap
  legacy for the dashboard-specific upload flow)
- Or extract Auth's design alone as a single-consumer primitive
  if Phase 4 surfaces a third consumer.

Per plan v2.5 §3.7 "Bad candidates" list:
> "padding-only helpers; width-only helpers; color-only helpers;
> arbitrary bundle names that mean nothing outside a spreadsheet."

Speculative extraction with only one shape-matching consumer falls
into the same bucket. Better to wait for Phase 4 evidence.

**Sized:** ~0 minutes (no extraction performed). Move directly to 3.2.

### 3.7 What I'm NOT extracting in Phase 3

Per GPT's "≥3 files AND semantic" rule:

- `.feature-placeholder` (3 files) — investigate first; might be a
  loading-state primitive or might be component-specific empty
  states. Defer until 3.8 audit.
- `.nav-tab` (2 files) — 2-file collision; below threshold.
- `.logout-button`, `.change-password-btn`, `.payout-option`,
  `.test-cli-btn` — 2-file collisions; below threshold. Will
  fold into `.btn` family if they share its shape.
- `.modal` family — only `App.css` has the update-modal extract.
  Not a multi-file collision. Phase 4 / 5 territory (or a future
  modal-system refactor).
- `.card` — no single dominant cluster exists; per-component cards
  vary in border/shadow/padding. Likely a Phase 4 question once
  the per-file rename surfaces the real shape.
- `.empty-state`, `.loading-state` — per-component variations don't
  yet show the ≥3-files pattern. Re-audit after Phase 3 lands.

These all stay in Phase 4 / 5 backlog, NOT Phase 3.

---

## §4 Ordering and commit cadence

Per the plan v2.5 §4 "lowest-risk first" framing, ordered by:
ascending blast radius, ascending JSX touches, ascending review
complexity.

| # | Primitive | Sites | Time | JSX touches | Status |
|--:|---|--:|--:|--:|---|
| 3.1 | `.focus-ring` (universal :focus-visible) | 30 | ~30m | 0 | **SHIPPED `6a7f1e4`** |
| 3.5 | `.status-message` | 3 files | ~30m | 0 (class name unchanged) | **SHIPPED `7209c84`** |
| 3.3 | `.progress-bar` family (conservative) | 2 files | ~30m | 0 | **SHIPPED `e054804`** |
| 3.4 | `.results-grid` family | 2 files | ~1h | 0 | **SHIPPED `9780b84`** |
| ~~3.6~~ | ~~`.upload-box` family~~ | ~~2 files~~ | — | — | **DEFERRED to Phase 4** (premise falsified; see §3.6) |
| 3.2 | `.btn` family | ~50 sites | ~3h | many | **NEXT** — biggest visual diff |

**Total remaining: ~3 hours** (3.2 alone). Each step is its own commit.

**Pause points for GPT review:**

- After 3.1 (focus-ring) — confirm the universal-rule approach is
  right before committing to that pattern for other primitives.
- After 3.2 (btn family) — biggest piece; visual smoke recommended.
- After 3.5/3.3/3.4/3.6 — bundled per-primitive commits don't need
  full review pauses but a single end-of-phase summary handoff is
  appropriate.

---

## §5 Per-commit checklist

For each primitive (3.1 → 3.6), the steps are:

1. Read the candidate's audit evidence (clusters + per-file decls).
2. Write the primitive rule(s) into `src/styles/primitives.css`.
   (For 3.1, this is the first creation of the file + the import
   wiring in `src/index.css`.)
3. Remove the duplicate per-file definitions from the source CSS.
4. Update JSX `className` where the primitive class needs to be
   added explicitly (NOT needed when the class name is unchanged —
   it'll resolve from primitives.css via the cascade).
5. Run `npm run build` and `npm test`.
6. Run `npm run css:audit` and confirm the relevant cluster
   collapses or disappears.
7. Visual smoke note: which screen/component most exercises the
   primitive (for the user to check). E.g. for 3.1 it's every
   keyboard-focused element on every screen.
8. Prepare commit message naming the primitive and the audit
   evidence (cluster ID / occurrence count).
9. User approves → commit.

---

## §6 Acceptance gates (per primitive)

- `npm run build`: clean
- `npm test`: 30/30 (no JSX touches break themeService)
- `npm run css:audit`:
  - Relevant exact-cluster's `selector_occurrences` and `site_count`
    drop or zero out.
  - No new cluster created at the primitive's expense.
  - Inventory `rows_with_raw_literals` count stable or lower.
- No new tokens added unless the primitive genuinely needs one
  (target: zero new tokens this phase).
- `git diff --stat` shows: primitives.css grew, per-component CSS
  shrank, no surprise files modified.

---

## §7 Acceptance gates (end of Phase 3)

- `src/styles/primitives.css` exists, is imported from `src/index.css`
  after themes.css, contains 6 primitive groups (3.1–3.6).
- Audit reports:
  - The 30× focus-ring cluster: gone (or down to ≤1 remaining
    per-component override).
  - The button gradient clusters: collapsed into 3 primitive variants
    (~30+ raw-gradient sites eliminated).
  - The `.results-grid`, `.status-message`, `.progress-bar` collisions:
    no longer reported (they now share the primitive selector).
- Token cap: still well under ~80.
- Working tree clean; per-commit diffs scoped.

---

## §8 What this enables for Phase 4

Phase 4 (per-file BEM rename + JSX wiring) becomes:
- Much smaller per file (the primitives have already absorbed ~30%
  of each file's content per plan v2.5 §4 estimate).
- No more "should `.browse-button` become `.account-pane__browse-button`
  or stay shared?" — Phase 3 already decided shared.
- Track F (BEM mapping) writes only the per-component-block renames,
  not the primitive layer.

---

## §9 Risks

**R1 — Universal `:focus-visible` over-fires.**
If a component has a deliberately-suppressed focus ring (e.g. for
mouse-only interactive elements), the universal rule overrides.
Mitigation: smoke-test after 3.1 lands; reach for `outline: none`
in the per-component CSS where needed.

**R2 — `.btn` family's canonical padding (`10px 24px`) doesn't fit
every button.**
Some existing buttons use `12px 24px` (3×), `14px 16px` (5×),
`14px 32px` (3×) — different shapes for different contexts. The
primitive picks one, and per-component `padding` overrides where
the original was different. JSX class compositions work, but the
override surface needs to be tracked in the commit so reviewers
know what padded what.

**R3 — `.results-grid--wide` modifier syntax.**
ExportTab's wider columns require either a modifier class
(`.results-grid--wide`) OR a per-component override. I picked the
modifier because it's reusable. If GPT prefers per-component
override, swap is one-line.

**R4 — Removing per-component focus rules without missing edge
cases.**
The audit shows 30 sites with the IDENTICAL outline rule, but
some files have additional non-outline focus declarations (e.g.
`box-shadow`) that should stay. Phase 3.1 should ONLY remove the
duplicated `outline + outline-offset` block, not the entire
`:focus` rule.

**R5 — Bigger JSX diff than other recent phases.**
3.2 (btn family) touches ~50 JSX className composition sites
across the 7 dirty files plus their JSX neighbours. That's the
biggest JSX diff since Phase 0.5 (which had 7). Need to spot-check
that no dynamic-className composition gets broken (e.g.
`` className={`btn ${variant} ${state}`} ``).

---

## §10 Outstanding questions for GPT

**Q1 — `.focus-ring` as universal rule vs. opt-in class?**
My read: universal rule (no class). It's already conceptually
universal (P2 (a) themes.css has a HC override at `:focus-visible`
which is *implicitly* universal). Making it explicit in
primitives.css matches the de-facto behaviour. Push back if you'd
prefer the opt-in `.focus-ring` class — the only argument for that
I can see is "lets components disable focus rings selectively,"
but `outline: none` on the per-component selector achieves the
same thing.

**Q2 — `.btn` canonical padding.** _Updated per GPT review item 3._

The literal-map's spacing section shows `10px 24px` as the
single most common non-tokenised pair across button-shaped sites
(7+ hits). My initial draft argued for switching to `12px 24px`
on "token-purity grounds" — that was wrong. `12px` is NOT a
`--space-*` tier value either (the tiers are 4/8/16/24/32/48px);
it's just as off-tier as `10px`, just with a different number.

Corrected position: use `10px 24px` as the canonical primitive
padding because it's the actual majority shape on disk. The
token-alignment argument doesn't apply here. Phase 4 / Phase 5
can revisit if a new `--btn-padding` token or a true spacing-
ladder tier becomes worth adding (the v2.5 plan caps token count
at ~80; we're well under).

Alternative: split sizes via modifiers (`.btn--sm`, `.btn--lg`)
each with its own padding. If multiple distinct button heights
exist (12px/24px, 14px/16px, 14px/24px, 10px/24px etc.), a
modifier system collapses them more cleanly than picking one.
Worth Phase 3 doing — but only if the survey shows ≥3 sites
per modifier size. Quick recount needed before 3.2 implementation.

**Q3 — Gradient end-stops inside the primitive (`#8b5cf6` etc.)
stay as literals.** _Resolved per GPT review item 5._

GPT's Phase 2.1 pushback was exactly about not flattening these.
The primitive houses them once. The audit will still report them
as raw colour literals (just in primitives.css now, not in
component CSS), but that's fine — they're **approved primitive-
owned literals**, not accidental debt.

No audit-tool change needed. The reviewer convention: any raw hex
appearing in `src/styles/primitives.css` is intentional unless
flagged in a follow-up commit. Phase 3 commit messages will name
the specific drifted-tier values they encode (e.g. "owns the
`#8b5cf6` accent-primary gradient end-stop per drift doc D1") so
the audit-trail is searchable via git history.

A future enhancement could add a `--primitives-css-allowlist` to
`scripts/css-analysis/config.json` that exempts primitives.css from
the raw-literal count. Not doing it now — defer until Phase 5 if
the literal-map noise becomes confusing.

**Q4 — Extract the `fadeIn` / `slideIn` keyframes too.** _Resolved
per GPT review item 6: yes._

Multiple `.status-message`-using files define their own `fadeIn`
keyframe inline. Same for `slideIn`, `popIn`, `fadeInUp`. If they're
materially the same (verify before extraction), they belong in the
primitive layer alongside the rule that uses them.

Implementation note: each keyframe lands in primitives.css ONCE.
Per-component inline keyframes get deleted as the relevant primitive
(3.5 status-message, etc.) lands. If a file uses `animation: fadeIn`
but defines its OWN slightly-different `@keyframes fadeIn`, the
primitives.css definition wins via the cascade — verify per-file
before deletion that the existing definition is the standard one
(0→1 opacity over the duration). If a file has a deliberately
DIFFERENT keyframe (e.g. fades to 0.8 not 1), keep it inline and
rename to avoid the collision.

The audit doesn't currently track `@keyframes` rules, so the
collision detection has to be manual for this. Acceptable for the
six known keyframe names (fadeIn, slideIn, fadeInUp, popIn,
dropdownFadeIn, glass-ripple).

---

## §11 Recommended next move

**3.1 — Universal `:focus-visible` primitive.** First commit.
Lowest risk, smallest diff, ~30 min. Confirms the file-creation +
import-wiring pattern before more invasive primitives. After this
lands cleanly, the per-primitive cadence falls into place.

If GPT approves the plan as-is, I proceed with 3.1.
