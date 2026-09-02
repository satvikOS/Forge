#!/usr/bin/env python3
"""mmcad_to_scan_jsonl.py — render MM-CAD:A `metadata.csv` into the strict training
row schema so `contamination_guard.py --scan` can be run on it BEFORE anything is
ingested.

WHY THIS EXISTS, AND WHY IT IS DELIBERATELY OVER-SENSITIVE
-----------------------------------------------------------------------------
MM-CAD:A unifies eleven benchmarks, and three of them — DeepCAD, Fusion360 Gallery
and CADParser — are sources our own splits draw from. A holdout created AFTER a
corpus retro-contaminates it, so the scan has to run on the VENDOR metadata, not on
some later derived corpus where the provenance has already been dropped.

The guard keys identity on `image`, `id`, `source`, `stem` and the message texts.
MM-CAD renumbers every model under its OWN global `uid` (1..33,816), and that uid
matches nothing of ours by construction. The token that CAN collide is `source_id`
— the model's original id inside its source benchmark (`00032135` for DeepCAD,
`21646_a2dd0d00_0035` for Fusion360). So this writer puts the provenance in EVERY
field the guard reads, and puts the caption in both the user and the assistant turn:

    image      the vendor render path for this uid
    id         <benchmark>_<source_id>          (>= 8 chars, so R6 indexes it)
    source     mmcad/<benchmark>/<source_id>
    stem       <source_id>
    user       provenance line + every asset path + category + BOTH captions
    assistant  the caption (MM-CAD:A ships no feature tree; the caption is the
               only answer-shaped field it has)

That is not what a real training row would look like — a real one would carry
FEWER identity tokens, not more. The asymmetry is the point: an over-sensitive
scan can only produce false POSITIVES, which are cheap to read; an under-sensitive
one produces a silent false clean, which is the failure this file exists to
prevent.

Usage:
  python3 scripts/mmcad_to_scan_jsonl.py \
      --csv <mmcad>/metadata.csv --out-dir <mmcad>/scan --by-split
  python3 scripts/contamination_guard.py --scan <mmcad>/scan/mmcad_a_*.jsonl
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys

csv.field_size_limit(10 * 1024 * 1024)

ASSET_COLS = (
    "mesh", "point_cloud", "render_top", "render_iso1", "render_iso2",
    "sketch_contour_iso1", "sketch_contour_iso2", "sketch_canny",
    "sketch_lnd_iso1", "sketch_lnd_iso2", "sketch_lnd_top",
    "sketch_traced_iso1", "sketch_traced_iso2", "sketch_traced_top",
    "mesh_archive", "point_cloud_archive",
)

SYSTEM = (
    "You are Archie, a frontier mechanical-CAD engineer. Describe the part shown and "
    "emit its construction feature tree."
)


def row_to_scanrow(r: dict) -> dict:
    bench = (r.get("benchmark") or "").strip()
    src = (r.get("source_id") or "").strip()
    uid = (r.get("uid") or "").strip()
    assets = [(r.get(c) or "").strip() for c in ASSET_COLS]
    assets = [a for a in assets if a]

    caption = " ".join(
        x for x in (
            (r.get("title") or "").strip(),
            (r.get("description") or "").strip(),
        ) if x
    )
    caption_alt = " ".join(
        x for x in (
            (r.get("title_gemini") or "").strip(),
            (r.get("description_gemini") or "").strip(),
            (r.get("title_human") or "").strip(),
            (r.get("description_human") or "").strip(),
        ) if x
    )

    user = (
        f"MM-CAD uid {uid} | benchmark {bench} | source_id {src} | "
        f"category {(r.get('category') or '').strip()}\n"
        + "\n".join(assets) + "\n"
        + caption + "\n" + caption_alt
    )
    return {
        "image": (r.get("render_iso1") or "").strip() or None,
        "id": f"{bench}_{src}",
        "source": f"mmcad/{bench}/{src}",
        "stem": src,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user},
            {"role": "assistant", "content": caption or caption_alt},
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--by-split", action="store_true",
                    help="write one file per MM-CAD split (train/val/test) — the "
                         "scan must be reported per split, never pooled")
    a = ap.parse_args()

    os.makedirs(a.out_dir, exist_ok=True)
    handles: dict = {}
    counts: dict = {}
    try:
        with open(a.csv, newline="") as fh:
            for r in csv.DictReader(fh):
                split = (r.get("split") or "unknown").strip() if a.by_split else "all"
                if split not in handles:
                    handles[split] = open(
                        os.path.join(a.out_dir, f"mmcad_a_{split}.jsonl"), "w")
                    counts[split] = 0
                handles[split].write(json.dumps(row_to_scanrow(r)) + "\n")
                counts[split] += 1
    finally:
        for h in handles.values():
            h.close()

    for k in sorted(counts):
        print(f"{counts[k]:>7} rows -> "
              f"{os.path.join(a.out_dir, f'mmcad_a_{k}.jsonl')}")
    print(f"{sum(counts.values()):>7} rows TOTAL")
    return 0


if __name__ == "__main__":
    sys.exit(main())
