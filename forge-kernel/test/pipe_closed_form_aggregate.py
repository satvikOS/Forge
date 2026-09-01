#!/usr/bin/env python3
"""pipe_closed_form_aggregate.py — turn a pipe_closed_form_probe JSONL into the
table that says what the TKOffset family E/F flip gate is actually comparing.

    usage: pipe_closed_form_aggregate.py <probe.jsonl> [corpus_ab_results.jsonl]

With the second argument it JOINS the coverage A/B's own rows on `part`, so the
native arm's volume is scored against the same two closed forms without either
engine being re-run. That join is what makes the comparison paired: every number
below is on the SAME part with the SAME profile face and the SAME spine.

TOLERANCE. 1e-6 relative, matching the engine's own `gen_volume_oracle` gate
(NativeLoftPipe.cpp:1570). It is not tuned to produce a verdict; a sweep of the
threshold is printed so the reader can see the result is not an artefact of the
cut, which is the only honest way to present a thresholded count.

A VOLUME IS NOT A PROOF OF GEOMETRY. Volume is used here to test a SPECIFIC
hypothesis — which of two named closed forms an engine's answer obeys — and the
two forms differ by 6.7%, three orders above any tolerance in play. It is not
used to certify that a shape is correct, and this script never says a shape is
right. Where the A/B rows are joined, the face/edge/shell/solid counts and the
centre of mass are carried through so the reader can see the topology as well.
"""
import json
import math
import sys
from collections import Counter


def load(path):
    rows = []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                rows.append({"error": "unparseable_line"})
    return rows


def pct(n, d):
    return "n/a" if not d else f"{100.0 * n / d:.1f}%"


def quantiles(xs):
    if not xs:
        return (float("nan"),) * 3
    s = sorted(xs)
    return (s[0], s[len(s) // 2], s[-1])


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    probe = load(sys.argv[1])
    ab = load(sys.argv[2]) if len(sys.argv) > 2 else []

    # ── the A/B join: part -> native/occt arm for families E and F ──────────
    nat = {}
    occ = {}
    for r in ab:
        fam = r.get("family")
        if fam not in ("PIPE", "PIPESHELL"):
            continue
        p = r.get("part")
        if p is None:
            continue
        nat.setdefault(fam, {})[p] = r.get("native", {})
        occ.setdefault(fam, {})[p] = r.get("occt", {})

    errors = [r for r in probe if "error" in r]
    na = [r for r in probe if r.get("applicable") is False]
    rows = [r for r in probe if r.get("applicable") is True]

    out = []
    A = out.append
    A("# Is OCCT an ORACLE for TKOffset families E and F, or only a participant?")
    A("")
    A(f"probe rows: {len(probe)}  ·  applicable: {len(rows)}  ·  "
      f"not applicable: {len(na)}  ·  errors: {len(errors)}")
    if errors:
        A("")
        A("errors: " + ", ".join(sorted(Counter(
            r.get("error", "?") for r in errors).elements()))[:400])
    if not rows:
        A("")
        A("NO APPLICABLE ROWS — nothing can be concluded.")
        print("\n".join(out))
        return 1

    TOL = 1e-6
    fold_free = [r for r in rows if r.get("fold_free")]
    folding = [r for r in rows if not r.get("fold_free")]

    A("")
    A("## Where the closed form applies at all")
    A("")
    A("A mitred sweep whose section is wide compared with the leg length folds")
    A("through itself at the bend, and then encloses strictly LESS than")
    A("area*length. Those parts are excluded by evidence, not by taste.")
    A("")
    A(f"| fold-free (oracle applies) | {len(fold_free)} | {pct(len(fold_free), len(rows))} |")
    A("|---|---:|---:|")
    A(f"| folds at the bend (oracle does not apply) | {len(folding)} | "
      f"{pct(len(folding), len(rows))} |")

    def score(rs, key):
        good = [r for r in rs if 0.0 <= r.get(key, -1.0) <= TOL]
        return len(good)

    A("")
    A("## What OCCT's own answer obeys, on the fold-free parts")
    A("")
    A("Two named closed forms, on the SAME parts. They differ by 6.7% at this")
    A("turn angle, so no tolerance in play can confuse them.")
    A("")
    A("| OCCT MakePipe volume fits ... | parts | of fold-free |")
    A("|---|---:|---:|")
    n_ff = len(fold_free)
    n_cf = score(fold_free, "occt_rel_closed_form")
    n_tf = score(fold_free, "occt_rel_transformed")
    n_fl = score(fold_free, "occt_rel_first_leg")
    A(f"| the MITRE closed form  A*(L1+L2) | {n_cf} | {pct(n_cf, n_ff)} |")
    A(f"| the TRANSFORMED form  A*(L1+L2*cos30) | {n_tf} | {pct(n_tf, n_ff)} |")
    A(f"| FIRST LEG ONLY  A*L1 | {n_fl} | {pct(n_fl, n_ff)} |")
    A(f"| none of the three | {n_ff - n_cf - n_tf - n_fl} | "
      f"{pct(n_ff - n_cf - n_tf - n_fl, n_ff)} |")

    valid = Counter(r.get("occt_valid") for r in fold_free)
    A("")
    A(f"OCCT BRepCheck_Analyzer over the same parts: "
      f"valid={valid.get(1, 0)}  invalid={valid.get(0, 0)}  "
      f"no-shape/threw={valid.get(-1, 0)}")

    A("")
    A("### The threshold is not doing the work")
    A("")
    A("| rel tolerance | fits MITRE | fits TRANSFORMED |")
    A("|---|---:|---:|")
    for t in (1e-9, 1e-7, 1e-6, 1e-4, 1e-2):
        c = sum(1 for r in fold_free if 0.0 <= r.get("occt_rel_closed_form", -1.0) <= t)
        d = sum(1 for r in fold_free if 0.0 <= r.get("occt_rel_transformed", -1.0) <= t)
        A(f"| {t:.0e} | {c} | {d} |")

    lo, mid, hi = quantiles([r["occt_rel_transformed"] for r in fold_free
                             if r.get("occt_rel_transformed", -1.0) >= 0.0])
    A("")
    A(f"OCCT residual against the TRANSFORMED form, fold-free parts: "
      f"min {lo:.3e} · median {mid:.3e} · max {hi:.3e}")
    lo, mid, hi = quantiles([r["occt_rel_closed_form"] for r in fold_free
                             if r.get("occt_rel_closed_form", -1.0) >= 0.0])
    A(f"OCCT residual against the MITRE     form, fold-free parts: "
      f"min {lo:.3e} · median {mid:.3e} · max {hi:.3e}")

    # ── the paired join, if we were given the A/B rows ──────────────────────
    if nat:
        A("")
        A("## The native arm, on the same parts (joined from the coverage A/B)")
        A("")
        A("Neither engine is re-run here; these are the A/B's own recorded")
        A("volumes, scored against the same two forms.")
        A("")
        A("| family | arm | fits MITRE | fits TRANSFORMED | n paired |")
        A("|---|---|---:|---:|---:|")
        for fam in ("PIPE", "PIPESHELL"):
            if fam not in nat:
                continue
            for label, table in (("native", nat[fam]), ("occt(A/B)", occ[fam])):
                nm = nt = np_ = 0
                for r in fold_free:
                    a = table.get(r["part"])
                    if not a or a.get("status") != "OK":
                        continue
                    v = a.get("vol")
                    if v is None or not (v > 0.0):
                        continue
                    np_ += 1
                    if abs(v - r["closed_form"]) / r["closed_form"] <= TOL:
                        nm += 1
                    if abs(v - r["transformed_form"]) / r["transformed_form"] <= TOL:
                        nt += 1
                A(f"| {fam} | {label} | {nm} ({pct(nm, np_)}) | "
                  f"{nt} ({pct(nt, np_)}) | {np_} |")

        A("")
        A("### Topology, because volume cannot validate geometry")
        A("")
        A("| family | median native F/E/V/shells/solids | median OCCT F/E/V/shells/solids |")
        A("|---|---|---|")
        for fam in ("PIPE", "PIPESHELL"):
            if fam not in nat:
                continue
            def med(table, k):
                xs = [a.get(k) for a in table.values()
                      if a.get("status") == "OK" and isinstance(a.get(k), (int, float))]
                return f"{sorted(xs)[len(xs) // 2]:g}" if xs else "-"
            n_s = "/".join(med(nat[fam], k) for k in ("f", "e", "v", "sh", "so"))
            o_s = "/".join(med(occ[fam], k) for k in ("f", "e", "v", "sh", "so"))
            A(f"| {fam} | {n_s} | {o_s} |")

        A("")
        A("### Do the two arms AGREE on the same part?")
        A("")
        A("The coverage gate never asks. `agree` is the A/B's own field.")
        A("")
        A("| family | both arms OK | agree | agree up to orientation |")
        A("|---|---:|---:|---:|")
        for fam in ("PIPE", "PIPESHELL"):
            both = [r for r in ab if r.get("family") == fam
                    and r.get("native", {}).get("status") == "OK"
                    and r.get("occt", {}).get("status") == "OK"]
            ag = sum(1 for r in both if r.get("agree"))
            au = sum(1 for r in both if r.get("agree_upto_orientation"))
            A(f"| {fam} | {len(both)} | {ag} ({pct(ag, len(both))}) | "
              f"{au} ({pct(au, len(both))}) |")

    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
