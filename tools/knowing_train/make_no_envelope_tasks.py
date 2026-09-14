#!/usr/bin/env python3
"""Build the ENVELOPE-STRIPPED arm of BenchCAD-holdout-41.

THE QUESTION. The benchmark prompt ends with

    Take absolute size from the measured envelope below and proportion every feature to it.

    Measured: overall envelope about 22.14 x 22.14 x 64.22 mm.

so it HANDS OVER the true three-axis envelope in text. `knowing_v1` never does: its
image-bearing families state one scalar ("longest overall dimension 100 mm", or "exactly
40 mm" for `rescale`) and the model has to derive the other two extents from the picture.
Its envelope-bearing families (`spec_tree`, `synth_spec_tree`) carry no image at all.
So the eval pairing — image PLUS three-axis envelope — appears in no training family.

That gap can cut either way and the direction is measurable, not arguable:

  * same score with and without  -> the model is reading the envelope off the image and
                                    the free gift is inert. The framing gap is harmless.
  * better WITH the envelope     -> it is using the gift. Then astra-v1's failure mode
                                    (envelope exact 41/41, features nowhere) is the risk
                                    to watch, not the framing gap.
  * worse WITH the envelope      -> the unfamiliar text is displacing the image evidence,
                                    and THEN the framing gap is a real defect worth
                                    fixing in the corpus.

WHAT IS AND IS NOT REMOVED. Only the two sentences that carry absolute size: the
"Take absolute size from the measured envelope below…" instruction and the "Measured:
overall envelope …" line. The render description, the warnings about hidden edges, and
the reconstruction instruction are untouched, and `gt`, `gt_step`, `image`, `id` and
`meta` are copied verbatim — the REFERENCE is identical, so both arms are scored against
the same geometry by the same kernel. Removing size information can only make the task
harder; nothing here can leak an answer.

A replacement sentence is substituted so the prompt does not simply trail off into a task
with no stated scale at all, which would be a third condition rather than an ablation:
the model is told the scale convention `knowing_v1` trained it on.
"""
from __future__ import annotations

import argparse
import json
import re
import sys

TAKE_ABS = re.compile(
    r"\n?Take absolute size from the measured envelope below[^\n]*\n?", re.I)
MEASURED = re.compile(r"\n?Measured:\s*overall envelope[^\n]*\n?", re.I)

REPLACEMENT = ("Take the part's proportions from the renders. The part is normalised so "
               "its longest overall dimension measures 100 mm.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", choices=["strip", "rescale-framing"], default="strip",
                    help="strip: remove the size sentences and say nothing about scale. "
                         "rescale-framing: remove them and state knowing_v1's own "
                         "longest-axis convention instead.")
    args = ap.parse_args()

    n = stripped = 0
    with open(args.out, "w") as out:
        for line in open(args.tasks):
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            n += 1
            u = r.get("user") or ""
            before = u
            u = TAKE_ABS.sub("\n", u)
            u = MEASURED.sub("\n", u)
            if u != before:
                stripped += 1
            else:
                print(f"[warn] {r.get('id')}: no envelope sentence found to remove",
                      file=sys.stderr)
            u = re.sub(r"\n{3,}", "\n\n", u).strip()
            if args.mode == "rescale-framing":
                u = u + "\n\n" + REPLACEMENT
            r["user"] = u
            out.write(json.dumps(r) + "\n")

    print(f"{n} rows -> {args.out}; envelope sentences removed from {stripped}")
    if stripped != n:
        raise SystemExit(
            f"only {stripped} of {n} rows changed. An ablation that did not fire on every "
            f"row is not an ablation — the arms would differ on some rows and be identical "
            f"on others, which is unreadable. Refusing to write a half-applied arm.")


if __name__ == "__main__":
    main()
