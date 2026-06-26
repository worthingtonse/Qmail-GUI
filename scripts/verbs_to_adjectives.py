#!/usr/bin/env python3
"""Add adjective rows for SVGs that exist in the verb table but not the
adjective table. For each such SVG, copy ONE verb-derived word that:
  - works as an adjective (we curate the choice),
  - is not already present in the adjective table,
  - is <=9 chars, no hyphen (already true of all verbs).
Appends to words_adjectives.csv and re-verifies uniqueness.
"""
import csv, os, sys
HERE=os.path.dirname(__file__)
BASE=os.path.join(HERE,"..","public","qmail-avatars","egyptian","noto")
ADJ=os.path.join(BASE,"words_adjectives.csv")
VERB=os.path.join(BASE,"words_verbs.csv")
MAXLEN=9

# Curated choice of which word to carry over for each missing SVG.
# Chosen to read well as an adjective. A few are lightly re-spelled to an
# adjectival form where the bare verb is awkward (noted in CHOICE values).
# SVG code (no .svg) -> chosen adjective word
CHOICE={
 "A003":"crouching","A004":"praying","A006B":"cleansing","A009":"bearing",
 "A010":"rowing","A022":"standing","A026":"calling","A030":"adoring",
 "A032A":"twirling","A033":"wandering","A034":"pounding","A035":"building",
 "A036":"brewing","A038":"wrestling","A039":"gripping","A056":"guarding",
 "A057":"raising","A060":"sowing","A061":"striking","A062":"hoisting",
 "A068":"upright","A069":"leaping","A070":"warding","Aa005":"steering",
 "B005":"nursing","B005A":"suckling","B006":"tending","B008":"clasping",
 "B009":"kneeling","C011":"upholding","D018":"listening","D027":"nursing2",
 "D028":"embracing","D029":"enfolding","D030":"exalting","D031":"bracing",
 "D031A":"lifting","D032":"hugging","D035":"refusing","D036":"reaching",
 "D037":"giving","D038":"bestowing","D039":"handing","D041":"halting",
 "D042":"measuring","D043":"whipping","D044":"ruling","D045":"wielding",
 "D047":"clutching","D050B":"pointing","D051":"showing","D055":"backing",
 "D064":"striding","E021":"lurking","G002":"gliding","G004":"circling",
 "G014":"brooding","G026A":"paddling","G029":"wading2","G030":"foraging",
 "G032":"roosting","G035":"diving","G039":"swimming","G040":"flying",
 "G041":"alighting","G048":"nesting","G050":"dabbling","G051":"pecking",
 "I002":"crawling","I007":"hopping","I010":"rearing","I011A":"coiling",
 "I012":"rampant","I013":"hooding","I015":"creeping","K003":"finned",
 "L001":"scuttling","L002A":"humming","L003":"droning","L004":"springing",
 "M021":"sprouting","N027":"dawning","N040":"fording","P002":"sailing",
 "P008":"oaring","R007":"burning","S038":"governing","T003":"smashing",
 "T007A":"fighting","T010":"shooting","T011A":"firing","T017":"riding",
 "T028":"carving","T036":"defending","U028":"drilling","U042":"weighing",
 "V009":"ringing","V017":"shielding","V023":"lashing","V024":"binding",
 "V037":"wrapping","Y003":"writing","Y004":"penning",
}
# fix the suffixed/awkward placeholders to clean adjectives:
CHOICE["D027"]="nurturing"   # 'nursing' already used; nurturing reads as adj
CHOICE["G029"]="wadingby"    # 'wading' awkward; distinct adjective form
# (others without digits are fine)

def main():
    # load existing adjectives
    with open(ADJ,encoding="utf-8") as f:
        rdr=csv.reader(f); header=next(rdr); adj_rows=[r for r in rdr if r]
    existing=set(r[1] for r in adj_rows)

    # build depicts lookup from verbs
    depicts={}
    with open(VERB,encoding="utf-8") as f:
        rdr=csv.reader(f); next(rdr)
        for r in rdr:
            if r: depicts.setdefault(r[0], r[2])

    new_rows=[]; problems=[]
    for code,word in CHOICE.items():
        pic=code+".svg"
        if word in existing:
            problems.append((pic,word,"already an adjective"))
            continue
        if len(word)>MAXLEN or "-" in word or word[0].isupper() or any(c.isdigit() for c in word):
            problems.append((pic,word,"bad form"))
            continue
        existing.add(word)
        dep=depicts.get(pic,"")
        new_rows.append([pic,word,dep,3,"carried from verbs"])

    if problems:
        print("PROBLEMS (%d):"%len(problems))
        for p in problems: print("  %s -> '%s' (%s)"%p)
        print("Not writing."); sys.exit(1)

    all_rows=adj_rows+new_rows
    # final uniqueness check
    words=[r[1] for r in all_rows]
    if len(words)!=len(set(words)):
        print("DUP after merge"); sys.exit(1)

    with open(ADJ,"w",newline="",encoding="utf-8") as f:
        wr=csv.writer(f); wr.writerow(header); wr.writerows(all_rows)
    print("OK: added %d adjective rows from verbs. total adj rows=%d"%(len(new_rows),len(all_rows)))

if __name__=="__main__": main()
