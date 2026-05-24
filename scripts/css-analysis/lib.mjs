// Shared helpers for the css-analysis toolchain.
// All four stage scripts (inventory / canonicalize / cluster / report)
// import from here.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo root is two levels up from scripts/css-analysis/.
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export function loadConfig() {
  const cfgPath = path.join(__dirname, "config.json");
  const raw = fs.readFileSync(cfgPath, "utf8");
  return JSON.parse(raw);
}

export function readCache(name) {
  const cfg = loadConfig();
  const p = path.join(REPO_ROOT, cfg.cache_dir, `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function writeCache(name, data) {
  const cfg = loadConfig();
  const dir = path.join(REPO_ROOT, cfg.cache_dir);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

export function writeReport(filename, content) {
  const cfg = loadConfig();
  const dir = path.join(REPO_ROOT, cfg.output_dir);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, filename);
  fs.writeFileSync(p, content);
  return p;
}

export function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
}

// PascalCase / camelCase -> kebab-case. Used by the block-guess
// resolver's Rule 2 (file-derived block name).
export function fileBlockName(filePath) {
  const base = path.basename(filePath, ".css");
  return base
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

// Block-guess resolver per plan §3.1 (post GPT review item 3).
//   Rule 1: if selector contains __ or --, take prefix before that.
//   Rule 2: prefer file-derived block name if selector starts with it.
//   Rule 3: fall back to first dash-segment.
export function guessBlock(selector, filePath) {
  // Strip leading '.' if present.
  const cls = selector.startsWith(".") ? selector.slice(1) : selector;

  // Rule 1 — BEM markers.
  const bemIdx = Math.min(
    cls.indexOf("__") === -1 ? Infinity : cls.indexOf("__"),
    cls.indexOf("--") === -1 ? Infinity : cls.indexOf("--")
  );
  if (bemIdx !== Infinity) {
    return cls.slice(0, bemIdx);
  }

  // Rule 2 — file-derived block.
  const fileBlock = fileBlockName(filePath);
  if (cls === fileBlock || cls.startsWith(fileBlock + "-")) {
    return fileBlock;
  }

  // Rule 3 — first dash-segment fallback.
  const idx = cls.indexOf("-");
  return idx === -1 ? cls : cls.slice(0, idx);
}

// EXACT lookup — no fuzzy matching. Returns the token string if the
// raw value matches the configured map, or null.
export function lookupToken(rawValue, propertyName, cfg) {
  const v = String(rawValue).trim();

  // Try the relevant category first based on the property name.
  if (cfg.color_props.includes(propertyName)) {
    if (cfg.token_lookup.colors[v]) return cfg.token_lookup.colors[v];
  }
  if (cfg.font_size_props.includes(propertyName)) {
    if (cfg.token_lookup.font_sizes[v]) return cfg.token_lookup.font_sizes[v];
  }
  if (cfg.spacing_props.includes(propertyName)) {
    if (cfg.token_lookup.spacing[v]) return cfg.token_lookup.spacing[v];
  }
  if (cfg.radius_props.includes(propertyName)) {
    if (cfg.token_lookup.radii[v]) return cfg.token_lookup.radii[v];
  }

  return null;
}

// Normalize an rgb()/rgba() string to short form.
//   "rgb(  167, 139, 250 )" -> "rgb(167,139,250)"
//   "rgba(0,0,0,0.50)"     -> "rgba(0,0,0,0.5)"
export function normalizeColorNotation(v) {
  const m = v.match(/^(rgba?)\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!m) return v;
  const fn = m[1].toLowerCase();
  const r = parseFloat(m[2]);
  const g = parseFloat(m[3]);
  const b = parseFloat(m[4]);
  if (fn === "rgb") return `rgb(${r},${g},${b})`;
  const a = parseFloat(m[5] ?? "1");
  return `rgba(${r},${g},${b},${a})`;
}

// Normalize a CSS declaration value:
//   - trim whitespace
//   - 0px -> 0 (but only standalone)
//   - rgb()/rgba() short form
//   - exact token lookup (if applicable)
export function normalizeValue(value, propertyName, cfg) {
  let v = String(value).trim().replace(/\s+/g, " ");

  // Standalone-zero: "0px" "0rem" "0em" -> "0"
  v = v.replace(/\b0(px|rem|em)\b/g, "0");

  // Color short form.
  v = v.replace(/(rgba?\([^)]+\))/gi, (m) => normalizeColorNotation(m));

  // Exact token lookup. Returns token name on match, else leaves the
  // value alone — fuzzy bucketing happens later in cluster.mjs.
  const tok = lookupToken(v, propertyName, cfg);
  if (tok) v = tok;

  return v;
}

// Best-effort JSX className occurrence counter for a class. Counts
// substring matches inside className="..." and className={`...`}.
// Imperfect (e.g. dynamic className composition) but good enough for
// the inventory's jsx_refs hint column.
export function countJsxRefs(classNameWithoutDot, jsxFiles) {
  // Look for it as a whole word inside any className attribute.
  // Use a manual scan to avoid pulling in a JSX parser.
  const pattern = new RegExp(
    String.raw`className=\{?[^}]*?\b` +
      classNameWithoutDot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      String.raw`\b[^}]*?\}?`,
    "g"
  );
  let count = 0;
  for (const file of jsxFiles) {
    try {
      const text = fs.readFileSync(file, "utf8");
      const matches = text.match(pattern);
      if (matches) count += matches.length;
    } catch {
      // ignore unreadable files
    }
  }
  return count;
}

export function listJsxFiles() {
  // Walk src/ recursively for .jsx files. No glob dependency required.
  const root = path.join(REPO_ROOT, "src");
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsx")) {
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}
