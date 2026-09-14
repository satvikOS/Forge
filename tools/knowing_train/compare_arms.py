#!/usr/bin/env python3
"""Read three composite_score.py JSONs as ONE comparison, per family, with an interval.

WHAT THIS REFUSES TO DO, and why each refusal was paid for:

  * It will not compare a mean over one row set with a mean over another. Every
    comparative number below is computed on the PAIRED intersection — the rows every
    arm scored — and the unpaired means are printed separately, labelled, with their n.
    A floor quoted without its n has already produced one wrong conclusion here: a
    re-pin moved coverage 34 -> 19 of 41 while the value moved 0.4310 -> 0.4281.

  * It will not compare arms measured by different kernels. Every input's provenance
    sha is read and printed; a mismatch is a hard stop, because a composite is only
    comparable within one binary.

  * It will not report a difference without a cluster interval. The unit of
    independence is the FAMILY, not the row: three ball_knobs are one draw of a
    difficulty, not three. The bootstrap below resamples FAMILIES with replacement.
    On the sibling 8-family holdout that correction is 6.1x the naive SE.

Usage:
    compare_arms.py --floor F.json --arm NAME=A.json [--arm NAME=B.json ...]
                    --tasks bench_tasks.jsonl [--json-out out.json]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import statistics
import sys


def load_arm(path):
    d = json.load(open(path))
    prov = d.get("provenance") or {}
    rows = {}
    for r in d.get("records") or []:
        c = r.get("composite")
        if isinstance(c, (int, float)):
            rows[r["task_id"]] = r
    return {
        "path": path,
        "label": d.get("label", os.path.basename(path)),
        "verifier": (prov.get("verifier_sha256") or "")[:12],
        "kernel": (prov.get("kernel_dylib_sha256") or "")[:12],
        "scored": d.get("scored"),
        "refused": d.get("refused"),
        "vacuous": d.get("vacuous"),
        "rows": rows,
        "n_records": len(d.get("records") or []),
    }


def mean(xs):
    return sum(xs) / len(xs) if xs else float("nan")


def cluster_bootstrap(deltas_by_family, n=20000, seed=20260914):
    """95% CI for the mean delta, resampling FAMILIES with replacement.

    Each family contributes the mean of its own rows, so a family with three rows does
    not count as three independent draws.
    """
    fams = sorted(deltas_by_family)
    if len(fams) < 2:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    means = []
    for _ in range(n):
        pick = [deltas_by_family[fams[rng.randrange(len(fams))]] for _ in fams]
        flat = [mean(p) for p in pick]
        means.append(mean(flat))
    means.sort()
    return means[int(0.025 * n)], means[int(0.975 * n)]


def cluster_se(deltas_by_family):
    fam_means = [mean(v) for v in deltas_by_family.values()]
    if len(fam_means) < 2:
        return float("nan")
    return statistics.stdev(fam_means) / (len(fam_means) ** 0.5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--floor", required=True)
    ap.add_argument("--arm", action="append", required=True,
                    help="NAME=path.json, repeatable")
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--json-out", default=None)
    ap.add_argument("--allow-pin-mismatch", action="store_true")
    args = ap.parse_args()

    fam = {}
    for line in open(args.tasks):
        line = line.strip()
        if line:
            r = json.loads(line)
            fam[r["id"]] = (r.get("meta") or {}).get("family") or "?"
    all_ids = list(fam)

    floor = load_arm(args.floor)
    arms = {}
    for spec in args.arm:
        name, _, path = spec.partition("=")
        arms[name] = load_arm(path)

    print("=" * 84)
    print("INPUTS — provenance first, because a composite is only comparable within one binary")
    print("=" * 84)
    everything = [("FLOOR", floor)] + list(arms.items())
    pins = set()
    for name, a in everything:
        print(f"  {name:<22} verifier {a['verifier']}  kernel {a['kernel']}  "
              f"scored {a['scored']}/{a['n_records']}  ({os.path.basename(a['path'])})")
        pins.add((a["verifier"], a["kernel"]))
    if len(pins) != 1:
        print("\n  !! THESE ARMS WERE MEASURED BY DIFFERENT BINARIES:", pins)
        if not args.allow_pin_mismatch:
            raise SystemExit("refusing to compare across pins (pass --allow-pin-mismatch "
                             "only to print an explicitly-labelled incomparable table)")

    # ---- unpaired, each on its own rows, WITH ITS n ------------------------- #
    print()
    print("=" * 84)
    print(f"UNPAIRED means — each arm over ITS OWN scored rows, of {len(all_ids)} benchmark rows")
    print("=" * 84)
    unpaired = {}
    for name, a in everything:
        vals = [r["composite"] for r in a["rows"].values()]
        unpaired[name] = {"n": len(vals), "mean": mean(vals)}
        print(f"  {name:<22} {mean(vals):.4f}   n = {len(vals)}")

    # ---- paired ------------------------------------------------------------- #
    common = set(floor["rows"])
    for a in arms.values():
        common &= set(a["rows"])
    common = sorted(common)
    print()
    print("=" * 84)
    print(f"PAIRED — the {len(common)} row(s) EVERY arm scored")
    print("=" * 84)
    paired = {}
    for name, a in everything:
        vals = [a["rows"][i]["composite"] for i in common]
        paired[name] = mean(vals)
        print(f"  {name:<22} {mean(vals):.4f}")

    fams_present = sorted({fam[i] for i in common})
    print(f"\n  clusters (families) in the paired set: {len(fams_present)} — {fams_present}")

    out = {"tasks": args.tasks, "benchmark_rows": len(all_ids),
           "paired_ids": common, "paired_families": fams_present,
           "unpaired": unpaired, "paired": paired, "deltas": {}, "per_family": {}}

    # ---- deltas vs floor, with a family-clustered interval ------------------- #
    print()
    print("=" * 84)
    print("DELTA vs FLOOR, paired, 95% CI bootstrapped over FAMILIES (not rows)")
    print("=" * 84)
    for name, a in arms.items():
        by_fam = {}
        for i in common:
            by_fam.setdefault(fam[i], []).append(
                a["rows"][i]["composite"] - floor["rows"][i]["composite"])
        d = mean([x for v in by_fam.values() for x in v])
        lo, hi = cluster_bootstrap(by_fam)
        se = cluster_se(by_fam)
        wins = sum(1 for i in common
                   if a["rows"][i]["composite"] > floor["rows"][i]["composite"])
        excl = "EXCLUDES 0" if (lo > 0 or hi < 0) else "spans 0"
        print(f"  {name:<22} {d:+.4f}   95% CI [{lo:+.4f}, {hi:+.4f}]  {excl}")
        print(f"  {'':<22} family-clustered SE {se:.4f};  beats the floor on "
              f"{wins}/{len(common)} paired rows")
        out["deltas"][name] = {"delta_vs_floor": d, "ci95": [lo, hi],
                               "cluster_se": se, "rows_beating_floor": wins,
                               "paired_n": len(common)}

    # ---- arm vs arm ---------------------------------------------------------- #
    names = list(arms)
    if len(names) >= 2:
        print()
        print("=" * 84)
        print("ARM vs ARM, paired, same interval")
        print("=" * 84)
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                a, b = arms[names[i]], arms[names[j]]
                by_fam = {}
                for t in common:
                    by_fam.setdefault(fam[t], []).append(
                        a["rows"][t]["composite"] - b["rows"][t]["composite"])
                d = mean([x for v in by_fam.values() for x in v])
                lo, hi = cluster_bootstrap(by_fam)
                excl = "EXCLUDES 0" if (lo > 0 or hi < 0) else "spans 0"
                print(f"  {names[i]} - {names[j]}: {d:+.4f}  95% CI [{lo:+.4f}, {hi:+.4f}]  {excl}")
                out["deltas"][f"{names[i]}_minus_{names[j]}"] = {
                    "delta": d, "ci95": [lo, hi]}

    # ---- per family ---------------------------------------------------------- #
    print()
    print("=" * 84)
    print("PER FAMILY, paired rows only")
    print("=" * 84)
    hdr = f"  {'family':<24}{'n':>3}  {'FLOOR':>8}"
    for name in arms:
        hdr += f"  {name:>14}"
    hdr += f"  {'best-arm - floor':>18}"
    print(hdr)
    for f in fams_present:
        ids = [i for i in common if fam[i] == f]
        line = f"  {f:<24}{len(ids):>3}  {mean([floor['rows'][i]['composite'] for i in ids]):>8.4f}"
        per = {}
        for name, a in arms.items():
            m = mean([a["rows"][i]["composite"] for i in ids])
            per[name] = m
            line += f"  {m:>14.4f}"
        best = max(per.values()) if per else float("nan")
        line += f"  {best - mean([floor['rows'][i]['composite'] for i in ids]):>+18.4f}"
        print(line)
        out["per_family"][f] = {
            "n": len(ids),
            "floor": mean([floor["rows"][i]["composite"] for i in ids]),
            **{k: v for k, v in per.items()}}

    # ---- components ---------------------------------------------------------- #
    print()
    print("=" * 84)
    print("COMPONENTS, paired (shape .4 / interface .4 / topology .2)")
    print("=" * 84)
    for comp in ("shape", "interface", "topology"):
        line = f"  {comp:<12} floor {mean([floor['rows'][i].get(comp) or 0 for i in common]):.4f}"
        for name, a in arms.items():
            line += f"   {name} {mean([a['rows'][i].get(comp) or 0 for i in common]):.4f}"
        print(line)
        out.setdefault("components", {})[comp] = {
            "floor": mean([floor["rows"][i].get(comp) or 0 for i in common]),
            **{name: mean([a["rows"][i].get(comp) or 0 for i in common])
               for name, a in arms.items()}}

    # ---- rows nobody scored --------------------------------------------------- #
    unscored = {}
    for name, a in everything:
        unscored[name] = sorted(set(all_ids) - set(a["rows"]))
    print()
    print("=" * 84)
    print("ROWS NOT SCORED (a benchmark row missing from a table is not a zero)")
    print("=" * 84)
    for name, miss in unscored.items():
        print(f"  {name:<22} {len(miss)} unscored")
    out["unscored"] = {k: len(v) for k, v in unscored.items()}
    out["unscored_ids"] = unscored

    if args.json_out:
        with open(args.json_out, "w") as fh:
            json.dump(out, fh, indent=1)
        print("\nwrote", args.json_out)


if __name__ == "__main__":
    main()
