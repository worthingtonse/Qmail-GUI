# CSS refactor — Phase 3 implementation plan

**Date:** 2026-05-24
**Author:** Claude Opus 4.7 (1M context)
**Status:** Draft for review (GPT)
**Plan reference:** `docs/opu.css-refactor.txt` v2.5 §4 + GPT review trail
**Prerequisite commits:** through `c72c173` (Phase 2.3 + 2.4 + handoff)

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

**Proposed primitive — universal rule, not a class:**

```css
/* primitives.css */
:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

A universal rule beats a `.focus-ring` class here because:
- Focus rings should apply to every focusable element, not opt-in.
- It removes 30 per-component selectors in one rule.
- The per-component `:focus` rules can be safely deleted — the
  universal `:focus-visible` covers them.
- Themes (especially high-contrast) already override with
  `outline: 3px solid #ffff00 !important` in themes.css.

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

### 3.6 `.upload-box` / upload-area family

**Audit evidence:** 2 files (drift doc + collisions list).
`.upload-box`, `.upload-icon`, `.upload-text` are the file-drop-area
pattern used by both Authenticate and Locker.

**Proposed primitive:** Same shape as the existing definitions,
deduped. Probably ~5 sub-classes.

**Sized:** ~45 minutes.

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

| # | Primitive | Sites | Time | JSX touches | Visual risk |
|--:|---|--:|--:|--:|---|
| 3.1 | `.focus-ring` (universal :focus-visible) | 30 | ~30m | 0 | None (rule already universal) |
| 3.5 | `.status-message` | 3 files | ~30m | 0 (class name unchanged) | None (3 sites already identical) |
| 3.3 | `.progress-bar` family | 3+1 files | ~30m | 0 | None (3 already identical; 1 dashboard gets canonical look) |
| 3.4 | `.results-grid` family | 4 files | ~1h | 1 (Export adds `--wide`) | Low (visual converges) |
| 3.6 | `.upload-box` family | 2 files | ~45m | 0 | Low |
| 3.2 | `.btn` family | ~50 sites | ~3h | many | **Medium** — biggest visual diff |

**Total: ~6 hours** sequential. Each step is its own commit.

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

**Q2 — `.btn` canonical padding.**
The literal-map's spacing-section showed `10px 24px` (7 hits) as
the single most common non-tokenised padding pair. That's my
canonical. But: `12px 24px` (4 hits combined incl. 1× `12px 24px`
plus `1.2rem` mapped to `var(--space-lg)` via Phase 2.2)
would be cleaner because it uses on-tier values. Trade-off: a
slight visual size change on every button that currently uses
`10px 24px`. Worth it for the token alignment, or stick with
the raw `10px 24px` pair the majority uses?

**Q3 — Gradient end-stops inside the primitive (`#8b5cf6` etc.)
stay as literals.**
GPT's Phase 2.1 pushback was exactly about not flattening these.
The primitive houses them once. But the audit will STILL report
them as raw colour literals (just in primitives.css now, not in
component CSS). The `rows_with_raw_literals` count probably
stays flat. Is that the right outcome, or should the primitives
get their own colour-debt accounting that recognises "this
literal is intentional, encoded in a primitive"?

**Q4 — Should I extract the `fadeIn` / `slideIn` keyframes too?**
Multiple `.status-message`-using files define their own `fadeIn`
keyframe inline. Extracting to primitives.css as named keyframes
is the natural primitive layer for keyframes too. But the audit
doesn't currently track `@keyframes` rules. Worth doing? My read:
yes, ship a `fadeIn` keyframe in primitives.css and delete the
per-component inline copies (they're all identical, modulo from-to
percentages).

---

## §11 Recommended next move

**3.1 — Universal `:focus-visible` primitive.** First commit.
Lowest risk, smallest diff, ~30 min. Confirms the file-creation +
import-wiring pattern before more invasive primitives. After this
lands cleanly, the per-primitive cadence falls into place.

If GPT approves the plan as-is, I proceed with 3.1.
