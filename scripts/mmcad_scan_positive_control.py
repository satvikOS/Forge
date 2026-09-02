#!/usr/bin/env python3
"""mmcad_scan_positive_control.py — prove the MM-CAD contamination scan can FAIL
before believing that it passed.

WHY
---
The MM-CAD:A scan returns `0 contaminated` on all three splits. A zero that
arrives that cleanly is exactly the shape of a broken harness: an over-sensitive
writer feeding a guard that never looked, a wrong path silently scanning nothing,
a rule keyed on a field the rows do not carry. `0 differences` has already meant
`one binary compared to itself` on this project once.

So this builds a corpus of REAL MM-CAD rows with one identity token swapped for
something the guard MUST reject, one planted row per rule:

  R1  a banned collection path written into the user text
  R3  an eval part's exact measured envelope stated in the user prompt
  R4  a banned collection named in prose
  R6  the `source_id` replaced by an ACTIVE holdout stem (canonical-42, famgap
      heldout_B, and a MUSE task stem — three different registry rows)
  R8  the user prompt replaced verbatim by a `holdout_enlarged_600` task prompt
      — the 600-row split this triage is chiefly asked about, and the one whose
      identity rests on prompt text alone because its rows carry no stem

Every planted row must be caught. If any survives, the clean result on the real
splits means nothing and must not be reported.

Usage:
  python3 scripts/mmcad_scan_positive_control.py \
      --real <mmcad>/scan/mmcad_a_val.jsonl --out <mmcad>/scan/positive_control.jsonl
  python3 scripts/contamination_guard.py --scan <mmcad>/scan/positive_control.jsonl
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys

MODELS_REPO = "/Users/account_clawteam1/archdisc-Models"


def _user(row):
    for m in row["messages"]:
        if m["role"] == "user":
            return m
    raise KeyError("no user turn")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--real", required=True, help="a clean mmcad_a_*.jsonl to draw carrier rows from")
    ap.add_argument("--out", required=True)
    ap.add_argument("--models-repo", default=MODELS_REPO)
    ap.add_argument("--holdout", default="data/forge/holdout_enlarged_600.jsonl")
    a = ap.parse_args()

    sys.path.insert(0, os.path.join(a.models_repo, "scripts"))
    import contamination_guard as G  # noqa: E402

    idx = G.active_stem_index(verbose=False)
    db = G.load_db()
    envelopes = db.get("envelopes") or {}

    def stem_of(split):
        for s, sp in sorted(idx.items()):
            if sp == split:
                return s
        raise KeyError(split)

    carriers = []
    with open(a.real) as fh:
        for line in fh:
            carriers.append(json.loads(line))
            if len(carriers) >= 8:
                break

    ho_path = os.path.join(a.models_repo, a.holdout)
    with open(ho_path) as fh:
        ho = json.loads(fh.readline())

    eval_tid = sorted(envelopes)[0]
    ex, ey, ez = envelopes[eval_tid]

    planted = []

    def plant(rule, mutate):
        row = copy.deepcopy(carriers[len(planted) % len(carriers)])
        mutate(row)
        row["_control"] = rule
        planted.append(row)

    plant("R1 banned path in text",
          lambda r: _user(r).__setitem__(
              "content",
              _user(r)["content"] + "\nreference: data/cadgenbench-data/101/drawing.png"))

    plant("R3 eval envelope stated",
          lambda r: _user(r).__setitem__(
              "content",
              f"Overall envelope {ex} x {ey} x {ez} mm.\n" + _user(r)["content"]))

    plant("R4 banned collection named in prose",
          lambda r: _user(r).__setitem__(
              "content",
              _user(r)["content"] + "\nDerived from the cadgenbench_submissions corpus."))

    for split in ("benchcad_canonical_42", "famgap_heldout_B", "bench_tasks_muse"):
        st = stem_of(split)

        def mutate(r, st=st):
            r["stem"] = st
            r["source"] = f"mmcad/planted/{st}"
            u = _user(r)
            u["content"] = f"source_id {st}\n" + u["content"]
        plant(f"R6 ACTIVE stem of {split} ({st})", mutate)

    def mutate_r8(r):
        _user(r)["content"] = ho["user"]
    plant(f"R8 verbatim holdout_enlarged_600 prompt (id={ho.get('id')})", mutate_r8)

    with open(a.out, "w") as fh:
        for r in planted:
            fh.write(json.dumps(r) + "\n")

    print(f"planted {len(planted)} rows -> {a.out}")
    for r in planted:
        print(f"  {r['_control']}")
    print("\nEVERY row above must be reported CONTAMINATED. Any survivor invalidates "
          "the clean result on the real splits.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
