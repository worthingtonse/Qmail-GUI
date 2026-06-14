/**
 * bake-newavatar-colors.mjs — give each cartouche symbol its own color.
 *
 * Every SVG in public/qmail-avatars/NewAvatars (000.svg..255.svg) draws with
 * fill/stroke="currentColor" and carries a root style="color: ...". This
 * script rewrites that root color per file index using golden-angle hue
 * spacing, so the 256 symbols get maximally-separated, deterministic colors:
 *
 *   hue = (index * 137.508) % 360, saturation 70%, lightness 60%
 *
 * The same index always yields the same color on every client (the color is
 * baked into the asset, not computed at render time). Idempotent — safe to
 * re-run after re-curating the symbol set.
 *
 * Usage: node scripts/bake-newavatar-colors.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FOLDER = new URL("../public/qmail-avatars/NewAvatars", import.meta.url)
  .pathname.replace(/^\/([A-Za-z]:)/, "$1"); // strip leading / on Windows

const GOLDEN_ANGLE = 137.508;
const SATURATION = 0.7;
const LIGHTNESS = 0.6;

/** hsl (h in degrees, s/l in 0..1) -> #rrggbb */
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  const toHex = (v) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function symbolColorForIndex(index) {
  const hue = (index * GOLDEN_ANGLE) % 360;
  return hslToHex(hue, SATURATION, LIGHTNESS);
}

const files = readdirSync(FOLDER).filter((f) => /^[0-9]{3}\.svg$/.test(f));
if (files.length !== 256) {
  // Uncaught throw exits node non-zero (the repo's eslint env is
  // browser-only, so process.exit is off-limits here).
  throw new Error(
    `Expected exactly 256 numbered SVGs in ${FOLDER}, found ${files.length}. Aborting.`,
  );
}

let changed = 0;
for (const file of files.sort()) {
  const index = Number(file.slice(0, 3));
  const color = symbolColorForIndex(index);
  const path = join(FOLDER, file);
  const svg = readFileSync(path, "utf8");

  // Replace the color inside the root style attribute; add one if absent.
  let updated;
  if (/style="[^"]*color:\s*[^;"]+/.test(svg)) {
    updated = svg.replace(
      /(style="[^"]*color:\s*)[^;"]+/,
      `$1${color}`,
    );
  } else {
    updated = svg.replace(/<svg /, `<svg style="color: ${color};" `);
  }

  if (updated !== svg) {
    writeFileSync(path, updated);
    changed++;
  }
}

console.log(`Baked golden-angle colors into ${changed}/256 symbol SVGs.`);
