import json, collections
base = "/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2"
res = [json.loads(l) for l in open(base + "/forge-kernel/.build-corpus-ab/run-thicken-baseline/results.jsonl") if l.strip()]
cc = {}
for l in open(base + "/.probe/cylcert.jsonl"):
    if l.strip():
        d = json.loads(l); cc[d["part"]] = d
oo = [r["part"] for r in res if r.get("family") == "THICKEN" and r.get("bucket") == "OCCT_ONLY"]
print("deletion bucket:", len(oo))
c = collections.Counter()
for p in oo:
    d = cc.get(p, {})
    c[(d.get("cyl"), d.get("rect"), d.get("full_u"), d.get("rev"), d.get("Rp_pos"))] += 1
print("  cyl / rect-certificate / full-2pi-u / face-REVERSED / offset-radius>0 :")
for k, v in c.most_common():
    print("   %4d  cyl=%s rect=%s full_u=%s rev=%s Rp>0=%s" % (v, k[0], k[1], k[2], k[3], k[4]))
rects = [p for p in oo if cc.get(p, {}).get("rect") and cc.get(p, {}).get("Rp_pos")]
print()
print("BOUNDED FIX YIELD (rect certificate AND offset radius > 0): %d of %d = %.1f%%"
      % (len(rects), len(oo), 100.0 * len(rects) / len(oo)))
print("would take native coverage 407 -> %d of 600 = %.1f%%  (OCCT is 600 = 100.0%%)"
      % (407 + len(rects), 100.0 * (407 + len(rects)) / 600))
print()
nonrect = [p for p in oo if not cc.get(p, {}).get("rect")]
print("NOT covered (%d): rel-area error of the rectangle certificate" % len(nonrect))
for p in nonrect[:12]:
    d = cc[p]
    print("   %-10s rel=%.3e wires=%d du=%.4f dv=%.4f" % (p, d["rel"], d["wires"], d["du"], d["dv"]))
print()
us = collections.Counter(round(cc[p]["du"], 6) for p in oo)
print("u-span histogram over the deletion bucket:", us.most_common(6))
