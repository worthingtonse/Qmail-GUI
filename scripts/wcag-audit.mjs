// One-shot WCAG audit for the light + high-contrast palettes.
// Not committed; output transcribed into docs/theme.wcag-values.md.
//
// Uses the WCAG 2.x relative-luminance formula:
//   1. sRGB channel c' = c / 255
//   2. linear = c' <= 0.03928 ? c'/12.92 : ((c'+0.055)/1.055) ** 2.4
//   3. L = 0.2126*R + 0.7152*G + 0.0722*B
//   4. contrast = (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter
//
// rgba(...) values are composited over a solid parent first.

const hexToRgb = (hex) => {
  const m = hex.replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
    a: 1,
  };
};

const rgbaToObj = (s) => {
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (!m) throw new Error(`bad rgba: ${s}`);
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
};

const parse = (s) => (s.startsWith("#") ? hexToRgb(s) : rgbaToObj(s));

// "src OVER dst" alpha compositing, both opaque output.
const composite = (src, dst) => {
  const a = src.a;
  return {
    r: Math.round(src.r * a + dst.r * (1 - a)),
    g: Math.round(src.g * a + dst.g * (1 - a)),
    b: Math.round(src.b * a + dst.b * (1 - a)),
    a: 1,
  };
};

const relLum = ({ r, g, b }) => {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (a, b) => {
  const L1 = relLum(a);
  const L2 = relLum(b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
};

const flags = (ratio) => ({
  AA_norm: ratio >= 4.5,
  AA_large: ratio >= 3,
  AAA_norm: ratio >= 7,
  AAA_large: ratio >= 4.5,
});

const resolveOnParent = (fg, parent) => {
  const f = parse(fg);
  const p = parse(parent);
  if (f.a === 1) return f;
  if (p.a !== 1) throw new Error("nested rgba parent not supported");
  return composite(f, p);
};

const evalPair = (fgRaw, bgRaw, label) => {
  const fg = parse(fgRaw);
  const bg = parse(bgRaw);
  let resolvedFg = fg;
  if (fg.a < 1) resolvedFg = composite(fg, bg);
  const c = contrast(resolvedFg, bg);
  const f = flags(c);
  return {
    label,
    fg: fgRaw,
    bg: bgRaw,
    ratio: c,
    flags: f,
  };
};

// ============ LIGHT THEME ============
// P2 (b) post-swap values. Compare against Track B baseline by
// reverting the changed entries (see git log).
const L = {
  primary_bg_start:   "#f8fafc",
  primary_bg_end:     "#eef2f7",
  secondary_bg:       "#ffffff",
  tertiary_bg:        "rgba(15, 20, 25, 0.04)",
  card_bg:            "#ffffff",
  card_hover:         "#f1f5f9",
  accent_primary:     "#5b21b6",   // was #6d28d9
  accent_secondary:   "#075985",   // was #0284c7
  accent_tertiary:    "#92400e",   // was #d97706
  accent_success:     "#065f46",   // was #059669
  accent_error:       "#991b1b",   // was #dc2626
  accent_warning:     "#92400e",   // was #d97706
  text_primary:       "#0f172a",
  text_secondary:     "#334155",
  text_tertiary:      "#475569",   // was #64748b
  text_muted:         "rgba(51, 65, 85, 0.8)",  // was alpha 0.6
  border_subtle:      "rgba(15, 20, 25, 0.08)",
  border_medium:      "rgba(15, 20, 25, 0.12)",
  border_strong:      "rgba(15, 20, 25, 0.2)",
};

const lightPairs = [
  ["text-primary on primary-bg (start #f8fafc)", L.text_primary, L.primary_bg_start],
  ["text-primary on primary-bg (end   #eef2f7)", L.text_primary, L.primary_bg_end],
  ["text-primary on secondary-bg / card-bg",      L.text_primary, L.secondary_bg],
  ["text-secondary on primary-bg (start)",        L.text_secondary, L.primary_bg_start],
  ["text-secondary on primary-bg (end)",          L.text_secondary, L.primary_bg_end],
  ["text-secondary on secondary-bg / card-bg",    L.text_secondary, L.secondary_bg],
  ["text-tertiary on primary-bg (start)",         L.text_tertiary, L.primary_bg_start],
  ["text-tertiary on primary-bg (end)",           L.text_tertiary, L.primary_bg_end],
  ["text-tertiary on secondary-bg / card-bg",     L.text_tertiary, L.secondary_bg],
  ["text-muted on primary-bg (start)",            L.text_muted, L.primary_bg_start],
  ["text-muted on primary-bg (end)",              L.text_muted, L.primary_bg_end],
  ["text-muted on secondary-bg / card-bg",        L.text_muted, L.secondary_bg],
  ["accent-primary on primary-bg (start)",        L.accent_primary, L.primary_bg_start],
  ["accent-primary on secondary-bg / card-bg",    L.accent_primary, L.secondary_bg],
  ["accent-secondary on secondary-bg",            L.accent_secondary, L.secondary_bg],
  ["accent-success on secondary-bg",              L.accent_success, L.secondary_bg],
  ["accent-error on secondary-bg",                L.accent_error, L.secondary_bg],
  ["accent-tertiary/warning on secondary-bg",     L.accent_tertiary, L.secondary_bg],
  ["white on accent-primary (button label)",      "#ffffff", L.accent_primary],
  ["white on accent-secondary",                   "#ffffff", L.accent_secondary],
  ["white on accent-success",                     "#ffffff", L.accent_success],
  ["white on accent-error",                       "#ffffff", L.accent_error],
  ["white on accent-warning",                     "#ffffff", L.accent_warning],
];

// ============ HIGH-CONTRAST THEME ============
const H = {
  primary_bg:         "#000000",
  secondary_bg:       "#000000",
  tertiary_bg:        "#000000",
  card_bg:            "#000000",
  card_hover:         "#1a1a00",
  accent_primary:     "#ffff00",
  accent_secondary:   "#00ffff",
  accent_tertiary:    "#ffff00",
  accent_success:     "#00ff00",
  accent_error:       "#ff6666",   // was #ff5555
  accent_warning:     "#ffff00",
  text_primary:       "#ffffff",
  text_secondary:     "#ffff00",
  text_tertiary:      "#ffff00",
  text_muted:         "#ffff00",
  border_subtle:      "#ffffff",
  border_medium:      "#ffffff",
  border_strong:      "#ffffff",
};

const hcPairs = [
  ["text-primary on primary-bg",            H.text_primary, H.primary_bg],
  ["text-secondary on primary-bg",          H.text_secondary, H.primary_bg],
  ["text-tertiary on primary-bg",           H.text_tertiary, H.primary_bg],
  ["text-muted on primary-bg",              H.text_muted, H.primary_bg],
  ["accent-primary on primary-bg",          H.accent_primary, H.primary_bg],
  ["accent-secondary on primary-bg",        H.accent_secondary, H.primary_bg],
  ["accent-success on primary-bg",          H.accent_success, H.primary_bg],
  ["accent-error on primary-bg",            H.accent_error, H.primary_bg],
  ["accent-warning on primary-bg",          H.accent_warning, H.primary_bg],
  ["text-primary on card-hover (#1a1a00)",  H.text_primary, H.card_hover],
  ["accent-primary on card-hover",          H.accent_primary, H.card_hover],
  ["black on accent-primary (button label)", "#000000", H.accent_primary],
  ["black on accent-secondary",             "#000000", H.accent_secondary],
  ["black on accent-success",               "#000000", H.accent_success],
  ["black on accent-error",                 "#000000", H.accent_error],
  ["border #ffffff on primary-bg (focus)",  "#ffffff", H.primary_bg],
  ["focus outline #ffff00 on primary-bg",   "#ffff00", H.primary_bg],
];

const fmtRow = (r) => {
  const t = (b) => (b ? "PASS" : "fail");
  const flagsStr = [
    `AA-norm:${t(r.flags.AA_norm)}`,
    `AA-large:${t(r.flags.AA_large)}`,
    `AAA-norm:${t(r.flags.AAA_norm)}`,
    `AAA-large:${t(r.flags.AAA_large)}`,
  ].join("  ");
  return `${r.ratio.toFixed(2).padStart(5)}:1   ${flagsStr}   ${r.label}`;
};

const runSet = (label, pairs) => {
  console.log(`\n========== ${label} ==========`);
  const results = pairs.map(([lbl, fg, bg]) => evalPair(fg, bg, lbl));
  for (const r of results) console.log(fmtRow(r));
  const failsAA = results.filter((r) => !r.flags.AA_norm);
  const failsAAA = results.filter((r) => r.flags.AA_norm && !r.flags.AAA_norm);
  console.log(`\n  AA-normal fails: ${failsAA.length}`);
  for (const r of failsAA) console.log(`    - ${r.label}  (${r.ratio.toFixed(2)}:1)`);
  console.log(`  AA passes but AAA-normal fails: ${failsAAA.length}`);
  for (const r of failsAAA) console.log(`    - ${r.label}  (${r.ratio.toFixed(2)}:1)`);
  return results;
};

// ============ PROPOSED ADJUSTMENTS ============
// For each pair that fails AAA, try a darker/lighter shade and report
// whether it now passes. Tries are deliberate small shifts.
const tryAdjustment = (label, fg, bg, target = 7) => {
  const r = evalPair(fg, bg, label);
  return { label, fg, bg, ratio: r.ratio, pass: r.ratio >= target };
};

runSet("LIGHT", lightPairs);
runSet("HIGH-CONTRAST", hcPairs);

// Quick "what if" experiments for the proposals section.
console.log("\n========== LIGHT — adjustment experiments ==========");
const adjustments = [
  // accent-primary deeper purples
  ["#6d28d9 on #ffffff (baseline)",      "#6d28d9", "#ffffff"],
  ["#5b21b6 on #ffffff",                 "#5b21b6", "#ffffff"],
  ["#4c1d95 on #ffffff",                 "#4c1d95", "#ffffff"],
  // accent-secondary deeper cyan
  ["#0284c7 on #ffffff (baseline)",      "#0284c7", "#ffffff"],
  ["#0369a1 on #ffffff",                 "#0369a1", "#ffffff"],
  ["#075985 on #ffffff",                 "#075985", "#ffffff"],
  // accent-success deeper green
  ["#059669 on #ffffff (baseline)",      "#059669", "#ffffff"],
  ["#047857 on #ffffff",                 "#047857", "#ffffff"],
  ["#065f46 on #ffffff",                 "#065f46", "#ffffff"],
  // accent-error deeper red
  ["#dc2626 on #ffffff (baseline)",      "#dc2626", "#ffffff"],
  ["#b91c1c on #ffffff",                 "#b91c1c", "#ffffff"],
  ["#991b1b on #ffffff",                 "#991b1b", "#ffffff"],
  // accent-tertiary/warning amber
  ["#d97706 on #ffffff (baseline)",      "#d97706", "#ffffff"],
  ["#b45309 on #ffffff",                 "#b45309", "#ffffff"],
  ["#92400e on #ffffff",                 "#92400e", "#ffffff"],
  // text-tertiary
  ["#64748b on #ffffff (baseline)",      "#64748b", "#ffffff"],
  ["#475569 on #ffffff",                 "#475569", "#ffffff"],
  ["#334155 on #ffffff",                 "#334155", "#ffffff"],
  // text-muted (rgba composited)
  ["rgba(51,65,85,0.6) on #ffffff (baseline)", "rgba(51, 65, 85, 0.6)", "#ffffff"],
  ["rgba(51,65,85,0.8) on #ffffff",            "rgba(51, 65, 85, 0.8)", "#ffffff"],
  ["rgba(51,65,85,1.0) on #ffffff",            "rgba(51, 65, 85, 1.0)", "#ffffff"],
  // white-on-accent (button labels)
  ["#ffffff on #6d28d9 (baseline)",      "#ffffff", "#6d28d9"],
  ["#ffffff on #5b21b6",                 "#ffffff", "#5b21b6"],
  ["#ffffff on #0284c7 (baseline)",      "#ffffff", "#0284c7"],
  ["#ffffff on #0369a1",                 "#ffffff", "#0369a1"],
  ["#ffffff on #075985",                 "#ffffff", "#075985"],
  ["#ffffff on #059669 (baseline)",      "#ffffff", "#059669"],
  ["#ffffff on #047857",                 "#ffffff", "#047857"],
  ["#ffffff on #065f46",                 "#ffffff", "#065f46"],
];

for (const [label, fg, bg] of adjustments) {
  const r = evalPair(fg, bg, label);
  console.log(fmtRow(r));
}

console.log("\n========== HIGH-CONTRAST — adjustment experiments ==========");
const hcAdjustments = [
  ["#ff5555 on #000000 (baseline)", "#ff5555", "#000000"],
  ["#ff6060 on #000000",            "#ff6060", "#000000"],
  ["#ff6666 on #000000",            "#ff6666", "#000000"],
  ["#ff7777 on #000000",            "#ff7777", "#000000"],
  ["#ff8888 on #000000",            "#ff8888", "#000000"],
  ["#000000 on #ff5555 (baseline)", "#000000", "#ff5555"],
  ["#000000 on #ff6666",            "#000000", "#ff6666"],
];

for (const [label, fg, bg] of hcAdjustments) {
  const r = evalPair(fg, bg, label);
  console.log(fmtRow(r));
}
