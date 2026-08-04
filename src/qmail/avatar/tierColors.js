/**
 * tierColors.js — denomination tier → box color.
 *
 * The border/tint encodes the address class on a danger→safety spectrum:
 * red = danger, violet = very safe. Shared by the cartouche avatar box and
 * the reading pane's tier chips/glow.
 */
export const TIER_BOX_COLORS = {
  bit: "#ef4444", // red — danger
  byte: "#f59e0b", // orange
  kilo: "#22c55e", // green — safe
  mega: "#3b82f6", // blue
  giga: "#8b5cf6", // purple
  epic: "#d946ef", // violet — very safe
};
