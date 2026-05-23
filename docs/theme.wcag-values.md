# QMail theme — WCAG contrast audit

Track B deliverable. Measured contrast ratios for every text/background
pair the user is likely to encounter in the light and high-contrast
themes. Proposed token adjustments where the existing values fail.

The dark theme is out of scope — it ships "today's look" and has been
through visual review.

---

## How the numbers were produced

Computed directly from the WCAG 2.x relative-luminance formula:

1. sRGB channel `c' = c / 255`
2. `linear = c' ≤ 0.03928 ? c'/12.92 : ((c' + 0.055) / 1.055)^2.4`
3. `L = 0.2126·R + 0.7152·G + 0.0722·B` (linear)
4. `contrast = (L_lighter + 0.05) / (L_darker + 0.05)`

`rgba(...)` tokens are composited "src over dst" against their parent
background before the ratio is computed:

  `out = src.rgb · src.a + dst.rgb · (1 − src.a)`

Gradients (`--primary-bg: linear-gradient(135deg, A 0%, B 100%)`) are
reported at both stops because the worst-case stop is what gates the
overall pass.

The script lives at `scripts/wcag-audit.mjs` (not committed; one-shot
audit tool). To re-run with different proposals, edit the candidate
list at the bottom of the script and run `node scripts/wcag-audit.mjs`.

WCAG targets:
- **AA normal**: ≥ 4.5:1 (body text)
- **AA large**:  ≥ 3:1   (≥ 18.66px regular or ≥ 14px bold)
- **AAA normal**: ≥ 7:1
- **AAA large**: ≥ 4.5:1

Plan §12.3 asks for AAA where reasonable, AA minimum on every pair.
"Look wins over guidelines" (plan §13.1) — proposals below stay close
to the existing palette character. Where AAA would force a change that
visibly shifts the theme, the strongest AA-compliant value is proposed
instead and called out explicitly.

---

## Light theme

Resolved palette under audit:

| Token              | Value                                            |
| ------------------ | ------------------------------------------------ |
| `--primary-bg`     | `linear-gradient(135deg, #f8fafc 0%, #eef2f7 100%)` |
| `--secondary-bg`   | `#ffffff`                                        |
| `--card-bg`        | `#ffffff`                                        |
| `--text-primary`   | `#0f172a`                                        |
| `--text-secondary` | `#334155`                                        |
| `--text-tertiary`  | `#64748b`                                        |
| `--text-muted`     | `rgba(51, 65, 85, 0.6)`                          |
| `--accent-primary` | `#6d28d9`                                        |
| `--accent-secondary` | `#0284c7`                                      |
| `--accent-success` | `#059669`                                        |
| `--accent-error`   | `#dc2626`                                        |
| `--accent-warning` / `--accent-tertiary` | `#d97706`                  |

### Measurements

| Pair                                              | Ratio   | AA-N | AA-L | AAA-N | AAA-L | Notes |
| ------------------------------------------------- | ------: | :--: | :--: | :---: | :---: | ----- |
| text-primary on primary-bg (start `#f8fafc`)      | 17.06:1 | ✅   | ✅   | ✅    | ✅    | |
| text-primary on primary-bg (end `#eef2f7`)        | 15.88:1 | ✅   | ✅   | ✅    | ✅    | |
| text-primary on secondary-bg / card-bg            | 17.85:1 | ✅   | ✅   | ✅    | ✅    | |
| text-secondary on primary-bg (start)              |  9.90:1 | ✅   | ✅   | ✅    | ✅    | |
| text-secondary on primary-bg (end)                |  9.21:1 | ✅   | ✅   | ✅    | ✅    | |
| text-secondary on secondary-bg / card-bg          | 10.35:1 | ✅   | ✅   | ✅    | ✅    | |
| text-tertiary on primary-bg (start)               |  4.55:1 | ✅   | ✅   | ❌    | ✅    | borderline; AAA-large only |
| **text-tertiary on primary-bg (end)**             |  4.23:1 | ❌   | ✅   | ❌    | ❌    | **fails AA-normal at the darker gradient stop** |
| text-tertiary on secondary-bg / card-bg           |  4.76:1 | ✅   | ✅   | ❌    | ✅    | |
| **text-muted on primary-bg (start)**              |  3.29:1 | ❌   | ✅   | ❌    | ❌    | **fails AA-normal** |
| **text-muted on primary-bg (end)**                |  3.19:1 | ❌   | ✅   | ❌    | ❌    | **fails AA-normal** |
| **text-muted on secondary-bg / card-bg**          |  3.35:1 | ❌   | ✅   | ❌    | ❌    | **fails AA-normal** |
| accent-primary on primary-bg (start)              |  6.79:1 | ✅   | ✅   | ❌    | ✅    | misses AAA by 0.21 |
| accent-primary on secondary-bg / card-bg          |  7.10:1 | ✅   | ✅   | ✅    | ✅    | |
| **accent-secondary on secondary-bg**              |  4.10:1 | ❌   | ✅   | ❌    | ❌    | **fails AA-normal** |
| **accent-success on secondary-bg**                |  3.77:1 | ❌   | ✅   | ❌    | ❌    | **fails AA-normal** |
| accent-error on secondary-bg                      |  4.83:1 | ✅   | ✅   | ❌    | ✅    | passes AA only |
| **accent-warning/tertiary on secondary-bg**       |  3.19:1 | ❌   | ✅   | ❌    | ❌    | **fails AA-normal** |
| white on accent-primary (button label)            |  7.10:1 | ✅   | ✅   | ✅    | ✅    | |
| **white on accent-secondary** (button label)      |  4.10:1 | ❌   | ✅   | ❌    | ❌    | **fails AA-normal** (mirror of accent-secondary measurement) |
| **white on accent-success** (button label)        |  3.77:1 | ❌   | ✅   | ❌    | ❌    | **fails AA-normal** |
| white on accent-error (button label)              |  4.83:1 | ✅   | ✅   | ❌    | ✅    | passes AA only |
| **white on accent-warning** (button label)        |  3.19:1 | ❌   | ✅   | ❌    | ❌    | **fails AA-normal** |

**Summary:** 10 pairs fail AA-normal, 5 more pass AA but miss AAA-normal.
The worst offenders are `--text-muted`, the secondary/success/warning
accents, and the darker stop of `--primary-bg`'s gradient.

---

## High-contrast theme

Resolved palette under audit:

| Token              | Value     |
| ------------------ | --------- |
| `--primary-bg`     | `#000000` |
| `--secondary-bg`   | `#000000` |
| `--card-bg`        | `#000000` |
| `--card-hover`     | `#1a1a00` |
| `--text-primary`   | `#ffffff` |
| `--text-secondary` | `#ffff00` |
| `--text-tertiary`  | `#ffff00` |
| `--text-muted`     | `#ffff00` |
| `--accent-primary` | `#ffff00` |
| `--accent-secondary` | `#00ffff` |
| `--accent-success` | `#00ff00` |
| `--accent-error`   | `#ff5555` |
| `--accent-warning` | `#ffff00` |

### Measurements

| Pair                                              | Ratio   | AA-N | AA-L | AAA-N | AAA-L | Notes |
| ------------------------------------------------- | ------: | :--: | :--: | :---: | :---: | ----- |
| text-primary on primary-bg                        | 21.00:1 | ✅   | ✅   | ✅    | ✅    | maximum possible |
| text-secondary on primary-bg                      | 19.56:1 | ✅   | ✅   | ✅    | ✅    | |
| text-tertiary on primary-bg                       | 19.56:1 | ✅   | ✅   | ✅    | ✅    | same as text-secondary — **intentional flatness** |
| text-muted on primary-bg                          | 19.56:1 | ✅   | ✅   | ✅    | ✅    | same as text-secondary — **intentional flatness** |
| accent-primary on primary-bg                      | 19.56:1 | ✅   | ✅   | ✅    | ✅    | |
| accent-secondary on primary-bg                    | 16.75:1 | ✅   | ✅   | ✅    | ✅    | |
| accent-success on primary-bg                      | 15.30:1 | ✅   | ✅   | ✅    | ✅    | |
| **accent-error on primary-bg**                    |  6.68:1 | ✅   | ✅   | ❌    | ✅    | **misses AAA-normal by 0.32** |
| accent-warning on primary-bg                      | 19.56:1 | ✅   | ✅   | ✅    | ✅    | |
| text-primary on card-hover (`#1a1a00`)            | 17.62:1 | ✅   | ✅   | ✅    | ✅    | |
| accent-primary on card-hover                      | 16.41:1 | ✅   | ✅   | ✅    | ✅    | |
| black on accent-primary (button label)            | 19.56:1 | ✅   | ✅   | ✅    | ✅    | |
| black on accent-secondary                         | 16.75:1 | ✅   | ✅   | ✅    | ✅    | |
| black on accent-success                           | 15.30:1 | ✅   | ✅   | ✅    | ✅    | |
| **black on accent-error**                         |  6.68:1 | ✅   | ✅   | ❌    | ✅    | mirror of accent-error measurement |
| border `#ffffff` on primary-bg (focus rings)      | 21.00:1 | ✅   | ✅   | ✅    | ✅    | |
| focus outline `#ffff00` on primary-bg             | 19.56:1 | ✅   | ✅   | ✅    | ✅    | P2 (a) yellow focus rings |

**Summary:** Zero AA failures. Only `--accent-error` (#ff5555) misses
AAA-normal, by 0.32. Every other pair clears AAA with margin.

**Intentional flatness:** `--text-tertiary`, `--text-muted`, and
`--text-secondary` all resolve to the same yellow (`#ffff00`) in the
high-contrast theme. There is no muted hierarchy under high-contrast —
muted text would only exist by *lowering* contrast, which defeats the
theme's purpose. Components that use `--text-muted` for de-emphasis
should rely on layout (smaller size, spacing, or italic) rather than
colour under this theme. **No change proposed** — this is the theme
working as designed.

---

## Proposed adjustments

### Light theme — apply these to `themes.css [data-theme="light"]`

The proposals were chosen by the smallest hue-step that clears AAA-normal,
unless AAA would force a meaningful character shift (in which case the
strongest AA value is offered with a "look-wins" note).

| Token                | Current     | Proposed   | New ratio (on `#ffffff`) | Rationale |
| -------------------- | ----------- | ---------- | -----------------------: | --------- |
| `--accent-primary`   | `#6d28d9`   | `#5b21b6`  |  8.98:1 AAA              | One Tailwind purple step deeper. Visibly the same lavender family. Also fixes white-on-accent button labels (now 8.98:1 AAA). |
| `--accent-secondary` | `#0284c7`   | `#075985`  |  7.56:1 AAA              | Same Tailwind sky family, two steps deeper. Required — current value fails AA. |
| `--accent-success`   | `#059669`   | `#065f46`  |  7.68:1 AAA              | Same emerald family, two steps deeper. Required — current value fails AA. |
| `--accent-error`     | `#dc2626`   | `#991b1b`  |  8.31:1 AAA              | Tailwind red-800. Required — current passes AA only (4.83:1) and misses AAA-normal; the AAA fix is a more grounded red that reads as "serious error" rather than "alert toast", which is the right intent on a light bg. |
| `--accent-warning` / `--accent-tertiary` | `#d97706` | `#92400e` |  7.09:1 AAA | Tailwind amber/orange-800. Required — current fails AA by a wide margin. |
| `--text-tertiary`    | `#64748b`   | `#475569`  |  7.58:1 AAA              | Tailwind slate-600. Required — current fails AA at the darker gradient stop. |
| `--text-muted`       | `rgba(51, 65, 85, 0.6)` | `rgba(51, 65, 85, 0.8)` |  5.74:1 AA-only | **Look-wins**: full opacity (1.0) clears AAA at 10.35:1 but loses the "muted" cue entirely (becomes visually identical to text-secondary). Raising alpha from 0.6 to 0.8 lifts the ratio above AA-normal while preserving the de-emphasis the token name implies. AAA-large still clears for body text ≥ 18.66px. Accept as AA-only. |

### High-contrast theme — apply these to `themes.css [data-theme="high-contrast"]`

| Token              | Current     | Proposed   | New ratio (on `#000000`) | Rationale |
| ------------------ | ----------- | ---------- | -----------------------: | --------- |
| `--accent-error`   | `#ff5555`   | `#ff6666`  |  7.34:1 AAA              | Tiny shift in the red channel that pushes past the AAA-normal threshold (7:1). Visibly indistinguishable from the current shade; black-on-accent button labels improve to the same 7.34:1. (Minimum-step alternative: `#ff6060` → 7.09:1 AAA. `#ff6666` is recommended for the small extra margin.) |

Cross-checked: every other high-contrast token clears AAA with margin
≥ 8:1. No other changes required.

---

## Proposed block — drop-in replacement for `[data-theme="light"]`

The lines below replace the matching lines in
`src/styles/themes.css`. Other tokens (backgrounds, borders, glass,
shadows, motion, glow) are unchanged.

```css
[data-theme="light"] {
  /* ...backgrounds unchanged... */

  /* Accents — Track B / P2 (b): WCAG AAA on #ffffff */
  --accent-primary:   #5b21b6;   /* was #6d28d9 */
  --accent-secondary: #075985;   /* was #0284c7 */
  --accent-tertiary:  #92400e;   /* was #d97706 */
  --accent-success:   #065f46;   /* was #059669 */
  --accent-error:     #991b1b;   /* was #dc2626 */
  --accent-warning:   #92400e;   /* was #d97706 */

  /* Text */
  --text-primary:   #0f172a;     /* unchanged */
  --text-secondary: #334155;     /* unchanged */
  --text-tertiary:  #475569;     /* was #64748b */
  --text-muted:     rgba(51, 65, 85, 0.8);  /* was alpha 0.6 */

  /* ...borders / glass / shadows unchanged... */

  /* Glow — recompute against the new --accent-primary */
  --glow-primary:   0 0 20px rgba(91, 33, 182, 0.25);   /* was rgba(109,40,217,...) */
  --glow-secondary: 0 0 20px rgba(7,  89, 133, 0.25);   /* was rgba(2,132,199,...)  */
  --glow-success:   0 0 20px rgba(6,  95,  70, 0.25);   /* was rgba(5,150,105,...)  */
}
```

## Proposed block — drop-in replacement for `[data-theme="high-contrast"]`

One change only:

```css
[data-theme="high-contrast"] {
  /* ...everything unchanged except: */
  --accent-error: #ff6666;   /* was #ff5555 — was 6.68:1, now 7.34:1 AAA */
}
```

---

## What's intentionally NOT changing

These were considered and held:

1. **High-contrast text hierarchy.** As measured, `--text-secondary`,
   `--text-tertiary`, and `--text-muted` all resolve to pure yellow.
   This is theme-correct. Components that want de-emphasis under
   high-contrast must use size/spacing/italic, not colour.

2. **`--accent-primary` at the bright `--primary-bg` gradient stop.**
   Measured at 6.79:1 (was) → 8.69:1 (with `#5b21b6`). Fine — the
   bright stop is the *easier* end. The accent on a button typically
   sits on `--secondary-bg` (#ffffff) anyway.

3. **Light-theme `--text-muted` AAA.** Going full-opacity clears AAA at
   10.35:1 but erases the "muted" cue. AA-normal (5.74:1) is the right
   landing per the look-wins principle.

4. **High-contrast `--accent-error` AAA gap of 0.32.** Small enough that
   a one-channel tweak (`#ff5555` → `#ff6666`) closes it without altering
   the perceived hue. Worth shipping.

---

## Re-running the audit

```bash
node scripts/wcag-audit.mjs
```

The script reports every pair, the AA/AAA flags, and a candidate-shade
sweep used to derive the proposals above. Update the palette objects
at the top of the script to audit a different proposed set.

---

## Related

- `docs/opu.theme.plan.txt` §4.2 (light palette source), §4.3
  (high-contrast palette source), §13.1 (look-wins-over-guidelines).
- `docs/opu.theme.handoff.txt` G6 (light palette was unmeasured at
  Phase 1 — this doc closes that gap).
- `src/styles/themes.css` is where the proposals land. P2 (b) is the
  follow-up commit that applies them.
