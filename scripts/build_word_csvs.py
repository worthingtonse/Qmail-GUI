#!/usr/bin/env python3
"""Split the consolidated Gardiner word-mapping JSON into 3 CSV files.

Reads scripts/gardiner_words.json (array of rows), writes:
  noto/words_nouns.csv, words_verbs.csv, words_adjectives.csv
Each CSV columns: picture, word, depicts, score, remarks
'picture' is the SVG filename (code + .svg).
"""
import csv
import glob
import json
import os

HERE = os.path.dirname(__file__)
PARTS = sorted(glob.glob(os.path.join(HERE, "words_part*.json")))
OUT = os.path.join(HERE, "..", "public", "qmail-avatars", "egyptian", "noto")

FILES = {
    "noun": "words_nouns.csv",
    "verb": "words_verbs.csv",
    "adjective": "words_adjectives.csv",
}


def main():
    rows = []
    for p in PARTS:
        with open(p, encoding="utf-8") as f:
            rows.extend(json.load(f))
    print(f"Loaded {len(rows)} rows from {len(PARTS)} part files")

    buckets = {k: [] for k in FILES}
    for r in rows:
        t = r["type"]
        if t not in buckets:
            continue
        buckets[t].append(r)

    for t, fname in FILES.items():
        dest = os.path.join(OUT, fname)
        rows_t = sorted(buckets[t], key=lambda r: (r["code"], -r["score"]))
        with open(dest, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["picture", "word", "depicts", "score", "remarks"])
            for r in rows_t:
                w.writerow([
                    r["code"] + ".svg",
                    r["word"],
                    r["depicts"],
                    r["score"],
                    r.get("remarks", ""),
                ])
        print(f"{fname}: {len(rows_t)} rows")


if __name__ == "__main__":
    main()
