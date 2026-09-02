#!/usr/bin/env python3
"""What does each triviality threshold buy?

349 of 487 proved solids die on `trivial:faces<8`. That gate is the single largest loss
in the funnel -- larger than the kernel and the translator combined -- so the owner's
decision needs the curve, not the one point we happen to sit on.

Read from the KERNEL censuses already written beside each proved solid, so this is a
count of measured faces, not an estimate.
"""
import collections, glob, json, os

PAIRS = "/Users/account_clawteam1/archdisc-Models/data/forge/abc_real_seq_v1/verified_pairs"

faces, arcs = [], 0
for p in sorted(glob.glob(os.path.join(PAIRS, "*.census.json"))):
    c = json.load(open(p))
    n = c.get("faceCount")
    if n is None:
        continue
    ir = p.replace(".census.json", ".ir")
    has_arc = os.path.exists(ir) and "SARC(" in open(ir).read()
    faces.append((n, has_arc))

faces.sort()
tot = len(faces)
print(f"proved solids with a kernel census: {tot}")
print(f"  containing >=1 SARC             : {sum(1 for _, a in faces if a)}")
print()
h = collections.Counter(n for n, _ in faces)
print("face-count histogram (proved solids):")
for n in sorted(h):
    if n <= 20:
        print(f"  {n:3d} faces  {h[n]:4d}")
print(f"  >20 faces  {sum(v for k, v in h.items() if k > 20):4d}")
print()
print("CORPUS SIZE AS A FUNCTION OF THE TRIVIALITY THRESHOLD")
print("(before the duplicate-signature gate, which removed 7 at threshold 8)")
print(f"  {'threshold':>12}  {'rows kept':>10}  {'% of 487':>9}  {'arc-bearing':>12}")
for t in (0, 4, 5, 6, 7, 8, 10, 12, 16, 20):
    keep = [(n, a) for n, a in faces if n >= t]
    print(f"  faces >= {t:<3d}  {len(keep):>10}  {100*len(keep)/tot:>8.1f}%  {sum(1 for _, a in keep if a):>12}")
