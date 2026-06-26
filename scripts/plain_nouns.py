#!/usr/bin/env python3
"""Replace proper-noun and obscure/coined nouns with common, spellable words.
Verifies <=9 chars, no hyphens, global uniqueness. Reports problems."""
import csv, os, sys
HERE=os.path.dirname(__file__)
CSV=os.path.join(HERE,"..","public","qmail-avatars","egyptian","noto","words_nouns.csv")
MAXLEN=9
REPLACE={
 # deities / proper nouns
 ("C002","Ra"):"sunlord",("C004","Khnum"):"rammage",("C006","Anubis"):"jackmask",
 ("C007","Seth"):"stormgod",("C008","Min"):"plumeman",("C010","Maat"):"truthgod",
 ("C021","Khonsu"):"crownboy",("C002A","sunhawk"):"sunking",("C002B","daystar"):"daygod",
 ("C002C","sundeity"):"sunface",("C003","sundisc"):"discface",("C005","ramlord"):"ramgod",
 ("C022","seeress"):"emblemgod",("C023","diadem"):"crownone",("C024","skyqueen"):"hornlady",
 ("C016","deity"):"bearded",("C017","divinity"):"twoplume",
 ("D008A","kohleye"):"darkeye",("D029","kasign"):"upreach",
 ("E019","Wepwawet"):"pathdog",("E020A","sethling"):"oddbeast",
 ("F003","hippohead"):"riverpig",("F004","foreleon"):"forepaw",
 ("F009","pardhead"):"spotcat",("F009","spotface"):"catface",
 # birds / reptiles / plants
 ("G009","sundisk"):"sunbird",("G011A","holyhawk"):"holybird",("G012","kinghawk"):"kingbird",
 ("G013","sokar"):"plumehawk",("G014","mutbird"):"henbird",("G024","rekhyt"):"tiedbird",
 ("G026","thoth"):"holyibis",("G028","inkwing"):"darkibis",("G032","bennu"):"perchbird",
 ("G040","flyteal"):"flyduck",("G041","landteal"):"landduck",("G042","plumpwig"):"fatduck",
 ("G049","twoteals"):"twoducks",("G006A","standhawk"):"polehawk",
 ("I012","rearcoil"):"upcobra",("I013","coilbask"):"potcobra",
 ("M009","nymphaea"):"waterlily",("M012C","budstem"):"budstalk",
 ("M014","coilstem"):"snakecane",("M014","stemcoil"):"caneview",
 ("M015","clumpfan"):"reedclump",("M016","fenfan"):"marshtuft",("M016","fentuft"):"sedgetuft",
 ("M021","sprouter"):"sprouts",("M023","kingstalk"):"kingplant",("M023","swytuft"):"sedgebush",
 ("M026","upperse"):"bloomweed",("M034","emmerear"):"wheatear",("M035","heapful"):"grainpile",
 ("M037","stalkfax"):"flaxstalk",("M038","linentie"):"flaxtie",
 ("M039","bundler"):"reedstalk",("M039","stickset"):"reedstick",
 ("M040A","sheafer"):"reedsheaf",("M040A","tiedcane"):"tiedreeds",
 ("M042","petaller"):"petals",
 # sky / earth / water
 ("N006","sundorb"):"sunorb",("N015","duat"):"netherld",("N015","netherly"):"gloom",
 ("N017","terra"):"flatland",("N020","tongueby"):"landstrip",("N027","akhet"):"sunpeak",
 ("N039","wellfont"):"waterpit",("N040","walkpond"):"walkpool",("N042","deepblue"):"deeppool",
 # sacred / dress / weapons
 ("R016","wasstaff"):"powerrod",("R016A","theban"):"plumetop",("R016A","wasplume"):"feathrod",
 ("R029","isisseat"):"highchair",("S017A","breastpc"):"pendant",("S020","sealcharm"):"beadtag",
 ("S025","raiment"):"clothing",("S038","heqa"):"shepcrook",
 ("O016","cobragate"):"snakedoor",("O025","obelneed"):"pinnacle",
 ("T005","snakeclub"):"snakemace2",("T006","twinfang"):"twinmace2",
 ("T008A","shortedge"):"shortdirk",("T011A","feathshot"):"feathdart",
 ("U009","cornpeck"):"grainmug",
 ("V009","shenring"):"circlet",("V018","wardtie"):"guardtie",("V018","safecharm"):"safetie",
 ("V021","measureln"):"loopline",("V024","wedjwind"):"woundrope",
 ("V025","coiltwine"):"coilcord2",("V025","twistflax"):"twistrope",
 ("V027","netpin"):"netneedle",("V027","meshtool"):"meshhook",
 ("V028","flaxwind"):"flaxwick",("V029A","fibremitt"):"fibrepad",("V029A","linenwad"):"linenpad",
 ("V030","nebweave"):"reedbowl",("V030A","wickercup"):"wickerbox",
 ("V031","gripcrate"):"handcrate",("V032","frailtote"):"reedtote",
 ("V033A","linenholr"):"linenroll",("V034","tinyroll"):"smallroll",
 # vessels (W)
 ("W002","unguent"):"oiljar",("W003A","alabastr"):"washbowl",
 ("W005","washewer"):"washjug",("W007","granitug"):"stonecup",("W008","granbasn"):"stonebowl",
 ("W009","stoneewr"):"stonejug",("W009","rockcrock"):"rockpot",("W010","sipdish"):"sipcup",
 ("W011","jarrest"):"jarstand",("W012","ringbase"):"potring",("W012","potprop"):"potstand",
 ("W017","jarshelf"):"jarrack",("W018","rackedjug"):"potrack",("W018","crockrack"):"crockpot",
 ("W018A","jugrow"):"jugshelf",("W019","netflask"):"netjug",("W020","leafewer"):"leafjug",
 ("W020","cappedjug"):"cappedjar",("W021","twinflask"):"twinjars",
 ("W022","brewcrock"):"flagon",("W022","vintewer"):"winepot",("W023","earewer"):"handlejug",
 ("W024","orbpot"):"roundpot",("W024A","widecrock"):"widepot",
 ("W025","leggedurn"):"footedpot",("W025","footflask"):"legpot",
 # misc
 ("E025","riverbull"):"riverhog",("Aa024","roughclub"):"woodclub",
 ("Y004","inkboard"):"writekit",("Y006","gametoke"):"checker",
}
# resolve duplicates I deliberately suffixed (must end unique):
REPLACE[("T005","snakeclub")]="viperrod"
REPLACE[("T006","twinfang")]="twinviper"
REPLACE[("V025","coiltwine")]="coilrope"

def main():
    with open(CSV,encoding="utf-8") as f:
        rdr=csv.reader(f); header=next(rdr); rows=[r for r in rdr if r]
    changed=0
    for r in rows:
        code=r[0][:-4] if r[0].endswith(".svg") else r[0]
        first=r[1]
        for _ in range(6):
            k=(code,r[1])
            if k in REPLACE and REPLACE[k]!=r[1]: r[1]=REPLACE[k]
            else: break
        if r[1]!=first:
            r[4]=(r[4]+"; " if r[4] else "")+("plain word, was '%s'"%first); changed+=1
    seen={}; coll=[]; lng=[]
    for r in rows:
        w=r[1]
        if "-" in w or len(w)>MAXLEN: lng.append((r[0],w,len(w)))
        if w in seen: coll.append((w,seen[w],r[0]))
        else: seen[w]=r[0]
    ok=True
    if coll:
        ok=False; print("COLLISIONS (%d):"%len(coll))
        for w,a,b in coll: print(f"  '{w}': {a} & {b}")
    if lng:
        ok=False; print("TOOLONG (%d):"%len(lng))
        for c,w,n in lng: print(f"  {c}: {w} ({n})")
    if not ok: print("Not writing."); sys.exit(1)
    with open(CSV,"w",newline="",encoding="utf-8") as f:
        wr=csv.writer(f); wr.writerow(header); wr.writerows(rows)
    print("OK: %d renamed. nouns all common, <=9, no hyphens, unique."%changed)

if __name__=="__main__": main()
