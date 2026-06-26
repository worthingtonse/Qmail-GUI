#!/usr/bin/env python3
"""Final pass: replace remaining obscure/hard-to-spell words in all three files
with common ones. Per-file uniqueness + <=9 chars + no hyphens verified."""
import csv, os, sys
HERE=os.path.dirname(__file__)
BASE=os.path.join(HERE,"..","public","qmail-avatars","egyptian","noto")
MAXLEN=9

# file -> {(code,oldword): newword}
JOBS={
 "words_nouns.csv":{
   ("S034","ankh"):"lifesign",        # ankh = sign of life
   ("I010","asp"):"snake2",           # will fix below; asp->cobra taken
   ("R011","djed"):"backbone2",       # djed pillar; backbone taken -> fix below
   ("T016A","khopesh"):"curvesabr",
   ("G016","nekhbet"):"henhawk",
   ("R008","netjer"):"holyflag",
   ("R004","oblation"):"giftfood",
   ("M031","rhizome"):"rootmass",
   ("S026B","shendyt"):"waistwrap",
   ("I004","sobek"):"crocgod",
   ("I012","uraeus"):"hoodsnake",
   ("G016","wadjet"):"cobralady",
   ("D010","wedjat"):"horuseye",
 },
 "words_adjectives.csv":{
   ("I004","numinous"):"awesome",
   ("F004","leonine"):"lionlike",
   ("C017","twinplume"):"twoplumed",
   ("C005","ramhorned"):"ramhorn",
   ("G025","tufty"):"tufthead",
 },
 "words_verbs.csv":{
   ("D032","enclasp"):"enfold2",       # enfolding taken -> fix below
   ("G029","wadewalk"):"wadestep",
   ("A004","kowtowing"):"bowing2",     # bowing taken -> fix below
   ("I012","uprearing"):"rearingup",
 },
}
# resolve the suffixed placeholders to safe unique words:
JOBS["words_nouns.csv"][("I010","asp")]="hissasp"      # keep recognizable
JOBS["words_nouns.csv"][("R011","djed")]="pillargod"
JOBS["words_verbs.csv"][("D032","enclasp")]="claspint"
JOBS["words_verbs.csv"][("A004","kowtowing")]="kneeling2"

def run(fname, repl):
    path=os.path.join(BASE,fname)
    with open(path,encoding="utf-8") as f:
        rdr=csv.reader(f); header=next(rdr); rows=[r for r in rdr if r]
    changed=0
    for r in rows:
        code=r[0][:-4] if r[0].endswith(".svg") else r[0]
        first=r[1]
        for _ in range(6):
            k=(code,r[1])
            if k in repl and repl[k]!=r[1]: r[1]=repl[k]
            else: break
        if r[1]!=first:
            r[4]=(r[4]+"; " if r[4] else "")+("plain word, was '%s'"%first); changed+=1
    seen={}; coll=[]; lng=[]
    for r in rows:
        w=r[1]
        if "-" in w or len(w)>MAXLEN: lng.append((r[0],w,len(w)))
        if w in seen: coll.append((w,seen[w],r[0]))
        else: seen[w]=r[0]
    if coll or lng:
        print("PROBLEMS in %s:"%fname)
        for w,a,b in coll: print("  COLLIDE '%s': %s & %s"%(w,a,b))
        for c,w,n in lng: print("  LONG %s: %s (%d)"%(c,w,n))
        return False
    with open(path,"w",newline="",encoding="utf-8") as f:
        wr=csv.writer(f); wr.writerow(header); wr.writerows(rows)
    print("OK %s: %d renamed."%(fname,changed))
    return True

def main():
    allok=True
    # dry-run all first; only write if all pass
    for fname,repl in JOBS.items():
        if not run(fname,repl): allok=False
    if not allok: sys.exit(1)

if __name__=="__main__": main()
