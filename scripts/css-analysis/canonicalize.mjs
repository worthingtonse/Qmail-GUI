// scripts/css-analysis/canonicalize.mjs
// Stage 2: read raw inventory, normalise each declaration (rgb->hex
// short form, 0px->0, exact token lookup), emit canonical signatures.
//
// Per plan §3.2 (post GPT review item 4): normalisation here is
// EXACT-MATCH only. No 5% bucketing, no rounding. Fuzzy clustering is
// a separate pass in cluster.mjs.

import {
  loadConfig,
  lookupToken,
  normalizeValue,
  readCache,
  sha1,
  writeCache,
} from "./lib.mjs";

const cfg = loadConfig();
const inventory = readCache("inventory");

const canonical = inventory.map((row) => {
  // Build raw + normalised declaration maps.
  const rawDecls = row.raw_declarations;

  const normalizedDecls = {};
  const tokensUsed = new Set();
  const remainingRawValues = {};

  for (const [prop, val] of Object.entries(rawDecls)) {
    const norm = normalizeValue(val, prop, cfg);
    normalizedDecls[prop] = norm;

    // Track tokens that the row resolves to.
    // Catch both "value WAS already a var(...)" and "normaliseValue
    // mapped it to one".
    const tokenMatches = norm.match(/var\(\s*--[a-zA-Z0-9-]+\s*\)/g);
    if (tokenMatches) {
      for (const t of tokenMatches) tokensUsed.add(t);
    } else {
      // No token in the normalised value — surfaces raw debt.
      // Skip global-keywords / unitless numbers / `0` which aren't debt.
      const isGlobal = /^(initial|inherit|unset|revert|none|auto|normal|currentColor|transparent)$/i.test(norm);
      const isPureZero = norm === "0";
      if (!isGlobal && !isPureZero) {
        // Check whether the value HAS a hex/rgba/raw font-size literal
        // (= the kinds we want to flag) before flagging as remaining.
        const hasColourLiteral = /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(norm);
        const isColourProp = cfg.color_props.includes(prop);
        const hasRawFontSize = cfg.font_size_props.includes(prop) && /[0-9.]+(px|rem|em)\b/.test(norm);
        const hasRawSpacing = cfg.spacing_props.includes(prop) && /\b[0-9.]+(px|rem|em)\b/.test(norm);
        const hasRawRadius = cfg.radius_props.includes(prop) && /\b[0-9.]+(px|rem|em)\b/.test(norm);

        if ((isColourProp && hasColourLiteral) || hasRawFontSize || hasRawSpacing || hasRawRadius) {
          remainingRawValues[prop] = norm;
        }
      }
    }
  }

  // Canonical signature = sorted "prop:value" joined by ';'.
  // Exact only — see GPT review item 4.
  const sortedProps = Object.keys(normalizedDecls).sort();
  const canonicalString = sortedProps
    .map((p) => `${p}:${normalizedDecls[p]}`)
    .join(";");

  const rawString = sortedProps
    .map((p) => `${p}:${rawDecls[p]}`)
    .join(";");

  return {
    ...row,
    normalized_declarations: normalizedDecls,
    tokens_used: Array.from(tokensUsed).sort(),
    remaining_raw_values: remainingRawValues,
    canonical_signature: canonicalString,
    decl_hash_raw: sha1(rawString),
    decl_hash_normalized: sha1(canonicalString),
  };
});

const outPath = writeCache("canonicalized", canonical);
console.log(`[canonicalize] ${canonical.length} rows normalised -> ${outPath}`);

// Tiny sanity report.
const debtRows = canonical.filter(
  (r) => Object.keys(r.remaining_raw_values).length > 0
);
console.log(
  `[canonicalize] ${debtRows.length} rows still carry raw colour / font-size / spacing / radius literals`
);
