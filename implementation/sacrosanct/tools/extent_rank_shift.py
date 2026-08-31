#!/usr/bin/env python3
"""Re-measure the RANK SHIFT itself, with the definitions of the original finding.

ARCHIE_SHIFTS_THE_DIMENSIONS_DOWN_A_RANK.md, on v5cap's 116 low-recall rows:
    sorted extents within 10%        5 (4.3%)
    per-axis exact to 0.1%           largest 78 (67%)  middle 16 (14%)  smallest 18 (16%)
    STRICT shift-down                67 / 116 (58%)   null median 4, 99th pct 10
    per-slot rate                    low-recall same-rank 0.33 shift-down 0.31
                                     high-recall same-rank 0.83 shift-down 0.07

If naming the axes fixed the binding, the shift-down rate on the SAME rows must fall.
Extents are compared SORTED, which is invariant under rotation, so a pose difference
cannot produce or hide the effect.
"""
import argparse
import json
import random

TOL_EXACT = 0.001      # "exact to 0.1%"
TOL_LOOSE = 0.10       # "within 10%"


def close(a, b, tol):
    if a is None or b is None:
        return False
    d = max(abs(a), abs(b), 1e-9)
    return abs(a - b) <= tol * d


def load(path):
    """Returns id -> (ref_sorted, cand_sorted, ref_raw, cand_raw).

    SORTED extents answer "is the FORM right" (rotation-invariant). RAW extents answer
    "is each number on the axis the prompt put it on", which is the binding question the
    intervention is aimed at. Both are reported; they are different claims."""
    out = {}
    for line in open(path):
        line = line.strip()
        if line:
            r = json.loads(line)
            if r.get('cand_ext') and r.get('ref_ext'):
                out[r['id']] = (sorted(r['ref_ext']), sorted(r['cand_ext']),
                                r['ref_ext'], r['cand_ext'])
    return out


def stats(rows):
    """rows: list of (ref_sorted, cand_sorted, ...). Ascending, so index 2 is largest."""
    n = len(rows)
    if not n:
        return {}
    allthree = sum(1 for t in rows
                   if all(close(t[1][i], t[0][i], TOL_LOOSE) for i in range(3)))
    per_axis = [sum(1 for t in rows if close(t[1][i], t[0][i], TOL_EXACT))
                for i in range(3)]
    # RAW (unsorted) per-axis agreement: is each number on the axis the prompt named?
    raw = [0, 0, 0]
    raw_all = 0
    for t in rows:
        if len(t) >= 4:
            hits = [close(t[3][i], t[2][i], TOL_EXACT) for i in range(3)]
            for i in range(3):
                raw[i] += 1 if hits[i] else 0
            raw_all += 1 if all(hits) else 0
    # STRICT shift-down: candidate rank i equals reference rank i-1 and NOT rank i
    shifted = 0
    slots_same = slots_shift = 0
    for t in rows:
        r, c = t[0], t[1]
        hit = False
        for i in (1, 2):
            same = close(c[i], r[i], TOL_EXACT)
            down = close(c[i], r[i - 1], TOL_EXACT)
            if down and not same:
                hit = True
        for i in range(3):
            if close(c[i], r[i], TOL_EXACT):
                slots_same += 1
            elif i >= 1 and close(c[i], r[i - 1], TOL_EXACT):
                slots_shift += 1
        shifted += 1 if hit else 0
    return {'n': n, 'within10pct': allthree,
            'smallest': per_axis[0], 'middle': per_axis[1], 'largest': per_axis[2],
            'rawX': raw[0], 'rawY': raw[1], 'rawZ': raw[2], 'raw_all': raw_all,
            'shift_down': shifted,
            'slot_same': slots_same / (3.0 * n), 'slot_shift': slots_shift / (3.0 * n)}


def null_shift(rows, n_iter=2000, seed=20260830):
    """Shuffle CANDIDATE extents across rows and recount the strict shift-down."""
    rnd = random.Random(seed)
    refs = [t[0] for t in rows]
    cands = [t[1] for t in rows]
    out = []
    for _ in range(n_iter):
        perm = cands[:]
        rnd.shuffle(perm)
        out.append(stats(list(zip(refs, perm)))['shift_down'])
    out.sort()
    return out[len(out) // 2], out[int(0.99 * len(out))]


def show(tag, rows, do_null=True):
    s = stats(rows)
    if not s:
        print(f'  {tag}: no rows')
        return
    n = s['n']
    print(f'  {tag}   n={n}')
    print(f'     sorted extents within 10%      {s["within10pct"]:>4} '
          f'({100*s["within10pct"]/n:.1f}%)')
    print(f'     exact to 0.1%   largest {s["largest"]:>4} ({100*s["largest"]/n:.0f}%)'
          f'   middle {s["middle"]:>4} ({100*s["middle"]/n:.0f}%)'
          f'   smallest {s["smallest"]:>4} ({100*s["smallest"]/n:.0f}%)')
    line = (f'     STRICT shift-down              {s["shift_down"]:>4} '
            f'({100*s["shift_down"]/n:.1f}%)')
    if do_null and n > 3:
        med, p99 = null_shift(rows)
        line += f'    null median {med}, 99th pct {p99}'
    print(line)
    print(f'     per-slot   same-rank {s["slot_same"]:.2f}   '
          f'shift-down {s["slot_shift"]:.2f}')
    print(f'     RAW axis exact to 0.1%   X {s["rawX"]:>4} ({100*s["rawX"]/n:.0f}%)'
          f'   Y {s["rawY"]:>4} ({100*s["rawY"]/n:.0f}%)'
          f'   Z {s["rawZ"]:>4} ({100*s["rawZ"]/n:.0f}%)'
          f'   all three {s["raw_all"]:>4} ({100*s["raw_all"]/n:.0f}%)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--a', required=True, help='v5cap bbox jsonl')
    ap.add_argument('--b', required=True, help='v7 bbox jsonl')
    ap.add_argument('--groups', required=True,
                    help='json {"low":[ids], "mid":[...], "blob":[...]}')
    args = ap.parse_args()
    A, B = load(args.a), load(args.b)
    G = json.load(open(args.groups))
    print(f'bbox rows: v5cap {len(A)}  v7 {len(B)}')
    for g in ('low', 'mid', 'blob'):
        ids = [i for i in G.get(g, []) if i in A and i in B]
        print()
        print(f'=== group {g.upper()}  (defined on v5cap recall)  '
              f'{len(ids)} rows with a bbox in BOTH arms')
        show('v5cap', [A[i] for i in ids])
        show('v7   ', [B[i] for i in ids])


if __name__ == '__main__':
    main()
