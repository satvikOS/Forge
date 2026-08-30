#!/usr/bin/env python3
"""mitre_ratio_check.py — an oracle for the curved-section sweep that is NOT the
engine's own closed form.

WHY THIS IS NEEDED. `sweepFaceMitre` accepts a build only if its volume equals
`area x centroid-path length` to 1e-6. That gate is real but it is SELF-REFERENTIAL:
it checks the construction against the identity the construction was derived from.
It cannot tell "the engine built the mitred sweep" from "the engine built some other
solid that happens to enclose the same volume" — and this repository has four
measured cases where volume alone ratified a wrong solid.

THE INDEPENDENT ORACLE. The corpus A/B runs OCCT's `BRepOffsetAPI_MakePipeShell`
twice on the same input: once at its DEFAULT transition mode (`Transformed`) and once
with `SetTransitionMode(RightCorner)`. Under `Transformed`, OCCT was measured
(test/run_ab_pipeshell_transition.sh, 45 synthetic cases) not to carry the section
through the spine corner: the second leg's section is the first leg's projected, so
for a section of area A on two legs of length L1, L2 meeting at angle theta it
encloses A*(L1 + L2*cos theta). The MITRE encloses A*(L1 + L2). The A/B's spine is
two EQUAL legs at exactly 30 degrees, so if — and only if — the native engine is
building the mitre, then for every part

    native_volume / occt_default_volume  =  2 / (1 + cos 30 deg)  =  1.0717967697...

independently of the section's shape, area or edge types. Nothing in the native
engine computes that number, and OCCT's default arm is an entirely separate
implementation, so agreement is evidence and not a tautology.

The spread around the median is real and expected: the identity is exact only when
the section CENTROID sits on the spine start, and the A/B starts its spine at the
FACE centroid while handing PIPESHELL the face's OUTER WIRE, so a part with holes
carries a small offset. The number to read is therefore the MEDIAN, and the control
is that the newly covered curved classes match it to the same precision as the
LINE_ONLY class the A/B has already proved exact against OCCT(RightCorner) on all
309 parts.

MEASURED, 600 parts, `ps_after/results.jsonl`:

    class          n   median              |median - 2/(1+cos30)|
    LINE_ONLY    ...   1.071796770         3.7e-11    <- the proven control
    LINE_ARC     ...   1.071796770         7.5e-11    <- new coverage
    HAS_BSPLINE  ...   1.071796769         2.8e-10    <- new coverage
    ARC_ONLY     ...   1.071796758         1.2e-08    <- new coverage

usage:  mitre_ratio_check.py <results.jsonl> [census.tsv]
exit 0 iff every class's median is within 1e-7 of the closed form.
"""
import collections
import csv
import json
import math
import statistics
import sys

PRED = 2.0 / (1.0 + math.cos(math.radians(30.0)))
TOL = 1.0e-7


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    census = {}
    if len(argv) > 2:
        with open(argv[2]) as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                census[row["part"]] = row.get("class", "?")

    by = collections.defaultdict(list)
    with open(argv[1]) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            # The DEFAULT-transition OCCT arm is the PIPESHELL row; PIPESHELL_RC is
            # the RightCorner one and is NOT what this identity compares against.
            if d.get("family") != "PIPESHELL" or d.get("bucket") != "BOTH_OK":
                continue
            n, o = d["native"], d["occt"]
            # Both arms must be valid solids, or the ratio is between a solid and
            # whatever OCCT returned.
            if n.get("valid") != 1 or o.get("valid") != 1:
                continue
            if abs(o["vol"]) < 1e-9:
                continue
            by[census.get(d["part"], "?")].append(abs(n["vol"]) / abs(o["vol"]))

    if not by:
        print("no comparable rows — refusing to report a pass on an empty set")
        return 3

    print(f"predicted mitre/translation ratio 2/(1+cos30) = {PRED:.10f}")
    bad = 0
    for k in sorted(by):
        v = by[k]
        med = statistics.median(v)
        off = abs(med - PRED)
        flag = "ok" if off <= TOL else "OFF"
        print(f"  {k:<13} n={len(v):4d}  median={med:.10f}  "
              f"min={min(v):.6f} max={max(v):.6f}  |med-pred|={off:.2e}  {flag}")
        if off > TOL:
            bad += 1
    print("PASS" if bad == 0 else f"FAIL — {bad} class(es) off the closed form")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
