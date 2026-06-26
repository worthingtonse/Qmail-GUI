# Egyptian Hieroglyph / Symbol SVGs — Sources & Licenses

All assets here are free for **commercial use**. Details below.

## `noto/` — individual per-glyph hieroglyphs (~1,071 files)

- **Source:** Wikimedia Commons, [Category:Noto Sans Egyptian Hieroglyphs](https://commons.wikimedia.org/wiki/Category:Noto_Sans_Egyptian_Hieroglyphs)
- **Derived from:** Google [Noto Sans Egyptian Hieroglyphs](https://github.com/notofonts/egyptian-hieroglyphs) font
- **License:** SIL Open Font License 1.1 (OFL) — free for commercial use,
  modification, and redistribution. Attribution to "Google / Noto Project"
  is courteous but the OFL does not require per-file attribution for the
  rendered glyphs.
- **Filenames:** Gardiner/Unicode codes, e.g. `S034.svg` (ankh),
  `D004.svg` (eye), `L001.svg` (scarab). See Gardiner's sign list:
  https://en.wikipedia.org/wiki/Gardiner%27s_sign_list

## `cc0/` — decorative hieroglyph panels

- **Source:** [FreeSVG.org](https://freesvg.org/) (originally OpenClipart)
  - `freesvg-hieroglyphs-sorted.svg`
  - `freesvg-hieroglyphs-souvenirs.svg`
- **License:** Creative Commons Zero (CC0 / Public Domain). No restrictions,
  no attribution required. Free for any commercial use.

## `noto/words_*.csv` — word associations for name generation

Three CSV files map each kept glyph to English words for the noun/adjective
avatar-name generator:

- `words_nouns.csv` (724 rows)
- `words_verbs.csv` (177 rows)
- `words_adjectives.csv` (189 rows)

Columns: `picture` (SVG filename), `word`, `depicts` (what the glyph shows),
`score` (1-5, how well the word fits the image), `remarks`.

A glyph can appear in several files and several times (e.g. `T030.svg` knife →
noun "knife"/"blade", verb "cutting", adjective "sharp"). Words are derived
from the standard Gardiner sign-list meaning of each glyph. All 455 glyphs are
covered. Regenerate with `scripts/build_word_csvs.py` (reads
`scripts/words_part*.json`).

---

Fetched 2026-06-10 for QMail-GUI avatars. Re-run `scripts/fetch_hieroglyphs.py`
to refresh the Noto set.
