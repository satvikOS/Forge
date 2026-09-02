#!/usr/bin/env python3
"""abc_ofs_arc_split.py — read two abc_ofs_verify runs and report the ARC SPLIT.

scripts/abc_ofs_verify.py answers "how many of the 586 rebuild the right solid".
It does not answer the question that isolated the SARC defect, which is the one
that matters when a change claims to fix arcs:

    0 arcs   477 translated -> 455 pass (95.4%),  0 refused
    >=1 arc  109 translated ->  32 pass (29.4%), 29 refused

This does, for a PAIR of runs, and it is deliberately paired PER MODEL. An
aggregate pass rate that goes up is compatible with a change that fixes twelve
models and breaks two; only the per-model transition table says whether anything
regressed, and "0 pass -> fail" is the claim a kernel change has to make.

It also prints the kernel's own refusal MESSAGES on both sides, because a
refusal that changes its wording is a different fact from a refusal that goes
away, and the failure taxonomy per split, because a change can move a model from
"the kernel refused it" to "it built the wrong thing" without moving the pass
rate at all.

Both directories must be runs of the SAME translator over the SAME corpus — the
script asserts the two translated the identical model set rather than assuming
it, since comparing two different samples is the easiest way to manufacture an
improvement.

Usage:
  python3 scripts/abc_ofs_arc_split.py <before --out dir> <after --out dir>
"""
from __future__ import annotations

import collections
import json
import os
import sys


def load(d: str) -> dict:
    path = os.path.join(d, "results.jsonl")
    if not os.path.exists(path):
        raise SystemExit(f"REFUSING: {path} does not exist — that is not an "
                         "abc_ofs_verify.py --out directory.")
    rows = [json.loads(l) for l in open(path)]
    if not rows:
        raise SystemExit(f"REFUSING: {path} is empty — refusing to report a split of nothing.")
    return {r["id"]: r for r in rows}


def label(row: dict) -> str:
    """The failure taxonomy key, with a mismatch expanded to WHICH observables."""
    if row.get("fail") is None:
        return "pass"
    if row["fail"] != "mismatch":
        return row["fail"]
    return "mismatch:" + "+".join(sorted(row.get("mismatched", [])))


def split(rows: dict) -> dict:
    out = {k: {"n": 0, "pass": 0, "refused": 0, "fails": collections.Counter()}
           for k in ("0arc", "arc")}
    for r in rows.values():
        b = out["arc" if r.get("stats", {}).get("arcs", 0) >= 1 else "0arc"]
        b["n"] += 1
        if r.get("fail") is None:
            b["pass"] += 1
        else:
            b["fails"][label(r)] += 1
            if r["fail"] == "kernel_compile_error":
                b["refused"] += 1
    return out


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__.strip().splitlines()[-1])
    before, after = load(sys.argv[1]), load(sys.argv[2])
    if set(before) != set(after):
        raise SystemExit(
            "REFUSING: the two runs translated DIFFERENT model sets (%d vs %d, "
            "%d only in the first, %d only in the second). Comparing two samples "
            "is not a before/after."
            % (len(before), len(after), len(set(before) - set(after)),
               len(set(after) - set(before))))
    print("translated (both arms, identical set): %d\n" % len(before))

    for name, rows in (("BEFORE", before), ("AFTER ", after)):
        s = split(rows)
        print(name)
        for k, lab in (("0arc", "0 arcs "), ("arc", ">=1 arc")):
            b = s[k]
            print("  %s  %3d translated -> %3d pass (%.1f%%), %d refused by the kernel"
                  % (lab, b["n"], b["pass"], 100.0 * b["pass"] / max(b["n"], 1), b["refused"]))
            for f, c in b["fails"].most_common(10):
                print("        %4d  %s" % (c, f))
        print()

    print("PAIRED, per model — the only line that can show a regression:")
    d = collections.Counter()
    for k in before:
        d[("pass" if before[k].get("fail") is None else "fail") + " -> " +
          ("pass" if after[k].get("fail") is None else "fail")] += 1
    for k, v in sorted(d.items()):
        print("  %-16s %d" % (k, v))
    regressed = [k for k in sorted(before)
                 if before[k].get("fail") is None and after[k].get("fail") is not None]
    print("  REGRESSIONS: %s" % (", ".join(regressed) if regressed else "none"))

    for name, rows in (("BEFORE", before), ("AFTER ", after)):
        c = collections.Counter(r.get("error", "")[:90] for r in rows.values()
                                if r.get("fail") == "kernel_compile_error")
        print("\nkernel refusal messages, %s:" % name)
        for m, n in c.most_common(10):
            print("  %4d  %s" % (n, m))
    return 0


if __name__ == "__main__":
    sys.exit(main())
