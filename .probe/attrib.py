import json, collections, sys
base = "/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2"
res = [json.loads(l) for l in open(base + "/forge-kernel/.build-corpus-ab/run-thicken-baseline/results.jsonl") if l.strip()]
cen = {}
for l in open(base + "/.probe/census.jsonl"):
    if l.strip():
        d = json.loads(l); cen[d["part"]] = d
fam = [r for r in res if r.get("family") == "THICKEN" and r.get("applicable")]
oo  = [r for r in fam if r["bucket"] == "OCCT_ONLY"]
ok  = [r for r in fam if r["bucket"] == "BOTH_OK"]
print("applicable %d  BOTH_OK %d  OCCT_ONLY %d" % (len(fam), len(ok), len(oo)))
print()
print("=== surface type of the picked face, by bucket ===")
tab = collections.defaultdict(lambda: [0, 0])
for r in fam:
    c = cen.get(r["part"])
    t = c.get("srf", "MISSING") if c else "MISSING"
    tab[t][0 if r["bucket"] == "BOTH_OK" else 1] += 1
for t, (a, b) in sorted(tab.items(), key=lambda kv: -sum(kv[1])):
    print("  %-14s both_ok %4d   OCCT_ONLY %4d   (%.1f%% of the deletion bucket)"
          % (t, a, b, 100.0 * b / max(1, len(oo))))
print()
print("=== the deletion bucket, detail ===")
d2 = collections.Counter()
for r in oo:
    c = cen.get(r["part"], {})
    d2[(c.get("srf"), c.get("trimmed"), c.get("closed"))] += 1
for k, v in d2.most_common():
    print("  %4d  srf=%-12s trimmed=%-5s closed=%s" % (v, k[0], k[1], k[2]))
print()
print("=== boundary of the deferring face (wires / edge kinds) ===")
d3 = collections.Counter()
for r in oo:
    c = cen.get(r["part"], {})
    d3[(c.get("srf"), c.get("wires"), c.get("edges"), c.get("lines"), c.get("circles"), c.get("other"))] += 1
for k, v in d3.most_common(18):
    print("  %4d  srf=%-10s wires=%s edges=%s L=%s C=%s other=%s" % (v, k[0], k[1], k[2], k[3], k[4], k[5]))
