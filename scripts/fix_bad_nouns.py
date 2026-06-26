#!/usr/bin/env python3
"""Replace noun words that are misspelled coinages or not clearly nouns.
Each replacement is a real, clearly-noun English word matching the glyph.
Verifies <=9 chars, no hyphens, no caps/digits, global uniqueness before write.
"""
import csv, os, sys
HERE=os.path.dirname(__file__)
CSV=os.path.join(HERE,"..","public","qmail-avatars","egyptian","noto","words_nouns.csv")
MAXLEN=9

# (code, oldword) -> newword. Each new value is a real, clearly-noun word
# that describes the glyph. Chosen to be common and easy to spell.
REPLACE={
 # --- not clearly nouns (were verb/adjective/phrase forms) ---
 ("D029","upreach"):"gesture",     # two raised arms (ka)
 ("D030","upraised"):"salute",     # arms raised in adoration
 ("D037","bestow"):"giver",        # arm giving a loaf
 ("D045","wander"):"baton",        # forearm holding a wand
 ("D041","palmdown"):"palm",       # hand bent palm down
 ("D059","steplimb"):"limb",       # leg and foot
 ("D067H","barefoot"):"footpad",   # foot/toe variant
 ("C016","bearded"):"prophet",     # bearded deity
 ("E019","feralone"):"hounddog",   # jackal-like animal on standard
 ("E020A","oddbeast"):"creature",  # Seth animal variant
 # --- misspelled / abbreviated coinages ---
 ("D050I","fingermk"):"nailtip",   # fingers / nail detail
 ("C004","rammage"):"ramhead",     # ram-headed god
 ("C002C","sunface"):"sunchief",   # sun-god variant
 ("C003","discface"):"discgod",    # sun-disc god
 ("C022","emblemgod"):"ladygod",   # goddess with emblem
 ("C023","crownone"):"crowngod",   # crowned goddess
 ("C017","twoplume"):"plumegod",   # god with two plumes
 ("M026","bloomweed"):"bloom",     # flowering sedge
 ("T011A","feathdart"):"quarrel",  # short arrow / bolt (real noun)
 ("V018","safetie"):"wardknot",    # protection knot
 ("V024","woundrope"):"ropecoil",  # cord wound on a stick
}

def main():
    with open(CSV,encoding="utf-8") as f:
        rdr=csv.reader(f); header=next(rdr); rows=[r for r in rdr if r]
    existing=set(r[1] for r in rows)
    changed=0; problems=[]
    for r in rows:
        code=r[0][:-4] if r[0].endswith(".svg") else r[0]
        k=(code,r[1])
        if k in REPLACE:
            new=REPLACE[k]; old=r[1]
            if new in existing and new!=old:
                problems.append((r[0],old,new,"collides")); continue
            existing.discard(old); existing.add(new)
            r[1]=new
            r[4]=(r[4]+"; " if r[4] else "")+("real noun, was '%s'"%old)
            changed+=1
    # validate
    words=[r[1] for r in rows]
    for r in rows:
        w=r[1]
        if len(w)>MAXLEN or "-" in w or w[0].isupper() or any(c.isdigit() for c in w):
            problems.append((r[0],w,"","bad form"))
    if len(words)!=len(set(words)):
        from collections import Counter
        for w,n in Counter(words).items():
            if n>1: problems.append(("?",w,"","DUP x%d"%n))
    if problems:
        print("PROBLEMS (%d):"%len(problems))
        for p in problems: print("  ",p)
        print("Not writing."); sys.exit(1)
    with open(CSV,"w",newline="",encoding="utf-8") as f:
        wr=csv.writer(f); wr.writerow(header); wr.writerows(rows)
    print("OK: %d words replaced."%changed)

if __name__=="__main__": main()
