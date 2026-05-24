scripts/css-analysis/ — CSS refactor inventory + clustering tool
================================================================

Implements Phase 0 of docs/opu.css-refactor.txt.

What it does
------------
Walks the 22 Phase-4 CSS files listed in config.json, parses them with
postcss, and emits:

  docs/css-audit/inventory.csv     One row per class rule.
                                    Sortable by block, property_set,
                                    decl_hash_normalized, jsx_refs, etc.
                                    Drives the "alphabetise + sort by
                                    attribute" use case.

  docs/css-audit/clusters.md       Three sections:
                                    §1 Exact-duplicate clusters
                                    §2 Fuzzy near-duplicate clusters
                                    §3 Cross-file collisions / shared
                                       primitive candidates

  docs/css-audit/literal-map.md    Per-property frequency tables.
                                    Each raw value -> configured token
                                    (if any) or "needs decision".

  docs/css-audit/jsx-refs.md       Per-class JSX usage HINT. This is a
                                    LOWER-BOUND signal — the regex only
                                    catches static class tokens inside
                                    className="...". Dynamic patterns
                                    like className={`foo-${variant}`}
                                    will undercount. Treat the column
                                    as "low-blast" / "high-blast"
                                    triage, not an exact count.

How to run
----------
  npm run css:audit

Or, equivalently, the four stages individually:

  node scripts/css-analysis/inventory.mjs
  node scripts/css-analysis/canonicalize.mjs
  node scripts/css-analysis/cluster.mjs
  node scripts/css-analysis/report.mjs

All four stages share an on-disk cache at docs/css-audit/cache/*.json
which is gitignored. The four reports themselves ARE committed so
reviewers can read them without running Node.

File layout
-----------
  config.json        File globs, token lookup table, similarity
                     thresholds. Edit this when adding new tokens.
  lib.mjs            Shared helpers (block guess, normalisation,
                     token lookup, JSX-ref counter).
  inventory.mjs      Stage 1. Postcss parse, one row per class rule.
  canonicalize.mjs   Stage 2. Exact normalisation, hashes, signature.
                     NO fuzzy bucketing here.
  cluster.mjs        Stage 3. Three algorithms:
                       1. Exact via decl_hash_normalized.
                       2. Fuzzy near-duplicate:
                          - Multi-property rule-sets: >=80% of values
                            match exactly; the rest must be same-unit
                            numeric near-misses within 5%.
                          - Single-property rule-sets: ANY single
                            same-unit numeric near-miss within 5% counts
                            as fuzzy (the >=80% gate is mathematically
                            impossible at n=1, so a single near-miss
                            is the only fuzzy case).
                          - Pairs that are already exact-equal are
                            excluded (they belong to Algorithm 1).
                       3. Family / cross-file collision.
  report.mjs         Stage 4. Emits the four committed docs.

Key design decisions (per plan §3.2)
------------------------------------
* Canonical signatures stay EXACT. The 5% fuzzy tolerance ONLY applies
  in cluster.mjs Algorithm 2. If you find yourself adding rounding to
  canonicalize.mjs, the exact-duplicate algorithm becomes pointless.

* Token lookup is EXACT-MATCH. config.json maps "#a78bfa" ->
  "var(--accent-primary)". Fuzzy "this hex is close to that token" is
  cluster.mjs's job, not canonicalize.mjs's.

* Block-guess uses three rules in order:
    1. If selector has __ or --, take prefix.
    2. Else if selector starts with the file-derived block name
       (e.g. AccountPane.css -> "account-pane"), use that.
    3. Else first dash-segment fallback.
  This catches multi-word components like .service-selection-screen.

When to re-run
--------------
* After each Phase 2 attribute sweep — to verify debt is dropping.
* After each Phase 4 archetype family closes — Phase 4.5 pruning
  uses the fresh inventory to spot newly-visible primitives.
* Anytime config.json changes (new token, new file).

Tuning
------
* config.fuzzy_tolerance_pct: default 5. Widen to 10 or 20 if first-
  pass clusters fragment. Every widening logs to the cluster output
  so reviewers can see how much loss-of-precision was accepted.
* config.primitive_threshold: default 3. Lower to 2 for richer
  recall during early consolidation; raise to 5 for tighter scope.

Known limitations
-----------------
v1 of the tool ships with three known gaps. None are blockers for
Phase 0; document the boundaries so reviewers don't over-trust the
report.

1. Shorthand-embedded colours are invisible to the colour-frequency
   table. Examples the tool currently MISSES:

     border:     1px solid rgba(255, 255, 255, 0.08)
     outline:    3px solid #ffff00
     box-shadow: 0 0 20px rgba(167, 139, 250, 0.3)

   The literal-map only checks values declared directly on properties
   in the `color_props` config list (color, background, background-
   color, border-*-color). To catch shorthand-embedded colours we'd
   need a per-property parser that extracts colour tokens from
   composite values. Deferred: enough phase-2 work depends on the
   simple-form colours that we should not block on this.

   Workaround for reviewers: when reading literal-map.md, mentally
   add the shorthand-embedded raw colours you spot during the value
   sweeps. They'll surface in the cluster reports because the FULL
   declaration string still hashes uniquely.

2. JSX-refs are lower-bound only (see above on jsx-refs.md).

3. Numeric fuzzy matching requires IDENTICAL units. `1rem` and `1em`
   do NOT cluster; `12px` and `0.75rem` do NOT cluster even if they
   resolve to the same pixel size. Cross-unit conversion would need
   an explicit rule (e.g. assume 1rem = 16px) and is deferred. The
   only special case is zero: `0`, `0px`, `0rem`, `0em`, `0%` all
   match each other.


Open-source status
------------------
The tool is currently scoped to this codebase's naming conventions
(BEM-ish primary class first, kebab-case files, src/styles/tokens.css
vocabulary). Open-sourcing it as a standalone ANALYZER (not auto-
rewriter) is a possible follow-up once Phase 5 closes. Premature now.
