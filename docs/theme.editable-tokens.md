# QMail theme — editable tokens

Help-panel content for the **ThemeEditorModal**. One section per
control the user can tweak, with what it does, the allowed input,
the default value under each base theme, and a small ASCII diagram of
where the change shows up on screen.

Audience: the user clicking sliders inside the modal. For the JSON
file format (hand-editing `custom_theme.txt`, tooling integrations,
the full validation rules), see [`theme.custom-format.md`](theme.custom-format.md).

The doc lists the **eight** tokens currently surfaced. Other tokens
exist (full vocabulary in `src/styles/tokens.css`) but are deliberately
kept out of the editor — see [What is NOT editable](#what-is-not-editable-and-why)
below.

---

## At a glance

| Token | Label in editor | Type | Default per base |
| --- | --- | --- | --- |
| `--accent-primary` | Accent color | hex `#rrggbb` | dark `#a78bfa` · light `#5b21b6` · high-contrast `#ffff00` |
| `--accent-secondary` | Secondary accent | hex `#rrggbb` | dark `#7dd3fc` · light `#075985` · high-contrast `#00ffff` |
| `--secondary-bg` | Surface color | hex `#rrggbb` | dark `#151921` · light `#ffffff` · high-contrast `#000000` |
| `--text-primary` | Text color | hex `#rrggbb` | dark `#f8fafc` · light `#0f172a` · high-contrast `#ffffff` |
| `--radius-md` | Corner radius | integer `0–24` px | all bases: `12px` |
| `--font-scale` | Font size | number `0.8–1.5` step `0.05` | dark `1` · light `1` · high-contrast `1.25` |
| `--glass-blur-amount` | Glass blur | integer `0–32` px | dark `16` · light `16` · high-contrast `0` |
| `--motion-scale` | Animation speed | number `0–1` step `0.1` | dark `1` · light `1` · high-contrast `0` |

---

## Accent color (`--accent-primary`)

The headline colour. Drives primary buttons, the active state of nav
tabs, link colour, focus rings on form fields, the picker's "selected"
ring, and the glow effect under buttons.

- **Input:** hex colour, `#rrggbb` (6-digit). The editor's swatch sets it.
- **Defaults:**
  - Dark — `#a78bfa` (soft lavender)
  - Light — `#5b21b6` (deep purple, AAA on white)
  - High Contrast — `#ffff00` (yellow)

```
Primary button         [ Save ]   ← accent-primary background, white label
Active nav tab         ─────      ← accent-primary underline
Link in body           click me   ← accent-primary text on body bg
Selected radio         (●)         ← accent-primary inner dot
Card glow on hover     ▒░░░░░▒    ← accent-primary @ 30% alpha
```

**Recommendation:** any colour passing 7:1 against your surface
(`--secondary-bg`). The editor doesn't enforce this — the system tests
contrast for the built-in themes via `theme.wcag-values.md` but a custom
choice is your call. Going much lighter than the surface makes button
labels (which are always white over `--accent-primary`) unreadable.

---

## Secondary accent (`--accent-secondary`)

Quieter accent. Used for informational badges, secondary buttons,
"download" / "share" icons, and the second glow tier.

- **Input:** hex colour, `#rrggbb`.
- **Defaults:**
  - Dark — `#7dd3fc` (sky blue)
  - Light — `#075985` (deep cyan, AAA on white)
  - High Contrast — `#00ffff` (cyan)

```
Info chip          [ verified ]   ← accent-secondary bg
Secondary icon         ⓘ           ← accent-secondary glyph
Subtle glow            ░░░░░       ← accent-secondary @ 30%
```

**Tip:** pick a hue distinct from `--accent-primary` so the two stay
distinguishable when both appear on the same screen (e.g. a primary
button next to an info badge).

---

## Surface color (`--secondary-bg`)

The colour of cards, panels, modal bodies, and inline backgrounds —
not the full-page background (that's controlled separately by
`--primary-bg` and not exposed to the editor).

- **Input:** hex colour, `#rrggbb`.
- **Defaults:**
  - Dark — `#151921` (near-black, slightly blue)
  - Light — `#ffffff` (pure white)
  - High Contrast — `#000000` (pure black)

```
┌──────────────────────┐
│  card surface        │   ← --secondary-bg fills the card
│                      │
│  ┌──────────────┐    │
│  │ button       │    │
│  └──────────────┘    │
└──────────────────────┘
```

**Tip:** the full-page background (the gradient or solid behind every
card) is computed from a sibling token. Editing only `--secondary-bg`
will create cards that contrast with the page bg — which is fine, often
desired. If you want a flat single-tone look, pick a colour close to
the page bg of your base theme.

---

## Text color (`--text-primary`)

The dominant text colour: headings, body copy, button labels (on the
non-primary surfaces), input text.

- **Input:** hex colour, `#rrggbb`.
- **Defaults:**
  - Dark — `#f8fafc` (off-white)
  - Light — `#0f172a` (near-black slate)
  - High Contrast — `#ffffff` (pure white)

```
H1  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     ← --text-primary
H2  ▓▓▓▓▓▓▓▓▓▓▓▓▓
p   ░░░░░░░░░░░░░░░░░░    ← --text-secondary (derived, not editable)
```

**Hard requirement:** keep ≥ 4.5:1 against `--secondary-bg`, or body
text becomes unreadable. The editor doesn't enforce this; the
[`theme.wcag-values.md`](theme.wcag-values.md) audit document is the
reference for what passes.

---

## Corner radius (`--radius-md`)

How rounded the corners are on cards, buttons, inputs, and panels.

- **Input:** integer pixel value, `0–24`.
- **Defaults:** `12px` across all three base themes.

```
0px        4px        8px        12px       24px
┌──────┐  ╭──────╮  ╭──────╮  ╭──────╮  ╭───────╮
│ btn  │  │ btn  │  │  btn │  │  btn │  │   btn │
└──────┘  ╰──────╯  ╰──────╯  ╰──────╯  ╰───────╯
sharp     subtle    soft      default   pill-ish
```

**Tip:** `0px` makes the whole UI look more "documentary" / utility;
`24px` reads as friendlier / softer. Most users won't touch this.

---

## Font size (`--font-scale`)

A multiplier on every text size in the app. Doesn't change which
elements are headings vs body — just scales the type ramp uniformly.

- **Input:** number `0.8–1.5`, in steps of `0.05`.
- **Defaults:**
  - Dark — `1` (100%)
  - Light — `1` (100%)
  - High Contrast — `1.25` (125%, large-print)

```
0.8x   sm  sm  sm  sm sm sm sm           (compact)
1.0x   md  md  md  md  md  md            (default)
1.25x  LG  LG  LG  LG    LG    LG        (high-contrast default)
1.5x   XL    XL    XL    XL              (max)
```

**How it works:** every text element in the app reads a token like
`var(--font-size-md)`, which is defined as `calc(1rem * var(--font-scale))`.
Changing the slider rewrites the multiplier; every text element resizes
proportionally on the next paint. No per-component change needed.

**Tip:** use this for accessibility before reaching for a custom theme.
If 1.0× feels small but the rest of the palette is fine, just bumping
`--font-scale` to 1.1 fixes that without touching colour.

---

## Glass blur (`--glass-blur-amount`)

The strength of the frosted-glass effect on cards, modals, and overlays.

- **Input:** integer pixel value, `0–32`.
- **Defaults:**
  - Dark — `16px`
  - Light — `16px`
  - High Contrast — `0px` (glass disabled entirely)

```
0px       8px       16px      24px      32px
┌─────┐   ░─────░   ▒─────▒   ▓─────▓   ████─████
│card │   ░card ░   ▒card ▒   ▓card ▓   █  card █
└─────┘   ░─────░   ▒─────▒   ▓─────▓   ████─████
solid     subtle    default   heavy     opaque-ish
```

**Tip:** `0px` is the right choice for the high-contrast theme because
blur reduces colour contrast. For a flatter aesthetic in dark/light,
try `4px` — a hint of frostiness without the heavy modern-OS look.

---

## Animation speed (`--motion-scale`)

A multiplier on every transition/animation duration. `1` is normal,
`0` is "instant — no animation at all".

- **Input:** number `0–1`, in steps of `0.1`.
- **Defaults:**
  - Dark — `1` (full speed)
  - Light — `1`
  - High Contrast — `0` (motion off; accessibility)

```
1.0x   ─────►   full duration, smooth easing
0.5x   ──►      half-duration, snappier
0.0x   ▮        instant, no animation
```

**Accessibility note:** the OS-level "reduced motion" preference also
forces this to `0` regardless of your theme choice — so the slider is
useful when you want *some* motion-reduction (say `0.4`) without going
to zero. Setting `0` here matches the high-contrast accessibility intent
but with your own colour palette.

**How it works:** transitions use the pattern
`transition: all calc(250ms * var(--motion-scale)) ease`. When the scale
is `0`, every duration collapses to `0ms`. The OS-level override is a
single `@media (prefers-reduced-motion: reduce)` block in `tokens.css`.

---

## What is NOT editable, and why

The editor deliberately surfaces a curated subset. Tokens kept out of
the modal:

- **Type ramp (`--font-size-xs`–`--font-size-2xl`).** Derived from
  `--font-scale` via `calc()`. Surfacing them individually would let
  users break the proportional ramp (and then complain that things
  look "off"). Use `--font-scale` instead.

- **Spacing ramp (`--space-xs`–`--space-2xl`).** Rem-based; tracks
  `--font-scale` automatically. Independent editing would create
  visual rhythm bugs.

- **Shadow tokens (`--shadow-sm`/`md`/`lg`/`xl`).** Multi-stop CSS
  values; no clean colour-picker maps onto them. Power users can
  hand-edit in `custom_theme.txt`.

- **Border opacity tiers (`--border-subtle`/`medium`/`strong`).** rgba
  alpha tokens that only make sense once you've decided on a surface
  colour. Most users will be fine with the defaults; power users can
  override via the JSON file.

- **Status colour pairs (`--status-*`/`--status-*-bg`).** Eight tokens
  that have to move together. Surface them in a future "status palette"
  picker if real demand appears.

- **`--primary-bg`.** The full-page background — usually a gradient or
  complex value. Picking a single colour for it would lose the visual
  depth the gradient gives. Hand-editable in the JSON if you want a
  flat page bg.

- **Glow tokens (`--glow-primary`/`secondary`/`success`).** Computed
  rgba expressions that should track the accent colours, not be set
  independently. Future work: auto-derive glow from accent.

- **Per-component bespoke tokens** like `--compose-attachment-pill-bg`.
  Component-scope; not part of the global token surface.

If you need to set one of these, hand-edit `custom_theme.txt` per the
spec in [`theme.custom-format.md`](theme.custom-format.md). The
validation rules are the same — the editor just surfaces fewer of them.

---

## Related

- [`theme.custom-format.md`](theme.custom-format.md) — JSON file format
  for power users / tooling.
- [`theme.wcag-values.md`](theme.wcag-values.md) — measured contrast
  ratios for the three base themes.
- [`theme.smoke-test.md`](theme.smoke-test.md) — visual smoke-test
  checklist; the editor's flow lives at `P3.1–P3.9`.
- `src/styles/tokens.css` / `src/styles/themes.css` — canonical
  definitions if you want the full vocabulary.
- `src/theme/ThemeEditorModal.jsx` — the modal that consumes this list.
  The `EDITABLE` array in that file is the source of truth for which
  tokens are surfaced; this doc tracks it.
