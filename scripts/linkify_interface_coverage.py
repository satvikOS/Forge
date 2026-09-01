#!/usr/bin/env python3
"""linkify_interface_coverage.py — does Linkify's interface data decompose into the
primitives our interface metric actually scores?

THE QUESTION
------------
Interface is 0.4 of the CADGenBench composite. archdisc-Models/scripts/interface_metrics.py
scores six families, and it reads a face census with exactly three `kind` predicates:

    line 465   if f.get("kind") != "cylinder": continue      # bore / shaft_land walls
    line 587   if f.get("kind") != "plane":    continue      # counterbore annular floor
    line 704   if f.get("kind") != "plane":    continue      # mating_face

Measured over our own four benchmark surveys (reports/interface/survey_*.json,
1,773 reference parts): 7,554 interface features, all six families, every one of them
built out of cylinder and plane faces. So "does Linkify's contact geometry decompose
into the same primitives?" is the question that decides whether Linkify is worth
anything to 40% of the score.

THE ANSWER IS SPLIT, AND THE SPLIT IS THE POINT
-----------------------------------------------
Linkify ships two different things in one archive, and they answer oppositely.

1. `contacts` — what the Linkify PAPER is about, and what it CORRECTED. Measured on
   2,169 real contact records from 166 assemblies, 2,147 have the identical signature
   below and the other 22 are the same record minus both scalars:

       {entity_one:{body,occurrence}, entity_two:{body,occurrence},
        contact_area, contact_volume, id}

   Body-pair + two scalars. NO surface_type, NO BRepFace, NO index, NO normal, NO axis.
   The geometry lives beside it as an opaque point cloud, contact/contact_<id>.ply.
   This does NOT decompose into cylinder/plane. It cannot drive interface_metrics.py.

   Worse, it is a REGRESSION on face-kind for our purposes: the ORIGINAL Fusion 360
   Gallery contact record carries
       entity_one: {type:"BRepFace", surface_type:"CylinderSurfaceType", index:6, ...}
   and Linkify's README instructs you to "copy (and overwrite) this data into the
   original dataset". That overwrite REPLACES typed per-face contacts with untyped
   body-pair contacts. Linkify buys contact CORRECTNESS and point clouds at the cost
   of the surface_type our metric keys on.

2. `holes` — inherited UNCHANGED from the original Fusion 360 Gallery assembly.json
   (confirmed against AutodeskAILab/Fusion360GalleryDataset docs/assembly.md; Linkify
   did not add it). This one IS parametric and maps almost 1:1 onto our `bore`:

       {type, body, diameter, length,
        origin:{x,y,z},              -> our axisAt / foot-of-axis
        direction:{x,y,z},           -> our axis
        faces:[{surface_type, point_on_entity, bounding_box, index}],
        edges:[{curve_type, ...}]}

   Measured surface_type over 1,976 hole faces from 1,445 holes: CylinderSurfaceType
   1501 (76.0%), ConeSurfaceType 293 (14.8%), PlaneSurfaceType 181 (9.2%),
   SphereSurfaceType 1 — so 85.1% are a primitive we score. The 14.8% cone is the
   countersink seat, which our metric does not model: a countersunk fastener lands on
   a CONE, and interface_metrics.py's counterbore path looks for an annular PLANE
   (line 587). Countersinks are the one real interface family Fusion records and we
   do not.

WHAT THIS SCRIPT DOES
---------------------
Maps Linkify hole records onto our six families and reports the fraction of our own
7,554-feature census that such data could express — separating what holes give you
DIRECTLY from what must still be derived, and from what is simply absent.

Run it against a slice produced by scripts/linkify_metadata_slice.sh.

  scripts/linkify_interface_coverage.py --slice DIR [--census PATH_TO_reports/interface]
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import sys

# Linkify/Fusion hole `type` -> the family interface_metrics.py would record.
# A counterbore in our metric is a bore whose wall carries >1 radius on one axis, so
# the Fusion counterbore/countersink types are a strict refinement of our `bore`.
HOLE_TYPE_TO_FAMILY = {
    "RoundHoleWithThroughBottom":            "bore",
    "RoundHoleWithBlindBottom":              "bore",
    "RoundBlindHoleWithConicalBottom":       "bore",
    "CounterboreThroughHole":                "counterbore",
    "CounterboreBlindHole":                  "counterbore",
    "CountersunkHoleWithThroughBottom":      "counterbore",   # cone seat, not annular
    "CountersunkBlindHoleWithConicalBottom": "counterbore",
    "CountersunkHoleWithBlindBottom":         "counterbore",
    "CounterboreBlindHoleWithConicalBottom":  "counterbore",
    "RoundBlindHoleWithSphericalBottom":      "bore",
}

# What a hole record can and cannot supply, per family, for interface_metrics.py.
#   direct    : the family is recoverable from the hole record alone
#   derived   : recoverable by GROUPING hole records (>=3 coaxial, equal diameter)
#   absent    : no hole record expresses it — needs the B-rep face census
FAMILY_AVAILABILITY = {
    "bore":         "direct",
    "counterbore":  "direct",
    "bolt_circle":  "derived",
    "bolt_pattern": "derived",
    "shaft_land":   "absent",   # EXTERNAL cylinder; `holes` are voids only
    "mating_face":  "absent",   # planar seat; no planar-face record in `holes`
}


def load_our_census(census_dir):
    """Our own measured family counts, from reports/interface/survey_*.json."""
    fam = collections.Counter()
    rows = feats = 0
    files = sorted(glob.glob(os.path.join(census_dir, "survey_*.json")))
    for p in files:
        s = json.load(open(p))["summary"]
        rows += s["rows"]
        feats += s["features_total"]
        for k, v in s["families"].items():
            fam[k] += v
    return fam, rows, feats, files


def scan_slice(slice_dir):
    ht = collections.Counter()
    st = collections.Counter()
    ct = collections.Counter()
    contact_sigs = collections.Counter()
    n_asm = n_holes = n_contacts = 0
    complete = 0
    for f in glob.glob(os.path.join(slice_dir, "**", "assembly.json"), recursive=True):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        n_asm += 1
        for h in (d.get("holes") or []):
            n_holes += 1
            ht[h.get("type")] += 1
            for fa in (h.get("faces") or []):
                st[fa.get("surface_type")] += 1
            for e in (h.get("edges") or []):
                ct[e.get("curve_type")] += 1
            # the tuple interface_metrics.py needs for a bore
            if (h.get("diameter") is not None and h.get("length") is not None
                    and h.get("origin") and h.get("direction")):
                complete += 1
        for c in (d.get("contacts") or []):
            n_contacts += 1
            contact_sigs[tuple(sorted(c.keys()))] += 1
    return ht, st, ct, contact_sigs, n_asm, n_holes, n_contacts, complete


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", required=True, help="dir of extracted assembly.json")
    ap.add_argument("--census", default="/Users/account_clawteam1/archdisc-Models/reports/interface")
    a = ap.parse_args()

    ht, st, ct, csig, n_asm, n_holes, n_contacts, complete = scan_slice(a.slice)
    if not n_asm:
        print("no assembly.json under %s" % a.slice, file=sys.stderr)
        return 1

    print("=" * 74)
    print("LINKIFY SLICE  (%d assemblies)" % n_asm)
    print("=" * 74)
    print("holes: %d   contacts: %d" % (n_holes, n_contacts))

    print("\n-- contact record key-signatures (the thing Linkify CORRECTED) --")
    for k, v in csig.most_common():
        print("  %6d  %s" % (v, list(k)))
    typed = any("surface_type" in str(k) for k in csig)
    print("  => carries surface_type: %s" % ("YES" if typed else "NO — body-pair + scalars only"))

    print("\n-- hole type vocabulary -> our family --")
    for k, v in ht.most_common():
        print("  %6d  %-40s -> %s" % (v, k, HOLE_TYPE_TO_FAMILY.get(k, "UNMAPPED")))

    print("\n-- surface_type on hole faces (our metric scores cylinder + plane) --")
    tot_st = sum(st.values()) or 1
    scored = st.get("CylinderSurfaceType", 0) + st.get("PlaneSurfaceType", 0)
    for k, v in st.most_common():
        mark = "  <- scored" if k in ("CylinderSurfaceType", "PlaneSurfaceType") else ""
        print("  %6d  %-28s %5.1f%%%s" % (v, k, 100.0 * v / tot_st, mark))
    print("  => %d/%d = %.1f%% of hole faces are a primitive our metric scores"
          % (scored, tot_st, 100.0 * scored / tot_st))

    print("\n-- parametric completeness --")
    print("  %d/%d holes carry the full (diameter, length, origin, direction) tuple = %.1f%%"
          % (complete, n_holes, 100.0 * complete / max(n_holes, 1)))

    fam, rows, feats, files = load_our_census(a.census)
    if not feats:
        print("\n(no census found at %s — skipping coverage)" % a.census)
        return 0

    print("\n" + "=" * 74)
    print("COVERAGE AGAINST OUR OWN CENSUS  (%d parts, %d features, %d surveys)"
          % (rows, feats, len(files)))
    print("=" * 74)
    buckets = collections.Counter()
    for f, n in fam.most_common():
        av = FAMILY_AVAILABILITY.get(f, "absent")
        buckets[av] += n
        print("  %-14s %6d  %5.1f%%   %s" % (f, n, 100.0 * n / feats, av))
    print("  " + "-" * 52)
    for b in ("direct", "derived", "absent"):
        print("  %-14s %6d  %5.1f%%" % (b, buckets[b], 100.0 * buckets[b] / feats))
    print("\n  => holes express %.1f%% of our interface features directly,"
          % (100.0 * buckets["direct"] / feats))
    print("     %.1f%% more by grouping coaxial equal-diameter holes,"
          % (100.0 * buckets["derived"] / feats))
    print("     and %.1f%% (shaft_land + mating_face) not at all — those are EXTERNAL"
          % (100.0 * buckets["absent"] / feats))
    print("     cylinders and planar seats, which no hole record describes.")
    print("\n  LAW 6 still binds: interface_metrics.py measures a BUILT solid. Hole")
    print("  records are a model's own annotation, not a census. To SCORE with them")
    print("  you would build from the referenced .step/.smt (which live in the")
    print("  ORIGINAL Fusion 360 Gallery Assembly download, NOT in Linkify's archive)")
    print("  and let our kernel produce the census. Linkify's holes are TRAINING")
    print("  supervision, not a scoring path.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
