/**
 * serialColor.js — per-user symbol colors from the serial number.
 *
 * The LAST TWO BYTES of a QMail serial number are a 2-byte color space.
 * Reading them BIG-ENDIAN colors the TOP cartouche symbol; reading them
 * LITTLE-ENDIAN colors the BOTTOM symbol — two distinct colors per user
 * (identical only when the two bytes are equal), and the colors are part
 * of the user's identity: an impersonator can copy the two symbol glyphs
 * but not the serial that produces their colors.
 *
 * Mapping per read: first byte -> hue (x 360/256); second byte's high
 * nibble -> saturation 60..95%, low nibble -> lightness 40..65%. The
 * saturation floor makes gray impossible; the lightness band keeps every
 * color visible on both the dark frame plates and light UI chrome.
 */

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

/** One color from an ordered byte pair: hueByte drives hue, slByte S/L. */
function colorFromBytePair(hueByte, slByte) {
  const hue = (hueByte * 360) / 256;
  const saturation = 0.6 + ((slByte >> 4) & 0x0f) * (0.35 / 15);
  const lightness = 0.4 + (slByte & 0x0f) * (0.25 / 15);
  return hslToHex(hue, saturation, lightness);
}

/**
 * Both symbol colors for a serial number, or null when the serial is not a
 * valid QMail serial (callers then fall back to the symbols' baked colors).
 *
 * @param {number|string} serialNumber 3-byte QMail serial (1..0xFFFFFF)
 * @returns {{top: string, bottom: string} | null}
 */
export function serialSymbolColors(serialNumber) {
  const sn = Number(serialNumber);
  if (!Number.isInteger(sn) || sn <= 0 || sn > 0xffffff) return null;

  const hi = (sn >> 8) & 0xff;
  const lo = sn & 0xff;

  return {
    top: colorFromBytePair(hi, lo), // big-endian read: hi byte first
    bottom: colorFromBytePair(lo, hi), // little-endian read: lo byte first
  };
}
