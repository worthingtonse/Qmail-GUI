// scripts/css-analysis/cluster.mjs
// Stage 3: three clustering algorithms per plan §3.2.
//
// Algorithm 1 — exact-duplicate detection
//   Group by decl_hash_normalized. Clusters of size >= primitive_threshold
//   become primitive candidates immediately.
//
// Algorithm 2 — fuzzy / near-duplicate clustering
//   Same property_set. >=80% of normalised values match exactly.
//   Remaining numeric values differ by <= 5% (configurable).
//   THIS is where the fuzzy tolerance lives — not in canonicalize.mjs.
//
// Algorithm 3 — family / collision graph
//   Selectors with identical primary class names across files = same
//   class re-declared (potential primitive). Selectors that share a
//   name prefix but live in different blocks = naming-collision risk.

import { loadConfig, readCache, writeCache } from "./lib.mjs";

const cfg = loadConfig();
const TOL = cfg.fuzzy_tolerance_pct / 100;
const THRESHOLD = cfg.primitive_threshold;

const rows = readCache("canonicalized");

// ---------- Algorithm 1: exact duplicates ----------

const exactBuckets = new Map();
for (const row of rows) {
  const key = row.decl_hash_normalized;
  if (!exactBuckets.has(key)) exactBuckets.set(key, []);
  exactBuckets.get(key).push(row.id);
}

// Per GPT review Q1: an inventory row is one *selector occurrence*,
// not one *edit site*. A rule like ".a, .b, .c { ... }" produces three
// inventory rows but is one site in the source CSS. We report both:
//   selector_occurrences = total inventory rows in the cluster
//                          (semantic spread / rename blast radius)
//   site_count           = unique `file:line` count
//                          (actual CSS edit sites)
function countSites(memberIds) {
  const sites = new Set();
  for (const id of memberIds) {
    // id format: "file/path.css:LINE:.selector"
    const idx = id.lastIndexOf(":");
    if (idx === -1) continue;
    sites.add(id.slice(0, idx));
  }
  return sites.size;
}

const exactClusters = [];
for (const [hash, ids] of exactBuckets) {
  if (ids.length >= THRESHOLD) {
    // Pull one representative row for the signature so the report has
    // something readable.
    const rep = rows.find((r) => r.decl_hash_normalized === hash);
    exactClusters.push({
      hash,
      selector_occurrences: ids.length,
      site_count: countSites(ids),
      signature: rep.canonical_signature,
      property_set: rep.property_set,
      members: ids,
    });
  }
}
exactClusters.sort((a, b) => b.selector_occurrences - a.selector_occurrences);

// ---------- Algorithm 2: fuzzy / near-duplicate ----------
//
// Within each property_set, compare every pair. Two rows are
// "fuzzy-equivalent" when:
//   - same property_set
//   - >=80% of (prop, value) pairs match exactly
//   - the non-matching pairs are all numeric and differ by <= TOL
//
// We then build clusters using transitive equivalence: A~B and B~C
// implies all three live in the same fuzzy cluster.

function extractNumber(value) {
  // Returns { n, unit } for pure scalar values like "12px",
  // "1.25rem", "0.5". Returns null for shorthands ("8px 16px") or
  // non-numerics ("var(--space-md)", "#ffeb3b"). Unitless numbers
  // get unit: "".
  const m = String(value).match(/^(-?[\d.]+)(px|rem|em|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return { n, unit: m[2] || "" };
}

function numericallyClose(a, b) {
  const pa = extractNumber(a);
  const pb = extractNumber(b);
  if (pa === null || pb === null) return false;

  // Special-case zero — 0, 0px, 0rem, 0em, 0% all mean the same thing.
  if (pa.n === 0 && pb.n === 0) return true;

  // Require IDENTICAL units (per GPT review item #1). Without this,
  // 1rem ≈ 1em ≈ 100% ≈ 100px would all match — silently wrong.
  // Cross-unit conversion (px <-> rem) would need an explicit
  // conversion rule and is deferred.
  if (pa.unit !== pb.unit) return false;

  const denom = Math.max(Math.abs(pa.n), Math.abs(pb.n));
  return Math.abs(pa.n - pb.n) / denom <= TOL;
}

function fuzzyEquivalent(rowA, rowB) {
  if (rowA.property_set !== rowB.property_set) return false;
  const props = rowA.property_set.split("|").filter(Boolean);
  if (props.length === 0) return false;

  let matches = 0;
  let nearMisses = 0;
  for (const p of props) {
    const va = rowA.normalized_declarations[p];
    const vb = rowB.normalized_declarations[p];
    if (va === vb) {
      matches++;
    } else if (numericallyClose(va, vb)) {
      nearMisses++;
    } else {
      return false; // Hard mismatch on a non-numeric value.
    }
  }

  // At least one near-miss is required — otherwise the pair is an
  // exact duplicate and belongs to Algorithm 1, not here.
  if (nearMisses === 0) return false;

  // Single-property rule-sets: ANY near-miss means we're in the
  // fuzzy zone (no other props to anchor an "80% match" denominator).
  if (props.length === 1) return true;

  // Multi-property rule-sets: ≥80% of properties must match exactly,
  // the rest can be near-misses (already vetted by numericallyClose).
  return matches / props.length >= 0.8;
}

// Group rows by property_set first so we don't compare across
// incompatible sets.
const bySet = new Map();
for (const row of rows) {
  if (!bySet.has(row.property_set)) bySet.set(row.property_set, []);
  bySet.get(row.property_set).push(row);
}

// Union-Find for transitive grouping.
function makeUF(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  return { find, union };
}

const fuzzyClusters = [];
for (const [propSet, group] of bySet) {
  if (group.length < THRESHOLD) continue;
  const uf = makeUF(group.length);
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      // Skip pairs that are already exact equals — they're already
      // captured by Algorithm 1.
      if (group[i].decl_hash_normalized === group[j].decl_hash_normalized) continue;
      if (fuzzyEquivalent(group[i], group[j])) {
        uf.union(i, j);
      }
    }
  }
  // Collect clusters.
  const buckets = new Map();
  for (let i = 0; i < group.length; i++) {
    const root = uf.find(i);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(group[i]);
  }
  for (const [, members] of buckets) {
    // A fuzzy cluster is interesting only if it pulls in members that
    // weren't already an exact-duplicate cluster.
    const distinctHashes = new Set(members.map((m) => m.decl_hash_normalized));
    if (members.length >= THRESHOLD && distinctHashes.size >= 2) {
      fuzzyClusters.push({
        property_set: propSet,
        selector_occurrences: members.length,
        site_count: countSites(members.map((m) => m.id)),
        distinct_normalized_signatures: distinctHashes.size,
        members: members.map((m) => ({
          id: m.id,
          decl_hash_normalized: m.decl_hash_normalized,
          canonical_signature: m.canonical_signature,
        })),
      });
    }
  }
}
fuzzyClusters.sort((a, b) => b.selector_occurrences - a.selector_occurrences);

// ---------- Algorithm 3: family / collision ----------
//
// Two passes:
//   1. Same primary_class across multiple files. Often this is a
//      utility/shared class that should become a primitive.
//   2. Selectors that look like they belong to the same family
//      (.status-message, .result-item, etc.) — those become primitive
//      candidates regardless of identical declarations.

const byClass = new Map();
for (const row of rows) {
  if (!byClass.has(row.primary_class)) byClass.set(row.primary_class, []);
  byClass.get(row.primary_class).push(row);
}

const collisions = [];
for (const [className, members] of byClass) {
  const distinctFiles = new Set(members.map((m) => m.file));
  if (distinctFiles.size >= 2) {
    // Same class name in multiple files. Could be the same primitive
    // re-declared (good — extract) or a naming collision (bad — rename).
    const distinctSignatures = new Set(members.map((m) => m.decl_hash_normalized));
    collisions.push({
      class_name: className,
      distinct_files: Array.from(distinctFiles),
      file_count: distinctFiles.size,
      distinct_signatures: distinctSignatures.size,
      verdict:
        distinctSignatures.size === 1
          ? "extract-primitive"
          : "naming-collision",
      members: members.map((m) => ({ id: m.id, file: m.file })),
    });
  }
}
collisions.sort((a, b) => b.file_count - a.file_count);

// ---------- Property-frequency tables ----------
//
// Per Gem's "attribute signature" — for each property family, count
// every unique raw value. These tables feed the literal-map report.

const propertyFrequency = {
  colors: new Map(),
  font_sizes: new Map(),
  spacing: new Map(),
  radii: new Map(),
};

function bumpFreq(map, value) {
  if (!value) return;
  map.set(value, (map.get(value) || 0) + 1);
}

// Per GPT review item #4: literal-map should only carry actual RAW
// literals — not values that were already tokenised (var(--...)) in
// the source CSS. Otherwise the highest-frequency rows in the report
// are all "var(--text-primary)" mislabelled as "needs decision".
function isAlreadyTokenised(value) {
  return /var\(\s*--[a-zA-Z0-9-]+\s*\)/.test(String(value));
}

// Global keywords are not debt either.
function isGlobalKeyword(value) {
  return /^(initial|inherit|unset|revert|none|auto|normal|currentColor|transparent)$/i.test(
    String(value).trim()
  );
}

function shouldCountAsLiteral(value) {
  if (!value) return false;
  if (isAlreadyTokenised(value)) return false;
  if (isGlobalKeyword(value)) return false;
  // Pure-zero is not debt — `padding: 0`, `margin: 0`, etc. are
  // the canonical way to express no-space and don't need a token.
  const trimmed = String(value).trim();
  if (trimmed === "0" || /^0(px|rem|em)$/i.test(trimmed)) return false;
  return true;
}

for (const row of rows) {
  for (const [prop, val] of Object.entries(row.raw_declarations)) {
    if (!shouldCountAsLiteral(val)) continue;
    if (cfg.color_props.includes(prop)) bumpFreq(propertyFrequency.colors, val);
    if (cfg.font_size_props.includes(prop)) bumpFreq(propertyFrequency.font_sizes, val);
    if (cfg.spacing_props.includes(prop)) bumpFreq(propertyFrequency.spacing, val);
    if (cfg.radius_props.includes(prop)) bumpFreq(propertyFrequency.radii, val);
  }
}

const freqOut = {};
for (const [k, map] of Object.entries(propertyFrequency)) {
  freqOut[k] = Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

// ---------- Write everything ----------

const result = {
  generated_at: new Date().toISOString(),
  tolerance_pct: cfg.fuzzy_tolerance_pct,
  primitive_threshold: THRESHOLD,
  exact_clusters: exactClusters,
  fuzzy_clusters: fuzzyClusters,
  collisions: collisions,
  property_frequency: freqOut,
};

const outPath = writeCache("clusters", result);
console.log(`[cluster] exact=${exactClusters.length} fuzzy=${fuzzyClusters.length} collisions=${collisions.length} -> ${outPath}`);
