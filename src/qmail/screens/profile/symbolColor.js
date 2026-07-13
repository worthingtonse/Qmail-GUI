/**
 * symbolColorForIndex — GUI mirror of scripts/bake-newavatar-colors.mjs.
 *
 * Each NewAvatars SVG is pre-baked with this color. Keep the algorithm in
 * lockstep so slot borders / selection rings match the baked assets.
 */

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
  const hue = (Number(index) * GOLDEN_ANGLE) % 360;
  return hslToHex(hue, SATURATION, LIGHTNESS);
}
