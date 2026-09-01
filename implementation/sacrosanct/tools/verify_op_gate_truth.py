#!/usr/bin/env python3
"""verify_op_gate_truth.py — reproduce D-035.

Answers one question: when the harness says an emission failed on an
"out-of-vocabulary op", is that the KERNEL's verdict or a UI-policy verdict?

It does three things, in the order that matters:
  1. Census every op at the op position (`%N = NAME(`). A SUBSTRING IS NOT AN OP —
     this is why the census is anchored, and why D-034's `bore` count (which
     matched inside `CBORE`) was wrong.
  2. Probe the verifier BINARY for the grammar it actually accepts, rather than
     trusting any list. Truth comes from the instrument.
  3. Run every emission through that binary and report the real taxonomy.

Usage:
  verify_op_gate_truth.py --emissions <emissions.jsonl> --verify <forge_verify>
                         [--vocabulary <archie_op_vocabulary.json>] [--jobs 3]
"""
import argparse
import collections
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

OP_RE = re.compile(r"%\d+\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(")

# Only decides which names get PROBED, never which are accepted.
PROBE = """BLEND BOX CBORE CHAMFER CIRCLE COMMON CONE CUT CYL DEFEATURE EXTRUDE
FILLET FOLD FUSE HEAL HOLE INPUT LOFT MIRROR PATTERN POLY PRISM PUSHFACE RECT
REGPOLY RESIZEBORE REVOLVE RING ROTATE RRECT SECTION SHELL SLOT SPHERE SWEEP TAG TORUS
TRANSLATE TUBE VERIFY WIRE PLY RESULT FST POISSON PUSH CYLINDER BORE CUBE
CUBOID""".split()


def probe_vocab(verify_bin):
    """Ask the binary which op names it knows. An op is IN unless the parser
    says it is not -- any other error (arity, semantics) still means the NAME
    was understood."""
    accepted, unknown = set(), set()
    for op in sorted(set(PROBE)):
        req = json.dumps({"id": "probe", "ir": f"%1 = {op}(1,2,3)\nRESULT(%1)"})
        try:
            p = subprocess.run([verify_bin], input=req + "\n", capture_output=True,
                               text=True, timeout=30,
                               cwd=os.path.dirname(os.path.abspath(verify_bin)) or ".")
        except Exception:                                          # noqa: BLE001
            continue
        (unknown if f"unknown op `{op}`" in (p.stdout + p.stderr) else accepted).add(op)
    return accepted, unknown


def classify(err):
    if err.startswith("HARNESS"):        return "verifier crash or timeout"
    if "unknown op" in err:              return "unknown op (true out-of-vocabulary)"
    if "VERIFY failed" in err:           return "VERIFY assertion failed"
    if "empty feature tree" in err:      return "empty feature tree"
    if "parse" in err:                   return "parse error"
    if "not closed" in err or "invalid solid" in err:
        return "invalid / not-closed solid"
    return "other"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--emissions", required=True)
    ap.add_argument("--verify", required=True)
    ap.add_argument("--vocabulary")
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()

    vb = os.path.abspath(a.verify)
    rows = [json.loads(l) for l in open(a.emissions) if l.strip()]
    print(f"emissions : {a.emissions}  ({len(rows)} rows)")
    print(f"verifier  : {vb}")

    # ── 1. anchored census ────────────────────────────────────────────────────
    census = collections.Counter()
    for r in rows:
        census.update(OP_RE.findall(r.get("ir", "")))

    # ── 2. the grammar the instrument actually has ────────────────────────────
    accepted, unknown = probe_vocab(vb)
    print(f"\nverifier accepts {len(accepted)} probed names; rejects {len(unknown)}: "
          f"{' '.join(sorted(unknown))}")

    if a.vocabulary:
        v = json.load(open(a.vocabulary))
        ui = set(o["op"] for o in v["ops"])
        print(f"forge::ui allows {len(ui)} of them (user-invocable)")
        gated = {k: n for k, n in census.items() if k not in ui and k in accepted}
        if gated:
            tot = sum(census[k] for k in census if k not in ui)
            g = sum(gated.values())
            print(f"\nOPS THE KERNEL ACCEPTS BUT NO UI COMMAND EMITS: "
                  f"{g} of {tot} 'illegal' uses ({g/tot:.1%})")
            for k, n in sorted(gated.items(), key=lambda x: -x[1]):
                print(f"    {k:12s} {n}")

    # ── 3. what the kernel actually does with them ────────────────────────────
    def run(r):
        try:
            p = subprocess.run([vb], input=json.dumps({"id": r["id"], "ir": r["ir"]}) + "\n",
                               capture_output=True, text=True, timeout=300,
                               cwd=os.path.dirname(vb))
            d = json.loads(p.stdout.strip().splitlines()[-1])
            return d.get("ok"), d.get("valid"), d.get("volume"), (d.get("error") or "")
        except Exception as e:                                     # noqa: BLE001
            return None, None, None, f"HARNESS {type(e).__name__}: {e}"

    with ThreadPoolExecutor(max_workers=a.jobs) as ex:
        out = list(ex.map(run, rows))

    n = len(out)
    tax = collections.Counter(classify(e) for _, _, _, e in out if e)
    print(f"\nagainst the verifier, n={n}:")
    print(f"  ok=true           {sum(1 for o,_,_,_ in out if o is True):4d} "
          f"({sum(1 for o,_,_,_ in out if o is True)/n:6.1%})")
    print(f"  valid=true        {sum(1 for _,v,_,_ in out if v is True):4d} "
          f"({sum(1 for _,v,_,_ in out if v is True)/n:6.1%})")
    print(f"  produced a solid  {sum(1 for _,_,vol,_ in out if (vol or 0)>0):4d} "
          f"({sum(1 for _,_,vol,_ in out if (vol or 0)>0)/n:6.1%})")
    print("\nfailure taxonomy:")
    for k, c in tax.most_common():
        print(f"  {c:4d} ({c/n:6.1%})  {k}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
