#!/usr/bin/env python3
"""Apply agent-supplied short replacements to words_nouns.csv, then verify
length<=9, no hyphens, global uniqueness. Reports problems instead of writing
a bad file."""
import csv, os, sys

HERE = os.path.dirname(__file__)
CSV = os.path.join(HERE, "..", "public", "qmail-avatars", "egyptian", "noto",
                   "words_nouns.csv")
MAXLEN = 9

REPLACE = {
 # A-F
 ("A004","worshipper"):"adorer",("A043","white-king"):"whiteking",
 ("Aa024","rough-club"):"roughclub",("C002A","sun-god"):"sunhawk",
 ("C002B","sun-lord"):"daystar",("C005","ram-god"):"ramlord",
 ("C022","divine-lady"):"seeress",("C023","crown-lady"):"diadem",
 ("C024","sky-lady"):"skyqueen",("D008A","painted-eye"):"kohleye",
 ("D029","ka-arms"):"kasign",("D030","raised-arms"):"upraised",
 ("D031","holding-arms"):"upholder",("D032","open-arms"):"embrace",
 ("D035","spread-arms"):"refusal",("D037","giving-arm"):"bestow",
 ("D038","loaf-arm"):"loafhand",("D039","bowl-arm"):"bowlhand",
 ("D040","striking-arm"):"smiter",("D041","resting-arm"):"palmdown",
 ("D045","wand-arm"):"wander",("D050F","hand-span"):"digits",
 ("D050I","fingerprints"):"fingermk",("D051","forefinger"):"pointer",
 ("D059","stride-leg"):"steplimb",("D064","walking-legs"):"strider",
 ("D066","calf-leg"):"shank",("D067","right-foot"):"footsole",
 ("E017","wild-jackal"):"prowler",("E017A","desert-dog"):"sandhound",
 ("E017A","lone-wolf"):"loner",("E018","grey-wolf"):"greypelt",
 ("E018","standard-jackal"):"bannerdog",("E019","wild-wolf"):"feralone",
 ("E020A","Seth-beast"):"sethling",("E021","crouching-beast"):"croucher",
 ("E025","hippopotamus"):"riverbull",("E038","ox-bull"):"longhorn",
 ("F003","river-horse"):"hippohead",("F004","lion-front"):"foreleon",
 ("F009","leopard-head"):"pardhead",("F009","panther-head"):"spotface",
 ("F013","ox-horns"):"oxhorns",("F013A","twin-horns"):"twinhorn",
 # G-N
 ("G006A","perched-falcon"):"standhawk",("G009","sun-falcon"):"sundisk",
 ("G011A","sacred-falcon"):"holyhawk",("G012","royal-falcon"):"kinghawk",
 ("G013","sokar-falcon"):"sokar",("G014","mother-vulture"):"mutbird",
 ("G021","guinea-fowl"):"guinea",("G024","bound-lapwing"):"rekhyt",
 ("G026","thoth-bird"):"thoth",("G026A","wading-ibis"):"wader",
 ("G028","black-ibis"):"inkwing",("G032","perched-heron"):"bennu",
 ("G040","flying-duck"):"flyteal",("G041","alighting-duck"):"landteal",
 ("G042","plump-duck"):"plumpwig",("G049","duck-heads"):"twoteals",
 ("I010","uraeus-cobra"):"hooded",("I012","reared-cobra"):"rearcoil",
 ("I013","basket-cobra"):"coilbask",("I015","serpent-snake"):"slither",
 ("L004","grasshopper"):"hopper",("M008","lily-pool"):"lilypond",
 ("M009","lotus-bloom"):"nymphaea",("M012C","lotus-bud"):"budstem",
 ("M014","papyrus-snake"):"coilstem",("M014","papyrus-serpent"):"stemcoil",
 ("M015","papyrus-clump"):"clumpfan",("M016","papyrus-marsh"):"fenfan",
 ("M016","marsh-reeds"):"fentuft",("M021","young-reed"):"sprouter",
 ("M023","royal-sedge"):"kingstalk",("M023","sedge-reed"):"swytuft",
 ("M026","flowering-sedge"):"upperse",("M033B","corn-grain"):"kernels",
 ("M034","wheat-grain"):"emmerear",("M035","grain-heap"):"heapful",
 ("M037","flax-stalk"):"stalkfax",("M038","flax-sheaf"):"linentie",
 ("M039","reed-bundle"):"bundler",("M039","reed-faggot"):"stickset",
 ("M040A","reed-sheaf"):"sheafer",("M040A","bound-reed"):"tiedcane",
 ("M042","blossom-flower"):"petaller",("M044","thorn-spine"):"prickle",
 ("N006","sun-orb"):"sundorb",("N015","duat-star"):"duat",
 ("N015","underworld"):"netherly",("N017","earth-land"):"terra",
 ("N020","tongue-land"):"tongueby",("N022","spit-land"):"sandspit",
 ("N027","dawn-horizon"):"akhet",("N033","sand-grain"):"speck",
 ("N033A","sand-grains"):"specks",("N039","spring-water"):"wellfont",
 ("N040","wading-pool"):"walkpond",("N041","well-water"):"waterway",
 ("N042","deep-well"):"deepwell",("N042","deep-water"):"deepblue",
 # O-S
 ("O016","serpent-gate"):"cobragate",("O017","portal-gate"):"archway",
 ("O020","tabernacle"):"chancel",("O020A","holy-place"):"reliquary",
 ("O021","shrine-front"):"frontage",("O022","tent-booth"):"canopy",
 ("O023","dais-throne"):"jubilee",("O024A","great-pyramid"):"apex",
 ("O024A","pyramid-tomb"):"capstone",("O025","needle-pillar"):"needle",
 ("O025A","stone-pillar"):"monolith",("O029","column-pillar"):"timber",
 ("O030A","tent-pole"):"truss",("O031","doorway-leaf"):"hinge",
 ("O050","threshing-floor"):"thresher",("O051","stored-grain"):"grainheap",
 ("O051","storehouse"):"silo",("P007","rigged-mast"):"riggedm",
 ("Q002","carry-chair"):"litter",("Q006","sarcophagus"):"casket",
 ("R002","flower-altar"):"lotustray",("R002A","offering-stand"):"trivet",
 ("R002A","offering-board"):"salver",("R003","loaf-altar"):"breadtray",
 ("R003","side-table"):"console",("R003A","altar-table"):"platter",
 ("R010","necropolis"):"stairway",("R010A","war-standard"):"banner",
 ("R016","was-sceptre"):"wasstaff",("R016","plume-feather"):"plumage",
 ("R016A","theban-sceptre"):"theban",("R016A","theban-emblem"):"wasplume",
 ("R020","emblem-shield"):"warshield",("R021","neith-arrows"):"darts",
 ("R021","neith-shield"):"aegis",("R022","crossed-arrows"):"crossbolt",
 ("R023","twin-arrows"):"twindart",("R024","neith-bow"):"longbow",
 ("R024","bow-arrows"):"fletching",("R025","double-bow"):"twinbow",
 ("R029","isis-throne"):"isisseat",("S017A","breast-ornament"):"breastpc",
 ("S020","seal-necklace"):"amulet",("S020","seal-ring"):"signage",
 ("S022","shoulder-knot"):"epaulet",("S022","shoulder-cloth"):"mantle",
 ("S025","ceremonial-robe"):"vestment",("S025","robe-cloth"):"raiment",
 ("S026A","royal-kilt"):"loincloth",("S026A","pleated-kilt"):"pleats",
 ("S026B","ceremonial-apron"):"pinafore",("S035","sunshade-fan"):"parasol",
 ("S037","fan-feather"):"ostrich",("S038","crook-sceptre"):"heqa",
 # T-Z
 ("T003","war-mace"):"battlerod",("T003","war-club"):"warstaff",
 ("T005","serpent-mace"):"snakeclub",("T006","twin-serpent-mace"):"twinfang",
 ("T008A","dagger-blade"):"shortedge",("T011A","fletched-arrow"):"feathshot",
 ("T016A","curved-sword"):"curvebrand",("T023","harpoon-head"):"fishbarb",
 ("T025","fish-spear"):"floattip",("T030","knife-blade"):"cuttingrim",
 ("U009","measured-grain"):"grainheap2",("V009","shen-ring"):"shenring",
 ("V017","reed-shelter"):"reedhut",("V018","protection-knot"):"wardtie",
 ("V018","knot-amulet"):"safecharm",("V021","cord-loop"):"measureln",
 ("V024","stick-cord"):"wedjwind",("V025","wound-cord"):"coiltwine",
 ("V025","twined-rope"):"twistflax",("V027","netting-spindle"):"netpin",
 ("V027","netting-needle"):"meshtool",("V028","wick-cord"):"flaxwind",
 ("V029A","fibre-swab"):"fibremitt",("V029A","fibre-mop"):"linenwad",
 ("V030","basket-lord"):"nebweave",("V030A","wicker-basket"):"wickercup",
 ("V031","handled-basket"):"gripcrate",("V032","basket-bag"):"frailtote",
 ("V033A","linen-bag"):"linenholr",("V033A","grain-sack"):"grainsac",
 ("V034","pouch-bag"):"satchel",("V034","small-bundle"):"tinyroll",
 ("W002","oil-jug"):"unguent",("W003A","alabaster-basin"):"alabastr",
 ("W003A","festival-bowl"):"feastdish",("W005","ablution-jar"):"washewer",
 ("W006","metal-vessel"):"bronzepot",("W006","cauldron-pot"):"kettle",
 ("W007","granite-bowl"):"granitug",("W007","stone-basin"):"stonesink",
 ("W008","stone-bowl"):"rockdish",("W008","granite-basin"):"granbasn",
 ("W009","stone-jug"):"stoneewr",("W009","stone-jar"):"rockcrock",
 ("W010","drinking-bowl"):"sipdish",("W010A","shallow-bowl"):"flatdish",
 ("W011","jar-stand"):"jarrest",("W012","ring-stand"):"ringbase",
 ("W012","pot-stand"):"potprop",("W017","water-jars"):"jugrack",
 ("W017","jar-rack"):"jarshelf",("W018","racked-jars"):"rackedjug",
 ("W018","pot-rack"):"crockrack",("W018A","jar-row"):"jugrow",
 ("W019","milk-jar"):"netflask",("W020","milk-jug"):"leafewer",
 ("W020","covered-jar"):"cappedjug",("W021","wine-jars"):"twinflask",
 ("W022","beer-jar"):"brewcrock",("W022","wine-jug"):"vintewer",
 ("W023","handled-jar"):"earewer",("W023","water-jug"):"pitcher",
 ("W024","round-pot"):"orbpot",("W024","round-bowl"):"rounddish",
 ("W024A","wide-pot"):"widecrock",("W024A","wide-bowl"):"widedish",
 ("W025","footed-pot"):"leggedurn",("W025","footed-jar"):"footflask",
 ("X002","tall-loaf"):"tallcob",("X002","white-bread"):"whitebap",
 ("X003","round-loaf"):"roundcob",("X004","bun-bread"):"softbap",
 ("X004A","bread-roll"):"breadbap",("X004A","soft-bread"):"tenderbun",
 ("X004B","round-roll"):"roundbap",("X004B","fresh-bread"):"freshbun",
 ("X006","cake-loaf"):"patcake",("X006","pat-bread"):"flatcake",
 ("X007","half-loaf"):"halfcob",("X007","broken-bread"):"brokebun",
 ("X008","cone-loaf"):"peakcob",("X008","offering-bread"):"offerbun",
 ("X008A","bread-cone"):"breadtip",("X008A","pointed-loaf"):"pointcob",
 ("Y004","scribe-palette"):"inkboard",("Y006","draughtsman"):"gametoke",
 # pre-existing offenders not in agent batches
 ("G053","ba-bird"):"basoul",
 ("W013","red-jar"):"redjar",
 # second-pass fixes for collisions the verifier caught
 ("C002C","daystar"):"sundeity",      # vs C002B daystar
 ("O020A","reliquary"):"shrinebox",   # vs O019A reliquary
 ("R010A","banner"):"warflag",        # vs R008 banner
 ("S037","ostrich"):"plumefan",       # vs G034 ostrich
 ("T010","longbow"):"warbow",         # vs R024 longbow
 ("S020","amulet"):"sealcharm",       # vs V017 amulet (S020 'seal-necklace' -> amulet earlier)
 ("O025","needle"):"obelneed",        # vs V026 needle (O025 'needle-pillar' -> needle earlier)
 ("T016A","curvebrand"):"sabre",      # was 10 chars
 ("T030","cuttingrim"):"keenedge",    # was 10 chars
 ("U009","grainheap2"):"cornpeck",    # placeholder fix
}


def main():
    with open(CSV, encoding="utf-8") as f:
        reader = csv.reader(f); header=next(reader)
        rows=[r for r in reader if r]
    changed=0
    for r in rows:
        code=r[0][:-4] if r[0].endswith(".svg") else r[0]
        # apply repeatedly so chained fixes (original -> intermediate -> final) resolve
        first_old=r[1]
        for _ in range(5):
            k=(code,r[1])
            if k in REPLACE and REPLACE[k]!=r[1]:
                r[1]=REPLACE[k]
            else:
                break
        if r[1]!=first_old:
            r[4]=(r[4]+"; " if r[4] else "")+("shortened from '%s'"%first_old)
            changed+=1
    seen={}; coll=[]; long=[]
    for r in rows:
        w=r[1]
        if "-" in w or len(w)>MAXLEN: long.append((r[0],w,len(w)))
        if w in seen: coll.append((w,seen[w],r[0]))
        else: seen[w]=r[0]
    ok=True
    if coll:
        ok=False; print("COLLISIONS (%d):"%len(coll))
        for w,a,b in coll: print(f"  '{w}': {a} & {b}")
    if long:
        ok=False; print("TOO LONG / HYPHEN (%d):"%len(long))
        for c,w,n in long: print(f"  {c}: {w} ({n})")
    if not ok:
        print("\nNot writing."); sys.exit(1)
    with open(CSV,"w",newline="",encoding="utf-8") as f:
        wr=csv.writer(f); wr.writerow(header); wr.writerows(rows)
    print(f"OK: {changed} renamed. All nouns <= {MAXLEN}, no hyphens, unique.")

if __name__=="__main__": main()
