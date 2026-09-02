#!/usr/bin/env python3
"""POSITIVE CONTROL for the SARC fix: prove the two forge_verify binaries DIFFER,
and differ only where the fix says they should.

A null A/B is the easiest thing in the world to manufacture -- a stub binary, a stale
object file, a baked rpath -- so before any corpus number is believed, the two arms are
made to disagree on a case constructed to trip the defect, and to AGREE on a case that
does not trip it.

CASE A (trips it): a half-disc whose arc end point is 1e-6 mm further from the stated
centre than its start point. |,|end-c| - |start-c|,| = 1e-6 > Precision::Confusion()
(1e-7), so BRepBuilderAPI_MakeEdge refuses; the OLD kernel `continue`d and the arc left
the sketch silently.

CASE B (does not trip it): the same half-disc with both endpoints exactly 10 from the
centre. Both binaries must agree here, or they differ for some reason other than the fix.

Expected of a CORRECT build: volume = pi * r^2 / 2 * 5 = 785.398 for r = 10.
"""
import json, math, subprocess, sys

NEW = "/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_70fa45d9-6be-1/forge-kernel/build-sarc/forge_verify"
OLD = "/private/tmp/claude-501/-Users-account-clawteam1/8e894a02-52d3-4e26-a3a3-5c26cd2b228c/scratchpad/oldtree/forge-kernel/build-old/forge_verify"


def half_disc(end_x):
    return (
        "%1 = SKETCH(XY)\n"
        "%2 = SPT(%1, 0, 0)\n"
        "%3 = SPT(%1, 10, 0)\n"
        f"%4 = SPT(%1, {end_x!r}, 0)\n"
        "%5 = SARC(%2, %3, %4)\n"
        "%6 = SLINE(%4, %3)\n"
        "%7 = SOLVE(%1)\n"
        "%8 = EXTRUDE(%7, 5)\n"
        "RESULT(%8)\n"
    )


CASES = {
    "A_nonequidistant_1e-6": half_disc(-10.000001),
    "B_exactly_equidistant": half_disc(-10.0),
}

EXPECT = math.pi * 100.0 / 2.0 * 5.0

out = {}
for binname, path in (("OLD_367fe6cf", OLD), ("NEW_sarcfix", NEW)):
    lines = "".join(json.dumps({"id": k, "ir": v}) + "\n" for k, v in CASES.items())
    pr = subprocess.run([path], input=lines, capture_output=True, text=True, timeout=300)
    got = {}
    for ln in pr.stdout.splitlines():
        ln = ln.strip()
        if ln.startswith("{"):
            try:
                r = json.loads(ln)
                got[r.get("id")] = r
            except Exception:
                pass
    out[binname] = got

print(f"expected volume of a correct half-disc r=10 h=5 : {EXPECT:.4f}\n")
for case in CASES:
    print(f"=== {case} ===")
    for binname in out:
        r = out[binname].get(case)
        if r is None:
            print(f"  {binname:14s}  NO RECORD")
            continue
        vol = r.get("volume")
        err = (r.get("error") or "")[:130]
        rel = "n/a" if not vol else f"{abs(vol - EXPECT) / EXPECT * 100:.4f}%"
        print(f"  {binname:14s}  ok={r.get('ok')}  volume={vol}  off_by={rel}  faces={r.get('faceCount')}")
        if err:
            print(f"                  error: {err}")
    print()
