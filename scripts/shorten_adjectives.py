#!/usr/bin/env python3
"""Replace long/hyphenated adjectives with short (<=9 char, no hyphen) synonyms.

Verifies global uniqueness before writing. Safe to re-run.
"""
import csv
import os
import sys

HERE = os.path.dirname(__file__)
CSV = os.path.join(HERE, "..", "public", "qmail-avatars", "egyptian", "noto",
                   "words_adjectives.csv")

MAXLEN = 9

# (code, oldword) -> newword
REPLACE = {
    ("C002", "falcon-headed"): "hawkish",
    ("C002A", "hawk-faced"): "hawkeyed",
    ("C004", "ram-headed"): "ramlike",
    ("C005", "ram-crowned"): "ramhorned",
    ("C006", "jackal-headed"): "houndish",
    ("C007", "beast-headed"): "beastly",
    ("C017", "twin-plumed"): "twinplume",
    ("D010", "all-seeing"): "watching",
    ("F002", "sharp-horned"): "pronged",
    ("F007", "curl-horned"): "spiraled",
    ("F013", "crescent-horned"): "hooked",
    ("G013", "double-plumed"): "topknot",
    ("G017", "wide-eyed"): "alert",
    ("G025", "plumed-crest"): "tufty",
    ("I004", "hallowed-beast"): "numinous",
    ("I009", "horn-browed"): "browed",
    ("O024", "towering-peak"): "peaked",
    ("R008", "blessed-cloth"): "godly",
    ("T008", "keen-edged"): "whetted",
    ("T011", "arrow-swift"): "arrowy",
    ("Z009", "crossed-strokes"): "strokes",   # fallback: keep component word
    ("Z010", "intersecting"): "meshed",
    ("R023", "interlocked"): "linked",
    ("R001", "consecrated"): "pious",
    ("M009", "blossoming"): "flowery",
    ("E038", "longhorned"): "tusked",
}


def main():
    with open(CSV, encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = [r for r in reader if r]

    changed = 0
    for r in rows:
        code = r[0][:-4] if r[0].endswith(".svg") else r[0]
        key = (code, r[1])
        if key in REPLACE:
            old = r[1]
            r[1] = REPLACE[key]
            r[4] = (r[4] + "; " if r[4] else "") + ("shortened from '%s'" % old)
            changed += 1

    # checks
    seen, collisions, toolong = {}, [], []
    for r in rows:
        w = r[1]
        if "-" in w or len(w) > MAXLEN:
            toolong.append((r[0], w))
        if w in seen:
            collisions.append((w, seen[w], r[0]))
        else:
            seen[w] = r[0]

    ok = True
    if collisions:
        ok = False
        print("COLLISIONS (%d):" % len(collisions))
        for w, a, b in collisions:
            print(f"  '{w}': {a} & {b}")
    if toolong:
        ok = False
        print("STILL TOO LONG / HYPHENATED (%d):" % len(toolong))
        for code, w in toolong:
            print(f"  {code}: {w} (len {len(w)})")
    if not ok:
        print("\nNot writing. Fix REPLACE map and re-run.")
        sys.exit(1)

    with open(CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"OK: {changed} renamed. All adjectives <= {MAXLEN} chars, no hyphens, unique.")


if __name__ == "__main__":
    main()
