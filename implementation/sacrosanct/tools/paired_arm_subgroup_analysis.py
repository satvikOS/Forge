#!/usr/bin/env python3
"""Test the axis-naming prediction, paired, with intervals.

THE PREDICTION, recorded in ARCHIE_SHIFTS_THE_DIMENSIONS_DOWN_A_RANK.md and in
scripts/eval_axis_named_v7_e600.sh BEFORE these numbers existed:

    "a corpus intervention that fixes the binding should move recall on the
     low-recall population WITHOUT changing the blob population, because the two
     modes have different causes."

So there are three confirmatory tests, not one:
  H1  low-recall subgroup: v7 - v5cap > 0
  H2  blob subgroup:       v7 - v5cap ~ 0
  H3  the INTERACTION, delta(low) - delta(blob) != 0.  H1 and H2 alone cannot
      establish "moved one and not the other" -- a significant effect in one group
      and a non-significant effect in another is not evidence that the two differ.
      H3 is the test the claim actually needs, and it gets its own interval.

THE SUBGROUPS ARE DEFINED ON THE v5cap ARM ONLY. Recall comes from the pre-intervention
arm's own iou_cells, so the split is fixed before v7 is looked at and cannot be tuned by
its outcome. Group thresholds are the ones the prior finding used: <0.50 and >=0.95.
"""
import argparse
import json
import random
import sys

BOOT = 20000
SEED = 20260830


def load(paths):
    """Load one arm from comma-separated disjoint shards. Refuse a non-disjoint merge."""
    allr = {}
    for one in paths.split(','):
        one = one.strip()
        if not one:
            continue
        d = json.load(open(one))
        for r in (d['records'] if isinstance(d, dict) else d):
            t = r['task_id']
            if t in allr:
                sys.exit(f'[fatal] {t} appears in two shards of {paths} -- not disjoint')
            allr[t] = r
    return allr


def recall_of(r):
    """Shape recall = intersection / reference voxels, from the record's own cells."""
    comp = r.get('components') or {}
    sh = comp.get('shape') if isinstance(comp, dict) else None
    cells = (sh or {}).get('iou_cells') if isinstance(sh, dict) else None
    if not cells:
        return None
    ref = cells.get('reference')
    if not ref:
        return None
    return cells.get('intersection', 0) / ref


def ci(vals, n_boot=BOOT, seed=SEED):
    """95% percentile bootstrap CI of the MEAN of a paired difference vector."""
    if not vals:
        return float('nan'), float('nan')
    rnd = random.Random(seed)
    n = len(vals)
    means = []
    for _ in range(n_boot):
        s = 0.0
        for _ in range(n):
            s += vals[rnd.randrange(n)]
        means.append(s / n)
    means.sort()
    return means[int(0.025 * n_boot)], means[int(0.975 * n_boot)]


def ci_diff_of_diff(a, b, n_boot=BOOT, seed=SEED):
    """95% CI of mean(a) - mean(b) for two INDEPENDENT groups of paired differences.
    The two subgroups are disjoint sets of rows, so each is resampled separately."""
    rnd = random.Random(seed)
    out = []
    na, nb = len(a), len(b)
    if not na or not nb:
        return float('nan'), float('nan')
    for _ in range(n_boot):
        sa = sum(a[rnd.randrange(na)] for _ in range(na)) / na
        sb = sum(b[rnd.randrange(nb)] for _ in range(nb)) / nb
        out.append(sa - sb)
    out.sort()
    return out[int(0.025 * n_boot)], out[int(0.975 * n_boot)]


def report(name, A, B, keys, label_a='v5cap', label_b='v7'):
    """Paired report over `keys` for metric 'composite'."""
    d = [B[k]['composite'] - A[k]['composite'] for k in keys]
    ma = sum(A[k]['composite'] for k in keys) / len(keys)
    mb = sum(B[k]['composite'] for k in keys) / len(keys)
    lo, hi = ci(d)
    star = 'EXCLUDES 0' if (lo > 0 or hi < 0) else 'includes 0'
    # The achieved half-width is stated so a null can be read as "no effect THIS BIG"
    # rather than as "no effect" -- an underpowered null is not a null.
    hw = 0.5 * (hi - lo)
    print(f'  {name:<26} n={len(keys):<4} {label_a} {ma:.4f}  {label_b} {mb:.4f}  '
          f'delta {mb-ma:+.4f}  95% CI [{lo:+.4f}, {hi:+.4f}]  {star}'
          f'   (+-{hw:.4f})')
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--a', required=True, help='v5cap json (comma-separated shards)')
    ap.add_argument('--b', required=True, help='v7 json (comma-separated shards)')
    ap.add_argument('--write-groups', default=None,
                    help='write the v5cap-defined subgroups to this json, so the '
                         'extent analysis splits rows exactly the same way')
    args = ap.parse_args()

    A, B = load(args.a), load(args.b)
    print(f'rows: v5cap {len(A)}  v7 {len(B)}  same id set {set(A)==set(B)}')
    ids = sorted(set(A) & set(B))

    okA = {k for k in ids if A[k].get('ok')}
    okB = {k for k in ids if B[k].get('ok')}
    print(f'scored (ok):  v5cap {len(okA)}   v7 {len(okB)}')
    print(f'refused    :  v5cap {len(ids)-len(okA)}   v7 {len(ids)-len(okB)}')
    print(f'  v5cap refusals: {sorted(set(ids)-okA)}')
    print(f'  v7    refusals: {sorted(set(ids)-okB)}')
    bfA = sum(1 for k in okA if A[k].get('build_failed'))
    bfB = sum(1 for k in okB if B[k].get('build_failed'))
    print(f'build-failed (a real 0): v5cap {bfA}   v7 {bfB}')

    both = sorted(okA & okB)
    print()
    print('=' * 92)
    print('PAIRED COMPOSITE on the rows BOTH arms scored')
    print('=' * 92)
    for term in ('shape', 'interface', 'topology', 'composite'):
        ma = sum(A[k][term] for k in both) / len(both)
        mb = sum(B[k][term] for k in both) / len(both)
        d = [B[k][term] - A[k][term] for k in both]
        lo, hi = ci(d)
        star = 'EXCLUDES 0' if (lo > 0 or hi < 0) else 'includes 0'
        print(f'  {term:<12} v5cap {ma:.4f}   v7 {mb:.4f}   delta {mb-ma:+.4f}   '
              f'95% CI [{lo:+.4f}, {hi:+.4f}]  {star}')
    print(f'  n = {len(both)} paired rows, {BOOT} paired bootstrap resamples')

    # -- sensitivity: charge every candidate-side refusal 0.0, re-pair on all rows -- #
    print()
    print('SENSITIVITY: every refusal charged 0.0, paired on all rows')
    da = [(B[k]['composite'] if B[k].get('ok') else 0.0)
          - (A[k]['composite'] if A[k].get('ok') else 0.0) for k in ids]
    ma = sum(A[k]['composite'] if A[k].get('ok') else 0.0 for k in ids) / len(ids)
    mb = sum(B[k]['composite'] if B[k].get('ok') else 0.0 for k in ids) / len(ids)
    lo, hi = ci(da)
    star = 'EXCLUDES 0' if (lo > 0 or hi < 0) else 'includes 0'
    print(f'  composite    v5cap {ma:.4f}   v7 {mb:.4f}   delta {mb-ma:+.4f}   '
          f'95% CI [{lo:+.4f}, {hi:+.4f}]  {star}   n={len(ids)}')

    # -- compile rate, McNemar ------------------------------------------------ #
    print()
    print('BUILT A SOLID (ok and not build_failed), all rows, paired McNemar')
    ca = {k: bool(A[k].get('ok') and not A[k].get('build_failed')) for k in ids}
    cb = {k: bool(B[k].get('ok') and not B[k].get('build_failed')) for k in ids}
    b_only = sum(1 for k in ids if cb[k] and not ca[k])
    a_only = sum(1 for k in ids if ca[k] and not cb[k])
    na, nb = sum(ca.values()), sum(cb.values())
    chi = ((abs(b_only - a_only) - 1) ** 2 / (b_only + a_only)) if (b_only + a_only) else 0.0
    dd = [(1.0 if cb[k] else 0.0) - (1.0 if ca[k] else 0.0) for k in ids]
    lo, hi = ci(dd)
    print(f'  v5cap {na}/{len(ids)} = {100*na/len(ids):.1f}%    '
          f'v7 {nb}/{len(ids)} = {100*nb/len(ids):.1f}%')
    print(f'  discordant: v7-only {b_only}, v5cap-only {a_only}   '
          f'McNemar chi2 = {chi:.1f}')
    print(f'  difference {100*(nb-na)/len(ids):+.1f} pp   '
          f'95% CI [{100*lo:+.1f}, {100*hi:+.1f}] pp')

    # -- THE PREDICTION ------------------------------------------------------- #
    print()
    print('=' * 92)
    print('THE PREDICTION: groups defined on v5cap ONLY (pre-intervention arm)')
    print('=' * 92)
    rec = {k: recall_of(A[k]) for k in both}
    have = [k for k in both if rec[k] is not None]
    nocells = [k for k in both if rec[k] is None]
    print(f'  rows with v5cap iou_cells {len(have)}   without (build-failed) {len(nocells)}')

    low = [k for k in have if rec[k] < 0.50]
    mid = [k for k in have if 0.50 <= rec[k] < 0.95]
    blob = [k for k in have if rec[k] >= 0.95]
    print(f'  v5cap recall <0.50 {len(low)}   0.50-0.95 {len(mid)}   >=0.95 {len(blob)}')
    if args.write_groups:
        json.dump({'low': low, 'mid': mid, 'blob': blob,
                   'no_cells': nocells}, open(args.write_groups, 'w'), indent=1)
        print(f'  [groups] {args.write_groups}')
    print()
    d_low = report('LOW-RECALL (<0.50)', A, B, low) if low else []
    d_mid = report('mid (0.50-0.95)', A, B, mid) if mid else []
    d_blob = report('BLOB (>=0.95)', A, B, blob) if blob else []
    if nocells:
        report('v5cap built nothing', A, B, nocells)

    if d_low and d_blob:
        lo, hi = ci_diff_of_diff(d_low, d_blob)
        ml = sum(d_low) / len(d_low)
        mb2 = sum(d_blob) / len(d_blob)
        star = 'EXCLUDES 0' if (lo > 0 or hi < 0) else 'includes 0'
        print()
        print(f'  H3 INTERACTION  delta(low) - delta(blob) = {ml-mb2:+.4f}   '
              f'95% CI [{lo:+.4f}, {hi:+.4f}]   {star}')

    # -- the mechanism variable itself: recall ------------------------------- #
    print()
    print('RECALL (the quantity the prediction is about), same groups')
    for nm, ks in (('LOW-RECALL (<0.50)', low), ('mid (0.50-0.95)', mid),
                   ('BLOB (>=0.95)', blob)):
        if not ks:
            continue
        rb = {k: recall_of(B[k]) for k in ks}
        ks2 = [k for k in ks if rb[k] is not None]
        # a v7 row that built nothing has no cells; it covers nothing, so recall 0
        d = [(rb[k] if rb[k] is not None else 0.0) - rec[k] for k in ks]
        ma = sum(rec[k] for k in ks) / len(ks)
        mb3 = sum((rb[k] if rb[k] is not None else 0.0) for k in ks) / len(ks)
        lo, hi = ci(d)
        star = 'EXCLUDES 0' if (lo > 0 or hi < 0) else 'includes 0'
        print(f'  {nm:<26} n={len(ks):<4} v5cap {ma:.4f}  v7 {mb3:.4f}  '
              f'delta {mb3-ma:+.4f}  95% CI [{lo:+.4f}, {hi:+.4f}]  {star}'
              f'   [{len(ks)-len(ks2)} v7 rows built nothing, charged 0]')


if __name__ == '__main__':
    main()
