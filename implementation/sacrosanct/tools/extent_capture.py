#!/usr/bin/env python3
"""Capture candidate bounding boxes so the RANK SHIFT itself can be re-measured.

The composite records store volume and voxel cells but no per-axis extents, which is
why ARCHIE_SHIFTS_THE_DIMENSIONS_DOWN_A_RANK.md had to re-verify. This does the same
capture for both arms through the SAME pinned binary, census-only (no IoU voxelisation),
which is far cheaper than a re-score.

Reference extents come from the eval prompt's own kernel-measured bbox; --check-ref
proves that bbox equals what the verifier reports for the reference STEP.
"""
import argparse
import json
import os
import re
import sys

R = '/Users/account_clawteam1/archdisc-Models'
sys.path.insert(0, os.path.join(R, 'scripts'))
os.chdir(R)
from interface_metrics import CensusVerifier                        # noqa: E402


def bbox_ext(census):
    bb = (census or {}).get('bbox')
    if not bb:
        return None
    mn, mx = bb.get('min'), bb.get('max')
    if not mn or not mx:
        return None
    return [round(float(mx[i]) - float(mn[i]), 6) for i in range(3)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--emissions', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--stride', type=int, default=1)
    ap.add_argument('--offset', type=int, default=0)
    ap.add_argument('--check-ref', type=int, default=0,
                    help='verify N reference STEPs against the prompt bbox')
    args = ap.parse_args()

    prompts = {}
    for line in open('data/forge/holdout_enlarged_600.jsonl'):
        line = line.strip()
        if line:
            r = json.loads(line)
            # The reference extents are taken from the SAME STRING the model is
            # handed -- "Overall envelope A x B x C mm" -- so the comparison is
            # against what the prompt actually claims. --check-ref proves that
            # claim equals the verifier's own measurement of the reference STEP.
            m = re.search(r'[Oo]verall envelope\s+([\d.]+)\s*x\s*([\d.]+)'
                          r'\s*x\s*([\d.]+)', r['user'])
            prompts[r['id']] = [float(m.group(i)) for i in (1, 2, 3)] if m else None

    tasks = {}
    for line in open('runs/composite_anchor/expert3d_v5cap_e600/tasks.jsonl'):
        line = line.strip()
        if line:
            t = json.loads(line)
            tasks[t['id']] = t

    V = CensusVerifier(timeout=180, recycle=20)
    print(f'[pin] verifier sha {V.sha}', flush=True)

    if args.check_ref:
        bad = 0
        for tid in list(prompts)[:args.check_ref]:
            m = V.measure_step(tasks[tid]['gt_step'])
            got, want = bbox_ext(m), prompts[tid]
            same = (got and want
                    and all(abs(got[i] - want[i]) <= 1e-3 * max(1.0, abs(want[i]))
                            for i in range(3)))
            print(f'  {tid:<10} prompt {want}  verifier {got}  {"OK" if same else "MISMATCH"}')
            bad += 0 if same else 1
        print(f'[check-ref] {args.check_ref - bad}/{args.check_ref} agree')
        return 0 if bad == 0 else 1

    rows = [json.loads(l) for l in open(args.emissions) if l.strip()]
    rows = rows[args.offset::args.stride]
    if args.limit:
        rows = rows[:args.limit]
    out = []
    for i, e in enumerate(rows):
        m = V.measure_ir(e.get('ir') or '', ident=e['id'])
        out.append({'id': e['id'], 'ok': bool(m.get('ok')),
                    'cand_ext': bbox_ext(m), 'ref_ext': prompts.get(e['id']),
                    'volume': m.get('volume'), 'genus': m.get('genus'),
                    'error': None if m.get('ok') else str(m.get('error'))[:120]})
        if (i + 1) % 20 == 0:
            print(f'  {i+1}/{len(rows)}', flush=True)
    with open(args.out, 'w') as fh:
        for r in out:
            fh.write(json.dumps(r) + '\n')
    got = sum(1 for r in out if r['cand_ext'])
    print(f'[done] {args.out}  {got}/{len(out)} candidates with a bbox')
    return 0


if __name__ == '__main__':
    sys.exit(main())
