/**
 * Generate a deterministic background color from an email/name string.
 * Uses a simple djb2 hash, takes 3 bytes as RGB, then clamps brightness
 * so the white initial letter stays readable.
 */
export function avatarColorFromString(str) {
  if (!str) return { bg: "#4b5563", text: "#ffffff" };

  // djb2 hash
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }

  let r = (hash >> 16) & 0xff;
  let g = (hash >> 8) & 0xff;
  let b = hash & 0xff;

  // Clamp brightness so white text is always readable.
  // Perceived luminance: 0.299R + 0.587G + 0.114B
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum > 180) {
    // Too bright — darken by 40%
    r = Math.round(r * 0.6);
    g = Math.round(g * 0.6);
    b = Math.round(b * 0.6);
  } else if (lum < 40) {
    // Too dark — lighten
    r = Math.min(255, r + 80);
    g = Math.min(255, g + 80);
    b = Math.min(255, b + 80);
  }

  return {
    bg: `rgb(${r}, ${g}, ${b})`,
    text: "#ffffff",
  };
}
