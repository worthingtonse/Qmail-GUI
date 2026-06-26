#!/usr/bin/env python3
"""Reduce words_nouns.csv to ONE best word per SVG.

For each SVG with multiple noun rows, KEEP the word in KEEP[code]; drop the
others. SVGs with a single noun row are left untouched. The keeper is chosen
for email use: short, few syllables, easy to spell, plain (not a coined
compound), and pairs naturally with adjectives.
"""
import csv, os, sys
HERE=os.path.dirname(__file__)
CSV=os.path.join(HERE,"..","public","qmail-avatars","egyptian","noto","words_nouns.csv")

KEEP={
 "A001":"man","A012":"soldier","A017":"child","A033":"herdsman","A043":"pharaoh",
 "B001":"woman","B005":"nurse","D012":"pupil","D063":"shin","D066":"sole",
 "D067":"toe","E005":"cow","E014":"dog","E017":"wolf","E017A":"loner",
 "E018":"greypelt","E019":"feralone","E024":"leopard","E025":"hippo","E028":"gazelle",
 "E034":"hare","E038":"ox","F003":"head","F009":"catface","F031":"hide",
 "F032":"tail","F041":"spine","G004":"hawk","G005":"falcon","G016":"henhawk",
 "G021":"fowl","G029":"stork","G043":"quail","G044":"quails","G048":"nest",
 "G049":"heads","G053":"soul","H006":"plume","I002":"turtle","I009":"viper",
 "I010":"coiler","I012":"upcobra","I015":"serpent","K003":"fish","L001":"scarab",
 "L004":"locust","M008":"lotus","M009":"flower","M013":"reed","M014":"snakecane",
 "M015":"marsh","M016":"sedgetuft","M022A":"rush","M023":"sedgebush","M029":"seed",
 "M031":"root","M031A":"roots","M033":"grain","M033B":"corn","M034":"wheat",
 "M035":"heap","M036":"flax","M037":"linen","M038":"faggot","M039":"reedstalk",
 "M040":"sheaf","M040A":"tiedreeds","M041":"wood","M042":"petals","M043":"vine",
 "M044":"thorn","N005":"sun","N006":"majesty","N014":"star","N015":"night",
 "N016":"land","N017":"soil","N018":"island","N018A":"isle","N018B":"dune",
 "N019":"horizon","N020":"spit","N021":"riverbank","N022":"bank","N025":"desert",
 "N025A":"highlands","N026":"mountain","N027":"sunrise","N030":"hill","N031":"path",
 "N033":"grit","N033A":"grains","N035":"water","N035A":"waves","N039":"pool",
 "N041":"well","N042":"deeppool","O001":"house","O001A":"dwelling","O002":"estate",
 "O003":"palace","O004":"hut","O005":"wall","O005A":"rampart","O016":"gate",
 "O017":"portal","O018":"shrine","O019":"temple","O019A":"sanctuary","O020":"refuge",
 "O020A":"oratory","O021":"facade","O022":"tent","O023":"dais","O024":"pyramid",
 "O024A":"apex","O025":"obelisk","O025A":"spire","O026":"slab","O027":"hall",
 "O029":"column","O030A":"post","O031":"doorway","O050":"floor","O051":"silo",
 "P002":"boat","P005":"sail","P006":"mast","P007":"rigging","P008":"oar",
 "Q002":"chair","Q004":"pillow","Q005":"box","Q006":"casket","R001":"altar",
 "R002":"sacrifice","R002A":"trivet","R003":"console","R003A":"gift","R004":"mat",
 "R007":"incense","R008":"banner","R010":"standard","R010A":"emblem","R011":"pillar",
 "R016":"plumage","R016A":"plumetop","R020":"arrows","R021":"darts","R024":"longbow",
 "R025":"bows","R029":"throne","S010":"band","S015":"collar","S017A":"pendant",
 "S020":"seal","S021":"ring","S022":"mantle","S024":"belt","S025":"garment",
 "S026":"apron","S026A":"pleats","S026B":"pinafore","S032":"cloth","S034":"life",
 "S035":"shade","S037":"fan","S038":"crook","S043":"staff","T001":"mace",
 "T003":"warstaff","T005":"cudgel","T006":"bludgeon","T007A":"axe","T008":"dagger",
 "T008A":"poniard","T010":"warbow","T016":"sword","T016A":"sabre","T017":"cart",
 "T022":"barb","T023":"harpoon","T025":"float","T030":"knife","T036":"shield",
 "U009":"measure","U028":"drill","U042":"scales","V009":"loop","V017":"amulet",
 "V018":"safetie","V021":"cord","V023":"whip","V025":"coilrope","V026":"needle",
 "V027":"meshhook","V028":"wick","V029":"mop","V029A":"linenpad","V030":"basket",
 "V031":"hamper","V032":"frail","V033":"bag","V033A":"linenroll","V034":"satchel",
 "V037":"bandage","W002":"jar","W003":"basin","W003A":"feastdish","W005":"ewer",
 "W006":"kettle","W007":"stonecup","W008":"stonebowl","W009":"rockpot","W010":"cup",
 "W010A":"goblet","W011":"stand","W012":"potring","W013":"pot","W016":"rack",
 "W017":"jarrack","W018":"crockpot","W019":"jug","W020":"leafjug","W021":"wine",
 "W022":"flagon","W023":"pitcher","W024":"roundpot","W024A":"widepot","W025":"legpot",
 "X001":"bread","X002":"whitebap","X003":"flatbread","X004":"bun","X004A":"tenderbun",
 "X004B":"freshbun","X006":"cake","X007":"brokebun","X008":"cone","X008A":"breadtip",
 "Y003":"scribe","Y004":"writer","Y005":"game","Y006":"pawn","Y007":"harp",
 "Z008":"oval",
}

def main():
    with open(CSV,encoding="utf-8") as f:
        rdr=csv.reader(f); header=next(rdr); rows=[r for r in rdr if r]

    # group rows by code
    by_code={}
    for r in rows:
        code=r[0][:-4] if r[0].endswith(".svg") else r[0]
        by_code.setdefault(code,[]).append(r)

    out=[]; dropped=0; problems=[]
    for code,grp in by_code.items():
        if len(grp)==1:
            out.append(grp[0]); continue
        keep=KEEP.get(code)
        if keep is None:
            problems.append((code,"no KEEP entry",[r[1] for r in grp])); continue
        match=[r for r in grp if r[1]==keep]
        if not match:
            problems.append((code,"keep word '%s' not among rows"%keep,[r[1] for r in grp])); continue
        out.append(match[0])
        dropped+=len(grp)-1

    if problems:
        print("PROBLEMS (%d):"%len(problems))
        for c,m,ws in problems: print("  %s: %s  (have: %s)"%(c,m,",".join(ws)))
        print("Not writing."); sys.exit(1)

    # uniqueness of remaining words
    words=[r[1] for r in out]
    if len(words)!=len(set(words)):
        from collections import Counter
        dups=[w for w,n in Counter(words).items() if n>1]
        print("DUP words remain:",dups); sys.exit(1)

    # keep file ordered by original appearance
    order={id(r):i for i,r in enumerate(rows)}
    out.sort(key=lambda r: order.get(id(r),1e9))

    with open(CSV,"w",newline="",encoding="utf-8") as f:
        wr=csv.writer(f); wr.writerow(header); wr.writerows(out)
    print("OK: kept %d nouns (one per SVG), dropped %d rows."%(len(out),dropped))

if __name__=="__main__": main()
