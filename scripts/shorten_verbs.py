#!/usr/bin/env python3
"""Shorten long/hyphenated verbs to <=9 chars, no hyphens, unique. Verifies."""
import csv, os, sys
HERE=os.path.dirname(__file__)
CSV=os.path.join(HERE,"..","public","qmail-avatars","egyptian","noto","words_verbs.csv")
MAXLEN=9
REPLACE={
 ("A004","worshipping"):"adoring2",   # placeholder, will collide-check; pick below
 ("A057","constructing"):"raising",
 ("A059","threatening"):"menacing",
 ("A060","scattering"):"strewing",
 ("A068","standing-tall"):"upright",
 ("A070","watching-over"):"warding",
 ("B001","seated-still"):"perching",
 ("D027","suckling-breast"):"nourish",
 ("D030","venerating"):"revering",
 ("D031","supporting"):"bracing",
 ("D032","embracing-wide"):"enclasp",
 ("D039","presenting"):"tendering",  # 9
 ("D039","proffering"):"handing",
 ("D051","indicating"):"showing",
 ("D055","retreating"):"backing",
 ("E015","lurking-low"):"skulking",
 ("G029","striding-shallows"):"wadewalk",
 ("G031","stilt-walking"):"stilting",
 ("G033","marsh-treading"):"marshing",
 ("G050","wading-pair"):"paddling2", # placeholder, fix below (paddling taken)
 ("I009","slithering"):"snaking",
 ("I013","striking-cobra"):"hooding",
 ("I015","gliding-low"):"creeping",
 ("L001","scrabbling"):"scuttling", # 9
 ("T028","butchering"):"carving",
 ("V009","encircling"):"ringing",
 ("V017","protecting"):"shielding", # 9
 ("Y004","inscribing"):"penning",
 # fixes for placeholders / likely collisions
 ("A004","adoring2"):"praising2",  # 'adoring','praising' taken -> use 'hallowing'? do below
}
# resolve the awkward ones explicitly to safe unique words:
REPLACE[("A004","worshipping")]="kowtowing"  # 9, distinct from adoring/praying/praising
REPLACE[("G050","wading-pair")]="dabbling"   # 8, distinct from wading/paddling

def main():
    with open(CSV,encoding="utf-8") as f:
        rdr=csv.reader(f); header=next(rdr); rows=[r for r in rdr if r]
    changed=0
    for r in rows:
        code=r[0][:-4] if r[0].endswith(".svg") else r[0]
        first=r[1]
        for _ in range(5):
            k=(code,r[1])
            if k in REPLACE and REPLACE[k]!=r[1]: r[1]=REPLACE[k]
            else: break
        if r[1]!=first:
            r[4]=(r[4]+"; " if r[4] else "")+("shortened from '%s'"%first); changed+=1
    seen={}; coll=[]; lng=[]
    for r in rows:
        w=r[1]
        if "-" in w or len(w)>MAXLEN: lng.append((r[0],w,len(w)))
        if w in seen: coll.append((w,seen[w],r[0]))
        else: seen[w]=r[0]
    ok=True
    if coll:
        ok=False; print("COLLISIONS:",*["%s:%s&%s"%(w,a,b) for w,a,b in coll],sep="\n  ")
    if lng:
        ok=False; print("TOOLONG:",*["%s:%s(%d)"%(c,w,n) for c,w,n in lng],sep="\n  ")
    if not ok: print("Not writing."); sys.exit(1)
    with open(CSV,"w",newline="",encoding="utf-8") as f:
        wr=csv.writer(f); wr.writerow(header); wr.writerows(rows)
    print("OK: %d renamed. verbs all <=9, no hyphens, unique."%changed)

if __name__=="__main__": main()
