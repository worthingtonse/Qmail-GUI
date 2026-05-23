# QMail custom-theme file format

Reference for hand-editing `custom_theme.txt` or for tooling that wants to
generate themes outside the in-app editor. The GUI's ThemeEditorModal is
the recommended path — this doc exists for the cases where it isn't (CLI
tooling, version control, "share via gist", etc.).

The canonical implementation that consumes this format is
`src/api/themeService.js` (function `validateThemePayload`). If the rules
below ever diverge from that file, the file wins.

---

## Where the file lives

The server stores it at `Data/Themes/custom_theme.txt` (per PHP spec) or
`<g_config.client_data_path>/Themes/custom_theme.txt` (per current C
implementation). The GUI never reads or writes the path directly — it
goes through the three endpoints in `themeService.js`:

- `GET    /api/system/theme`    → fetch
- `POST   /api/system/theme`    → save (body is the JSON document)
- `DELETE /api/system/theme`    → clear

See `docs/opu.theme.plan.txt` §1.4 / §8 for the endpoint contract and
the spec/implementation discrepancies still pending.

## Schema

```json
{
  "schema":  "qmail-theme/1",
  "name":    "My Theme",
  "author":  "sean",
  "base":    "dark",
  "a11y": {
    "reduced_motion": false,
    "large_print":    false
  },
  "tokens": {
    "--accent-primary":     "#22c55e",
    "--accent-secondary":   "#0284c7",
    "--secondary-bg":       "#0a0a0a",
    "--text-primary":       "#f8fafc",
    "--radius-md":          "6px",
    "--font-scale":         "1.1",
    "--glass-blur-amount":  "12px",
    "--motion-scale":       "1"
  }
}
```

### Field reference

| Field      | Required | Type              | Notes                                                                                       |
| ---------- | -------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `schema`   | no       | string            | Must equal `qmail-theme/1` if present. Unknown values are rejected.                         |
| `name`     | no       | string            | Free text, ≤64 chars in the UI; longer values are truncated. Used as the export filename.   |
| `author`   | no       | string            | Free text. Informational only.                                                              |
| `base`     | **yes**  | enum              | One of `dark`, `light`, `high-contrast`. Supplies any token you do not override.            |
| `a11y`     | no       | object            | See "Accessibility flags" below. Either flag missing or `false` means "off".                |
| `tokens`   | **yes**  | object            | Map of CSS custom-property name → string value. Empty map is allowed (means "use the base"). |

Unknown top-level fields are silently ignored. This is forward compat:
future schema versions can add fields without breaking older clients.

### Accessibility flags

| Flag             | Effect when `true`                                  |
| ---------------- | --------------------------------------------------- |
| `reduced_motion` | Forces `--motion-scale` to `0`                      |
| `large_print`    | Forces `--font-scale` to `1.25`                     |

When a flag is `true`, the override happens AFTER the `tokens` map is
applied — so the flag wins over a conflicting token entry.

### Tokens — editable subset (recommended)

The in-app editor surfaces this subset. Hand-edited themes may include
*any* CSS custom property the GUI uses (full vocabulary in
`src/styles/tokens.css`), but if you stray outside this list you're on
your own for cross-theme contrast.

| Token                  | Format                                | Example     | Editor default per base                                              |
| ---------------------- | ------------------------------------- | ----------- | -------------------------------------------------------------------- |
| `--accent-primary`     | hex `#rrggbb`                         | `#22c55e`   | dark `#a78bfa` / light `#6d28d9` / high-contrast `#ffff00`           |
| `--accent-secondary`   | hex `#rrggbb`                         | `#0284c7`   | dark `#7dd3fc` / light `#0284c7` / high-contrast `#00ffff`           |
| `--secondary-bg`       | hex `#rrggbb`                         | `#0a0a0a`   | dark `#151921` / light `#ffffff` / high-contrast `#000000`           |
| `--text-primary`       | hex `#rrggbb`                         | `#f8fafc`   | dark `#f8fafc` / light `#0f172a` / high-contrast `#ffffff`           |
| `--radius-md`          | `<n>px` (integer 0–24)                | `8px`       | `12px`                                                               |
| `--font-scale`         | unitless number (0.8–1.5, step 0.05)  | `1.1`       | `1` (high-contrast: `1.25`)                                          |
| `--glass-blur-amount`  | `<n>px` (integer 0–32)                | `12px`      | `16px` (high-contrast: `0px`)                                        |
| `--motion-scale`       | unitless number (0–1, step 0.1)       | `0.5`       | `1` (high-contrast: `0`)                                             |

## Validation rules

The server enforces a hard 8192-byte cap on the file. The GUI enforces
the same cap client-side before any POST, plus these structural rules
(applied to every theme — both saved and imported):

1. **Token keys** must match `/^--[a-z][a-z0-9-]*$/`. That is: leading
   `--`, then a letter, then zero-or-more alphanumeric / hyphen
   characters. Examples: `--accent-primary` ✅, `--Accent-Primary` ❌
   (uppercase), `---bad` ❌ (triple dash), `--9foo` ❌ (digit first).
2. **Token values** must be string scalars. The strings must NOT contain
   the substrings `;`, `}`, or `/*` — those would let a malicious file
   escape the `<style id="qmail-user-theme">` block and inject arbitrary
   CSS. Numbers must be quoted (e.g. `"1.1"`, not `1.1`).
3. **`base`** must be exactly one of `dark`, `light`, `high-contrast`.
4. **File size**: total bytes of `JSON.stringify(payload)` ≤ 8192. The
   editor disables Save and shows an oversize error before the network
   call.

A file that fails any of the above is rejected at parse time and the
GUI falls back to the base theme. No partial application — either all
the overrides land or none do.

## How tokens are applied at runtime

When the user selects "Custom" in the theme picker, the ThemeProvider
sets `<html data-theme="<base>">` (so the standard cascade still drives
non-overridden tokens) and appends a `<style id="qmail-user-theme">` tag
to `<head>` containing:

```css
:root[data-theme="custom"] {
  --accent-primary: #22c55e;
  --secondary-bg:   #0a0a0a;
  /* ...one line per token... */
  --motion-scale:   0;   /* injected by reduced_motion: true */
  --font-scale:     1.25; /* injected by large_print:    true */
}
```

When the user switches away from "custom" the `<style>` tag is removed.
Switching back re-runs the fetch.

## Worked example: dark theme with a green accent

```json
{
  "schema": "qmail-theme/1",
  "name":   "Forest",
  "author": "sean",
  "base":   "dark",
  "tokens": {
    "--accent-primary":   "#22c55e",
    "--accent-secondary": "#15803d"
  }
}
```

Drop the file at `Data/Themes/custom_theme.txt`, or POST it via the
endpoint, then switch the GUI to "Custom" and you'll get the dark theme
with green accents.

## Worked example: large-print high-contrast variant

```json
{
  "schema": "qmail-theme/1",
  "name":   "HC Larger",
  "base":   "high-contrast",
  "a11y":   { "large_print": true },
  "tokens": {
    "--font-scale": "1.5"
  }
}
```

The `a11y.large_print` flag would have forced `--font-scale: 1.25`, but
the explicit token entry takes precedence because the editor merges
flags AFTER tokens. To stick with 1.25, omit the token entry.

## What this format does NOT support

- **Per-component overrides** — only global tokens. To restyle a single
  component differently from the rest of the app, edit the component's
  CSS (a Phase 4 task).
- **Theme switching by URL query / hash** — the GUI persists the active
  theme to `localStorage[qmail.theme]`; visiting any URL with a saved
  theme just continues that theme.
- **Multiple custom themes** — one slot per server. Use Export/Import to
  swap between custom themes you've curated locally.
- **Comments in the JSON** — JSON does not support comments. Use the
  `name` field or external notes.

## Related docs

- `docs/opu.theme.plan.txt` §2.4 — the canonical schema spec.
- `docs/opu.theme.plan.txt` §1.4 / §8 — endpoint contract + discrepancies.
- `docs/theme.editable-tokens.md` (pending — Track A) — the help-panel
  content for the in-app editor. Richer descriptions and screenshots.
- `docs/theme.c-core-ticket.md` (pending — Track C) — what the C backend
  still needs to fix to fully match the public spec.
