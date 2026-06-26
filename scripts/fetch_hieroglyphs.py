#!/usr/bin/env python3
"""Download Noto Sans Egyptian Hieroglyph SVGs from Wikimedia Commons.

Source: Category:Noto Sans Egyptian Hieroglyphs (derived from the OFL-licensed
Google Noto font). One SVG per glyph, named by Gardiner/Unicode code.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
CATEGORY = "Category:Noto Sans Egyptian Hieroglyphs"
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 256
OUT = sys.argv[2] if len(sys.argv) > 2 else "public/qmail-avatars/egyptian/noto"

UA = "QMail-GUI-asset-fetch/1.0 (sean@raidatech.com)"


def api_get(params):
    params = {**params, "format": "json"}
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def list_files(limit):
    """Page through the category and collect file titles."""
    titles = []
    cont = {}
    while len(titles) < limit:
        data = api_get({
            "action": "query",
            "list": "categorymembers",
            "cmtitle": CATEGORY,
            "cmtype": "file",
            "cmlimit": "500",
            **cont,
        })
        titles += [m["title"] for m in data["query"]["categorymembers"]]
        if "continue" in data:
            cont = data["continue"]
        else:
            break
    return titles[:limit]


def resolve_urls(titles):
    """Resolve real file download URLs in batches of 50."""
    urls = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        data = api_get({
            "action": "query",
            "titles": "|".join(batch),
            "prop": "imageinfo",
            "iiprop": "url",
        })
        for page in data["query"]["pages"].values():
            if "imageinfo" in page:
                urls[page["title"]] = page["imageinfo"][0]["url"]
    return urls


def clean_name(title):
    # "File:Egyptian Hieroglyph A001 in Noto ... font.svg" -> "A001.svg"
    code = title.replace("File:Egyptian Hieroglyph ", "").split(" in ")[0]
    return code.replace(" ", "_") + ".svg"


def main():
    os.makedirs(OUT, exist_ok=True)
    print(f"Listing up to {LIMIT} files from {CATEGORY} ...")
    titles = list_files(LIMIT)
    print(f"Got {len(titles)} titles. Resolving download URLs ...")
    urls = resolve_urls(titles)
    print(f"Resolved {len(urls)} URLs. Downloading to {OUT} ...")

    ok, fail, skip = 0, 0, 0
    for title in titles:
        url = urls.get(title)
        if not url:
            fail += 1
            continue
        dest = os.path.join(OUT, clean_name(title))
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            skip += 1
            continue
        if not download_with_retry(url, dest):
            fail += 1
            continue
        ok += 1
        if ok % 25 == 0:
            print(f"  {ok} downloaded ({skip} already present) ...")
        time.sleep(0.4)  # be polite to Commons
    print(f"\nDone. {ok} downloaded, {skip} skipped, {fail} failed -> {OUT}")


def download_with_retry(url, dest, tries=6):
    delay = 1.0
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            with open(dest, "wb") as f:
                f.write(data)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < tries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            print(f"  FAIL {os.path.basename(dest)}: {e}")
            return False
        except Exception as e:
            if attempt < tries - 1:
                time.sleep(delay)
                delay = min(delay * 2, 30)
                continue
            print(f"  FAIL {os.path.basename(dest)}: {e}")
            return False
    return False


if __name__ == "__main__":
    main()
