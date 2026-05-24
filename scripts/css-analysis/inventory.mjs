// scripts/css-analysis/inventory.mjs
// Stage 1: walk every CSS file in config.css_files, parse with
// postcss, emit one row per rule with raw declarations preserved.
// No normalisation yet — that's the next stage.

import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

import {
  REPO_ROOT,
  countJsxRefs,
  guessBlock,
  listJsxFiles,
  loadConfig,
  writeCache,
} from "./lib.mjs";

const cfg = loadConfig();
const jsxFiles = listJsxFiles();

const inventory = [];

for (const relPath of cfg.css_files) {
  const fullPath = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[inventory] missing file (skipped): ${relPath}`);
    continue;
  }
  const css = fs.readFileSync(fullPath, "utf8");
  const root = postcss.parse(css, { from: fullPath });

  root.walkRules((rule) => {
    // postcss gives us a comma-separated selector list per rule.
    const selectors = rule.selectors;
    for (const sel of selectors) {
      // Only classify class selectors; element / pseudo / @-rules
      // would muddy the inventory.
      if (!sel.trimStart().startsWith(".")) continue;

      // Pull the first class token out of compound selectors like
      // ".nav-tab.active" or ".btn:hover" so block-guess gets a clean
      // name.
      const m = sel.match(/^\s*\.([a-zA-Z_][a-zA-Z0-9_-]*)/);
      if (!m) continue;
      const primaryClass = m[1];

      // Capture each declaration's raw value.
      const decls = {};
      rule.walkDecls((d) => {
        // Keep last-wins when the same property appears twice.
        decls[d.prop] = d.value;
      });

      const propertySet = Object.keys(decls).sort().join("|");

      inventory.push({
        id: `${relPath}:${rule.source.start.line}:${sel.trim()}`,
        file: relPath,
        line: rule.source.start.line,
        selector: sel.trim(),
        primary_class: primaryClass,
        block: guessBlock(primaryClass, relPath),
        property_set: propertySet,
        raw_declarations: decls,
        jsx_refs: countJsxRefs(primaryClass, jsxFiles),
      });
    }
  });
}

const outPath = writeCache("inventory", inventory);
console.log(`[inventory] ${inventory.length} class-rule rows -> ${outPath}`);
