#!/usr/bin/env python3
"""De-duplicate words_nouns.csv so every noun is globally unique.

Strategy:
  1. Apply an explicit replacement map (code,oldword) -> newword for the
     duplicate occurrences I chose to rename. The map keeps the best-fit
     glyph's original word and renames the others to synonyms / specifics /
     materials, applying the email-friendly + no-homophone rules.
  2. Verify the result: every word appears exactly once. Report any leftover
     collisions so they can be fixed.

Run from repo root: python scripts/dedup_nouns.py
"""
import csv
import os
import sys

HERE = os.path.dirname(__file__)
CSV = os.path.join(HERE, "..", "public", "qmail-avatars", "egyptian", "noto",
                   "words_nouns.csv")

# (code, oldword) -> newword.  Only the occurrences being RENAMED appear here;
# the kept occurrence of each duplicated word is left untouched.
REPLACE = {
    # --- people (A / B) ---
    ("A003", "man"): "wretch",          # was dup 'man' (kept A001)
    ("A056", "man"): "sentry",
    ("A068", "man"): "figure",
    ("A030", "worshipper"): "devotee",  # kept A004
    ("A032A", "dancer"): "tumbler",     # kept A032
    ("A069", "dancer"): "leaper",
    ("A050", "noble"): "dignitary",     # kept A011
    ("A051", "noble"): "lord",
    ("A057", "builder"): "mason",       # kept A035
    ("A043A", "king"): "monarch",       # kept A042A
    ("A044", "king"): "ruler",
    ("A045A", "king"): "sovereign",
    ("A043", "king"): "white-king",
    ("A064", "porter"): "carrier",      # kept A009
    ("A063", "official"): "minister",   # kept A021
    ("A017A", "child"): "infant",       # kept A017
    ("A054", "mummy"): "sleeper",       # kept A053; email-friendly (was 'mummy' twice)
    # --- women ---
    ("B005", "mother"): "matron",       # keep B006 'mother' (score 5)
    ("B005A", "mother"): "nursemaid",
    ("B004", "mother"): "matriarch",
    ("B008", "woman"): "maiden",        # kept B001
    ("B009", "woman"): "kneeler",
    # --- deities (C) ---
    ("C002A", "Ra"): "sun-god",         # kept C002
    ("C002B", "Ra"): "sun-lord",
    ("C002C", "Ra"): "daystar",
    ("C003", "Ra"): "sundisc",
    ("C005", "Khnum"): "ram-god",       # kept C004
    ("C016", "god"): "deity",           # kept C001
    ("C017", "god"): "divinity",
    ("C022", "goddess"): "divine-lady", # kept C009
    ("C023", "goddess"): "crown-lady",
    ("C024", "goddess"): "sky-lady",
    # --- body (D / F) ---
    ("D008A", "eye"): "painted-eye",    # kept D008
    ("D010", "eye"): "wedjat",
    ("D029", "arms"): "ka-arms",        # kept D028
    ("D030", "arms"): "raised-arms",
    ("D031", "arms"): "holding-arms",
    ("D032", "arms"): "open-arms",
    ("D035", "arms"): "spread-arms",
    ("D037", "arm"): "giving-arm",      # kept D036
    ("D038", "arm"): "loaf-arm",
    ("D039", "arm"): "bowl-arm",
    ("D040", "arm"): "striking-arm",
    ("D041", "arm"): "resting-arm",
    ("D042", "arm"): "cubit",
    ("D045", "arm"): "wand-arm",
    ("D050C", "finger"): "digit",       # kept D050B
    ("D051", "finger"): "forefinger",
    ("D050D", "finger"): "fingertip",
    ("D050F", "fingers"): "hand-span",  # kept D050E
    ("D050G", "fingers"): "knuckles",
    ("D050I", "fingers"): "fingerprints",
    ("D064", "legs"): "walking-legs",   # kept D055
    ("D059", "leg"): "stride-leg",      # kept D057
    ("D063", "leg"): "shin",
    ("D066", "leg"): "calf-leg",
    ("D066", "foot"): "sole",           # kept D063 'foot'
    ("D067A", "foot"): "footprint",     # kept D067 'foot'
    ("D067B", "foot"): "footfall",
    ("D067C", "foot"): "heel",
    ("D067D", "foot"): "instep",
    ("D067E", "foot"): "tread",
    ("D067F", "foot"): "step",
    ("D067G", "foot"): "footstep",
    ("D067H", "foot"): "barefoot",
    # --- mammals (E / F) ---
    ("E038", "bull"): "ox-bull",        # kept E002 'bull'
    ("E017", "jackal"): "wild-jackal",  # kept E015 'jackal'
    ("E017A", "jackal"): "desert-dog",
    ("E018", "jackal"): "standard-jackal",
    ("E019", "jackal"): "Wepwawet",
    ("E018", "wolf"): "grey-wolf",      # kept E017 'wolf'
    ("E017A", "wolf"): "lone-wolf",
    ("E019", "wolf"): "wild-wolf",
    ("E020A", "beast"): "Seth-beast",   # kept E020 'beast'
    ("E021", "beast"): "crouching-beast",
    ("E023", "lion"): "lioness",        # kept E022 'lion'
    ("F004", "lion"): "lion-front",
    ("F009", "leopard"): "leopard-head",  # kept E024 'leopard'
    ("F009", "panther"): "panther-head",  # kept E024 'panther'
    ("F003", "hippopotamus"): "river-horse",  # kept E025
    ("F013", "horns"): "ox-horns",      # kept F002 'horns'
    ("F013A", "horns"): "twin-horns",
    # --- birds (G) ---
    ("G014", "vulture"): "mother-vulture",  # kept G001 'vulture'
    ("G016", "vulture"): "nekhbet",
    ("G005", "hawk"): "kestrel",        # kept G004 'hawk'
    ("G006A", "falcon"): "perched-falcon",  # kept G005 'falcon'
    ("G009", "falcon"): "sun-falcon",
    ("G011A", "falcon"): "sacred-falcon",
    ("G012", "falcon"): "royal-falcon",
    ("G013", "falcon"): "sokar-falcon",
    ("G026", "ibis"): "thoth-bird",     # kept G025 'ibis'
    ("G026A", "ibis"): "wading-ibis",
    ("G028", "ibis"): "black-ibis",
    ("G032", "heron"): "perched-heron", # kept G031 'heron'
    ("G040", "duck"): "flying-duck",    # kept G039 'duck'
    ("G041", "duck"): "alighting-duck",
    ("G042", "duck"): "plump-duck",
    ("G049", "duck"): "duck-heads",
    # --- reptiles / fish / bugs (I/K/L) ---
    ("I004", "crocodile"): "sobek",     # kept I003 'crocodile'
    ("I010", "cobra"): "uraeus-cobra",  # kept G016? no—G016 used 'cobra'. keep I010
    # note: 'cobra' kept at I010; rename the others
    ("G016", "cobra"): "wadjet",
    ("I012", "cobra"): "reared-cobra",
    ("I013", "cobra"): "basket-cobra",
    ("I010", "snake"): "asp",           # kept I009 'snake'
    ("I015", "snake"): "serpent-snake",
    ("L002A", "bee"): "honeybee",       # kept L002 'bee'
    # --- plants (M) ---
    ("M001B", "tree"): "sapling",       # kept M001 'tree'
    ("M009", "lotus"): "lotus-bloom",   # kept M008 'lotus'
    ("M012C", "lotus"): "lotus-bud",
    ("M014", "papyrus"): "papyrus-snake",  # kept M013 'papyrus'
    ("M015", "papyrus"): "papyrus-clump",
    ("M016", "papyrus"): "papyrus-marsh",
    ("M021", "reed"): "young-reed",     # kept M013 'reed'
    ("M023", "reed"): "sedge-reed",
    ("M040A", "reed"): "bound-reed",
    ("M016", "reeds"): "marsh-reeds",   # kept M039? choose: keep M040 'reeds'
    ("M039", "reeds"): "reed-bundle",
    ("M040A", "reeds"): "reed-sheaf",
    ("M023", "sedge"): "royal-sedge",   # kept M022A 'sedge'
    ("M026", "sedge"): "flowering-sedge",
    ("M031A", "root"): "taproot",       # kept M031 'root'
    ("M033B", "grain"): "corn-grain",   # kept M033 'grain'
    ("M034", "grain"): "wheat-grain",
    ("M035", "grain"): "grain-heap",
    ("N033", "grain"): "sand-grain",
    ("U009", "grain"): "measured-grain",
    ("O051", "grain"): "stored-grain",
    ("M037", "flax"): "flax-stalk",     # kept M036 'flax'
    ("M038", "flax"): "flax-sheaf",
    ("M038", "bundle"): "faggot",       # kept M036 'bundle'
    ("M039", "bundle"): "reed-faggot",
    ("M040", "bundle"): "sheaf",
    ("V034", "bundle"): "small-bundle",
    ("M042", "flower"): "blossom-flower",  # kept M009 'flower'
    # --- sky / earth / water (N) ---
    ("N006", "sun"): "sun-orb",         # kept N005 'sun'
    ("N015", "star"): "duat-star",      # kept N014 'star'
    ("N017", "land"): "earth-land",     # kept N016 'land'
    ("N020", "land"): "tongue-land",
    ("N022", "land"): "spit-land",
    ("N017", "earth"): "soil",          # kept N016 'earth'
    ("N018A", "island"): "isle",        # kept N018 'island'
    ("N018B", "island"): "sandbar",
    ("N018B", "sand"): "dune",          # kept N018 'sand'
    ("N033A", "sand"): "sand-grains",
    ("N021", "shore"): "riverside",     # kept N018A 'shore'
    ("N022", "shore"): "bank",
    ("N025A", "desert"): "wasteland",   # kept N025 'desert'
    ("N025A", "hills"): "highlands",    # kept N025 'hills'
    ("N027", "horizon"): "dawn-horizon",  # kept N019 'horizon'
    ("N028", "sunrise"): "daybreak",    # kept N027 'sunrise'
    ("N035A", "water"): "ripples",      # kept N035 'water'
    ("N039", "water"): "spring-water",
    ("N041", "water"): "well-water",
    ("N042", "water"): "deep-water",
    ("N040", "pool"): "wading-pool",    # kept N039 'pool'? keep M008? no. keep N039
    ("N042", "well"): "deep-well",      # kept N041 'well'
    # --- buildings (O) ---
    ("O001A", "house"): "dwelling",     # kept O001 'house'
    ("O002", "house"): "household",
    ("O003", "house"): "manor",
    ("O001A", "home"): "homestead",     # kept O001 'home'
    ("O005A", "wall"): "rampart",       # kept O005 'wall'
    ("O005A", "enclosure"): "compound", # kept O005 'enclosure'
    ("O017", "gateway"): "portal-gate", # kept O016 'gateway'
    ("O017", "gate"): "doorgate",       # kept O016 'gate'
    ("O019", "shrine"): "sanctum",      # kept O018 'shrine'
    ("O019A", "shrine"): "reliquary",
    ("O020", "shrine"): "tabernacle",
    ("O020A", "shrine"): "holy-place",
    ("O021", "shrine"): "shrine-front",
    ("O020A", "chapel"): "oratory",     # kept O018 'chapel'
    ("O020", "sanctuary"): "refuge",    # kept O019A 'sanctuary'
    ("O024A", "pyramid"): "great-pyramid",  # kept O024 'pyramid'
    ("O025A", "obelisk"): "spire",      # kept O025 'obelisk'
    ("O025", "pillar"): "needle-pillar",  # kept O029 'pillar'? keep O029
    ("O025A", "pillar"): "stone-pillar",
    ("O031", "door"): "doorway-leaf",   # kept O016 'door'? O016 has 'door' score3; keep O031 (5)
    # fix: keep O031 'door', rename O016 'door'
    ("O016", "door"): "serpent-gate",
    # --- ships / furniture (P/Q) ---
    ("P007", "mast"): "rigged-mast",    # kept P006 'mast'
    ("Q002", "throne"): "carry-chair",  # kept R029? R029 'throne' score5. keep R029
    ("O023", "throne"): "dais-throne",
    ("Q006", "tomb"): "burial",         # kept O024A? O024A 'tomb' score3; keep R010? choose keep Q006
    ("R010", "tomb"): "necropolis",
    ("O024A", "tomb"): "pyramid-tomb",
    # --- sacred / dress (R/S) ---
    ("R002", "altar"): "flower-altar",  # kept R001 'altar'
    ("R002A", "altar"): "offering-stand",
    ("R003", "altar"): "loaf-altar",
    ("R003A", "altar"): "altar-table",
    ("R002", "offering"): "oblation",   # kept R001 'offering'
    ("R003A", "offering"): "gift",
    ("R004", "offering"): "boon",
    ("R002A", "table"): "offering-board",  # kept R001 'table'
    ("R003", "table"): "side-table",
    ("R008", "god"): "netjer",          # kept C001 'god'? C001 score5 keep. rename R008
    ("R010A", "standard"): "war-standard",  # kept R010 'standard'
    ("R016", "sceptre"): "was-sceptre", # kept D044 'sceptre'? keep D044
    ("R016A", "sceptre"): "theban-sceptre",
    ("S038", "sceptre"): "crook-sceptre",
    ("R016", "feather"): "plume-feather",  # kept H006 'feather'
    ("S037", "feather"): "fan-feather",
    ("R016A", "emblem"): "theban-emblem",  # kept R010A 'emblem'
    ("R021", "arrows"): "neith-arrows", # kept R020 'arrows'
    ("R022", "arrows"): "crossed-arrows",
    ("R023", "arrows"): "twin-arrows",
    ("R024", "arrows"): "bow-arrows",
    ("R021", "shield"): "neith-shield", # kept R020 'shield'? keep T036 'shield' score5
    ("R020", "shield"): "emblem-shield",
    ("R025", "bow"): "double-bow",      # kept R024 'bow'? R024 score5 keep. keep T010 'bow' score5
    ("R024", "bow"): "neith-bow",
    ("T010", "bow"): "longbow",
    ("R029", "seat"): "isis-throne",    # 'seat' kept Q002? Q002 'seat' score5. keep Q002
    ("S017A", "necklace"): "breast-ornament",  # kept S015 'necklace'
    ("S020", "necklace"): "seal-necklace",
    ("S020", "signet"): "seal-ring",    # kept S021 'signet'
    ("S025", "cloth"): "robe-cloth",    # kept S022 'cloth'? keep S032 'cloth' score5
    ("S022", "cloth"): "shoulder-cloth",
    ("S025", "robe"): "ceremonial-robe",
    ("V018", "knot"): "protection-knot",  # kept S024 'knot'? S024 score5 keep. keep S022? S022 'knot' score4
    ("S022", "knot"): "shoulder-knot",
    ("S026A", "apron"): "royal-kilt",   # kept S026 'apron'
    ("S026B", "apron"): "ceremonial-apron",
    ("S026A", "kilt"): "pleated-kilt",  # kept S026 'kilt'
    ("S026B", "kilt"): "shendyt",
    ("S035", "fan"): "sunshade-fan",    # kept S037 'fan'
    # --- weapons (T) ---
    ("T003", "mace"): "war-mace",       # kept T001 'mace'
    ("T005", "mace"): "serpent-mace",
    ("T006", "mace"): "twin-serpent-mace",
    ("T003", "club"): "war-club",       # kept T001 'club'
    ("T005", "club"): "cudgel",
    ("T006", "club"): "bludgeon",
    ("Aa024", "club"): "rough-club",
    ("T008A", "dagger"): "poniard",     # kept T008 'dagger'
    ("T008A", "blade"): "dagger-blade", # kept T008 'blade'? T008 score4; keep T030 'blade'? T030 score4
    ("T008", "blade"): "dirk",
    ("T011A", "arrow"): "fletched-arrow",  # kept T011 'arrow'
    ("T016A", "sword"): "khopesh",      # kept T016 'sword'
    ("T016A", "scimitar"): "curved-sword",  # kept T016 'scimitar'
    ("T023", "arrowhead"): "harpoon-head",  # kept T022 'arrowhead'
    ("T025", "harpoon"): "fish-spear",  # kept T023 'harpoon'
    ("T030", "blade"): "knife-blade",   # keep one 'blade'; this becomes unique anyway
    # --- baskets / cords / vessels (V/W) ---
    ("V025", "cord"): "wound-cord",     # kept V021 'cord'
    ("V024", "cord"): "stick-cord",
    ("V028", "cord"): "wick-cord",
    ("V025", "rope"): "twined-rope",    # kept V021 'rope'
    ("V021", "loop"): "cord-loop",      # kept V009 'loop'
    ("V018", "amulet"): "knot-amulet",  # kept V017 'amulet'
    ("V023A", "whip"): "scourge",       # kept V023 'whip'
    ("V027", "spindle"): "netting-spindle",  # kept V026 'spindle'
    ("V027", "needle"): "netting-needle",    # kept V026 'needle'
    ("V029A", "swab"): "fibre-swab",    # kept V029 'swab'
    ("V029A", "mop"): "fibre-mop",      # kept V029 'mop'
    ("V030A", "basket"): "wicker-basket",   # kept V030 'basket'
    ("V031", "basket"): "handled-basket",
    ("V032", "basket"): "frail",
    ("V033A", "bag"): "linen-bag",      # kept V033 'bag'
    ("V034", "bag"): "pouch-bag",
    ("V032", "bag"): "basket-bag",
    ("V033A", "sack"): "grain-sack",    # kept V033 'sack'
    ("W005", "jar"): "ablution-jar",    # kept W002 'jar'
    ("W009", "jar"): "stone-jar",
    ("W013", "jar"): "red-jar",
    ("W019", "jar"): "milk-jar",
    ("W020", "jar"): "covered-jar",
    ("W022", "jar"): "beer-jar",
    ("W023", "jar"): "handled-jar",
    ("W025", "jar"): "footed-jar",
    ("W009", "jug"): "stone-jug",       # kept W002? W002 'jug' score3. keep W019 'jug' score5
    ("W002", "jug"): "oil-jug",
    ("W020", "jug"): "milk-jug",
    ("W022", "jug"): "wine-jug",
    ("W023", "jug"): "water-jug",
    ("W006", "vessel"): "metal-vessel", # kept W002 'vessel'
    ("W003A", "basin"): "alabaster-basin",  # kept W003 'basin'
    ("W007", "basin"): "stone-basin",
    ("W008", "basin"): "granite-basin",
    ("W003A", "bowl"): "festival-bowl", # kept W003 'bowl'
    ("W008", "bowl"): "stone-bowl",
    ("W010", "bowl"): "drinking-bowl",
    ("W010A", "bowl"): "shallow-bowl",
    ("W024", "bowl"): "round-bowl",
    ("W024A", "bowl"): "wide-bowl",
    ("W010A", "cup"): "goblet",         # kept W010 'cup'
    ("W012", "stand"): "ring-stand",    # kept W011 'stand'
    ("W012", "jar-stand"): "pot-stand", # kept W011 'jar-stand'
    ("W024", "pot"): "round-pot",       # kept W013 'pot'? W013 score5 keep. keep W006? no
    ("W024A", "pot"): "wide-pot",
    ("W025", "pot"): "footed-pot",
    ("W006", "pot"): "cauldron-pot",
    ("W017", "jars"): "water-jars",     # kept W016 'jars'
    ("W018", "jars"): "racked-jars",
    ("W018A", "jars"): "jar-row",
    ("W021", "jars"): "wine-jars",
    ("W017", "rack"): "jar-rack",       # kept W016 'rack'
    ("W018", "rack"): "pot-rack",
    # --- bread (X) ---
    ("X002", "loaf"): "tall-loaf",      # kept X001 'loaf'
    ("X003", "loaf"): "round-loaf",
    ("X006", "loaf"): "cake-loaf",
    ("X007", "loaf"): "half-loaf",
    ("X008", "loaf"): "cone-loaf",
    ("X008A", "loaf"): "pointed-loaf",
    ("X002", "bread"): "white-bread",   # kept X001 'bread'
    ("X003", "bread"): "flatbread",
    ("X004", "bread"): "bun-bread",
    ("X004A", "bread"): "soft-bread",
    ("X004B", "bread"): "fresh-bread",
    ("X006", "bread"): "pat-bread",
    ("X007", "bread"): "broken-bread",
    ("X008", "bread"): "offering-bread",
    ("X004A", "roll"): "bread-roll",    # kept X004 'roll'
    ("X004B", "roll"): "round-roll",
    ("X008A", "cone"): "bread-cone",    # kept X008 'cone'
    # --- writing / misc (Y/Z) ---
    ("Y004", "palette"): "scribe-palette",  # kept Y003 'palette'
    ("Y004", "scribe"): "writer",       # kept Y003 'scribe'
    ("Z010", "cross"): "crossing",      # kept Z009 'cross'

    # --- second-pass fixes for collisions the verifier caught ---
    ("D067", "foot"): "right-foot",         # vs D063 'foot'
    ("G024", "lapwing"): "bound-lapwing",   # vs G023 'lapwing'
    ("M014", "serpent"): "papyrus-serpent", # vs I015 'serpent'
    ("M044", "spine"): "thorn-spine",       # vs F041 'spine'
    ("N020", "shore"): "headland",          # vs N018A 'shore'
    ("N033", "sand"): "grit",               # vs N018 'sand'
    ("M008", "pool"): "lily-pool",          # vs N039 'pool'
    ("O022", "booth"): "tent-booth",        # vs O021 'booth'
    ("O030A", "pole"): "tent-pole",         # vs P006 'pole'
    ("O029", "pillar"): "column-pillar",    # vs R011 'pillar'
    ("T010", "archer"): "bowman",           # vs A012 'archer'
    ("V009", "ring"): "shen-ring",          # vs S021 'ring'
    ("V017", "shelter"): "reed-shelter",    # vs O004 'shelter'
    ("V030", "lord"): "basket-lord",        # vs A051 'lord'
    ("W007", "bowl"): "granite-bowl",       # vs W003 'bowl'
}


def main():
    with open(CSV, encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = [r for r in reader if r]

    changed = 0
    for r in rows:
        pic, word = r[0], r[1]
        code = pic[:-4] if pic.endswith(".svg") else pic
        key = (code, word)
        if key in REPLACE:
            new = REPLACE[key]
            note = ("dedup of '%s'" % word)
            r[1] = new
            r[4] = (r[4] + "; " if r[4] else "") + note
            changed += 1

    # verify uniqueness
    seen = {}
    collisions = []
    for r in rows:
        w = r[1]
        if w in seen:
            collisions.append((w, seen[w], r[0]))
        else:
            seen[w] = r[0]

    if collisions:
        print("COLLISIONS REMAIN (%d):" % len(collisions))
        for w, first, second in collisions:
            print(f"  '{w}': {first} & {second}")
        print("\nNot writing file. Fix REPLACE map and re-run.")
        sys.exit(1)

    with open(CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)

    print(f"OK: {changed} words renamed. {len(rows)} rows, all unique.")


if __name__ == "__main__":
    main()
