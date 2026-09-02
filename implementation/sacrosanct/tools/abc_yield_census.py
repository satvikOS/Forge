#!/usr/bin/env python3
"""Measure how much of the ABC / Onshape FeatureScript corpus the Forge feature-tree IR
can express, against a NAMED op vocabulary, so the answer can be re-measured whenever the
vocabulary moves.

Why this exists
---------------
An earlier census reported "0.00% of models translate with DIRECT OPS ALONE" and named the
missing sketch entity as the binding constraint. PR #163 added SKETCH/SPT/SLINE/SCIRC/SARC/
CON/SOLVE to the kernel, so that headline had to be re-measured rather than assumed.

The measurement is deliberately PAIRED: the same 9,846 trees are scored under several op
vocabularies that differ only in which ops exist. Nothing is inferred from instance counts
-- every recovery figure is obtained by re-running the model-level gate with that one op
made mappable, because a blocked model is usually blocked more than once.

Data
----
data/external/abc_ofs/abc_0000_ofs_v00.7z -- 9,852 OnShape FeatureScript YAML trees.
Onshape ships the EVALUATED sketch geometry (pntX/pntY/dirX/dirY, in METRES) beside the
constraints, so the 1,195,996 constraints can be dropped: no constraint solver is needed.

LICENCE: the provenance of this corpus is UNVERIFIED (see MODEL_DATA.md). Nothing measured
here clears that flag; these counts are a capability measurement, not a training licence.

Usage
-----
  python3 abc_yield_census.py --extracted <dir> [--json out.json]
  python3 abc_yield_census.py --archive <path.7z> --extract-to <dir> [--json out.json]
"""
import argparse, collections, glob, json, os, sys
from multiprocessing import Pool

try:
    import yaml
    from yaml import CSafeLoader as Loader
except ImportError:
    sys.exit('needs PyYAML with libyaml (CSafeLoader)')

# --------------------------------------------------------------------------- geometry
UNREPRESENTABLE = ('BTCurveGeometrySpline', 'BTCurveGeometryInterpolatedSpline',
                   'BTCurveGeometryEllipse', 'BTCurveGeometryConic')
CURVE = UNREPRESENTABLE + ('BTCurveGeometryLine', 'BTCurveGeometryCircle')

# --------------------------------------------------------------------------- op map
# DIRECT: one Forge op reproduces the feature's semantics.
DIRECT = {
    'extrude': 'EXTRUDE', 'fillet': 'FILLET', 'chamfer': 'CHAMFER', 'revolve': 'REVOLVE',
    'booleanBodies': 'FUSE/CUT/COMMON', 'mirror': 'MIRROR', 'circularPattern': 'PATTERN',
    'linearPattern': 'PATTERN', 'shell': 'SHELL', 'loft': 'LOFT', 'hole': 'HOLE',
    'transform': 'TRANSLATE/ROTATE',
}
# PARTIAL: an op exists but reaches the feature only approximately, or in restricted cases.
PARTIAL = {
    'newSketch': 'CIRCLE/RECT/RRECT/REGPOLY/POLY/WIRE -- a canned profile, or tessellation',
    'cPlane': 'no datum-plane op; folded into a placement argument',
    'sweep': 'SWEEP takes (radius, path) or (poly, path), not an arbitrary profile',
    'moveFace': 'PUSHFACE translates a face only',
    'deleteFace': 'DEFEATURE / HEAL',
    'deleteBodies': 'omit the body, or CUT',
    'splitPart': 'SECTION',
}
# Everything else is NONE. These can never be recovered by ANY op: they carry no history to
# parse (an imported B-rep) or belong to the assembly layer, not the part feature tree.
UNRECOVERABLE_IN_PRINCIPLE = {
    'importForeign', 'importDerived', 'mateConnector', 'copyPart', 'assignVariable',
    'measureDistance', 'autolayout',
}

# Arms differ ONLY in which ops exist. No feature is reclassified into NONE by an arm
# change, so clearance figures are strictly comparable across arms.
ARMS = {
    0: '40 ops (b003bb3a) -- the vocabulary the original census was taken against',
    1: '46 ops (30a841cd) -- emission_policy.allowed_ops BEFORE the sketch commands',
    2: '55 ops -- arm 1 + the 9 forbidden_ops (sketch family): kernel-compilable, '
       'NOT user-invocable',
    # Arm 3 is the point of the re-measurement, and it is NOT a copy of arm 2. It is
    # what emission_policy.allowed_ops HOLDS once the eight forge::ui commands that
    # emit SKETCH / SPT / SLINE / SCIRC / SARC / CON / SOLVE exist: 53 ops, because
    # ARC and SLOT stay forbidden. Arm 2 remains the KERNEL arm and keeps those two,
    # so the two arms are separate rows and the gap between them is the honest
    # statement of what is still out of reach.
    3: '53 ops -- emission_policy.allowed_ops AFTER the sketch commands: arm 1 + the '
       'seven 2D-sketch ops, USER-INVOCABLE. ARC and SLOT remain forbidden',
}


# --------------------------------------------------------------------------- parsing
def _walk(lst, out, depth=0):
    for f in lst or []:
        m = f.get('message') or {}
        ft = m.get('featureType')
        if ft is None:
            continue
        rec = {'t': ft, 'd': depth}
        ents = m.get('entities')
        if ents is not None:
            geo = collections.Counter()
            for e in ents:
                em = e.get('message') or {}
                gt = ((em.get('geometry') or {}).get('typeName')) or 'NONE'
                geo[gt + ('|c' if em.get('isConstruction') else '')] += 1
            rec['geo'] = dict(geo)
            rec['nent'] = len(ents)
            rec['ncon'] = len(m.get('constraints') or [])
        out.append(rec)
        if m.get('subFeatures'):
            _walk(m['subFeatures'], out, depth + 1)


def parse_one(path):
    try:
        with open(path, 'rb') as fh:
            d = yaml.load(fh, Loader=Loader)
    except Exception as e:
        return {'id': os.path.basename(path), 'err': type(e).__name__}
    if not isinstance(d, dict):
        return {'id': os.path.basename(path), 'err': 'nondict'}
    feats = []
    _walk(d.get('features'), feats)
    return {'id': os.path.basename(path), 'feats': feats}


# --------------------------------------------------------------------------- scoring
def sketch_is_exact(feat):
    """True iff every curve in the sketch is a line/circle/arc, which SLINE/SCIRC/SARC
    reproduce exactly. False if it carries a spline/ellipse/conic, or has no curve."""
    geo = feat.get('geo') or {}
    if any(k.split('|')[0] in UNREPRESENTABLE for k in geo):
        return False
    return sum(v for k, v in geo.items() if k.split('|')[0] in CURVE) > 0


# The arms in which the seven sketch ops are MAPPABLE. Arm 2 has them because the
# kernel compiles them; arm 3 has them because a forge::ui command emits them. The
# two arms differ ONLY in ARC and SLOT, and neither reaches a `newSketch`, so arm 3
# is PREDICTED to reproduce arm 2's DIRECT figures exactly -- which is a prediction
# this file must MEASURE rather than assert, and the reason arm 3 is a real row and
# not an alias for arm 2.
SKETCH_ARMS = frozenset({2, 3})


def classify(feat, arm):
    t = feat['t']
    if t in DIRECT:
        return 'D'
    if arm >= 1 and t == 'thicken':      # THICKEN became user-invocable in the 46-op vocab
        return 'D'
    if t == 'newSketch':
        return 'D' if (arm in SKETCH_ARMS and sketch_is_exact(feat)) else 'P'
    if t in PARTIAL:
        return 'P'
    return 'N'


def has_unrepresentable_curve(model):
    return any(k.split('|')[0] in UNREPRESENTABLE
               for f in model['feats'] for k in (f.get('geo') or {}))


def score(models, arm, unrep, exempt=frozenset(), fix_geom=False):
    """Return (instance counter, clear, direct_only, op_blocked, geom_blocked)."""
    inst = collections.Counter()
    clear = direct_only = op_blocked = geom_blocked = 0
    for r in models:
        cls = [classify(f, arm) for f in r['feats']]
        for c in cls:
            inst[c] += 1
        blocked = any(c == 'N' and f['t'] not in exempt
                      for f, c in zip(r['feats'], cls))
        geom = unrep[r['id']] and not fix_geom
        if blocked:
            op_blocked += 1
        if unrep[r['id']]:
            geom_blocked += 1
        if not blocked and not geom:
            clear += 1
            if all(c == 'D' for c in cls):
                direct_only += 1
    return inst, clear, direct_only, op_blocked, geom_blocked


def first_blocker(models, arm, unrep):
    fb = collections.Counter()
    for r in models:
        cls = [classify(f, arm) for f in r['feats']]
        if 'N' not in cls and not unrep[r['id']]:
            continue
        lab = '<unknown>'
        for f, c in zip(r['feats'], cls):
            if c == 'N':
                lab = f['t']
                break
            if f.get('geo') and any(k.split('|')[0] in UNREPRESENTABLE for k in f['geo']):
                lab = '<spline/ellipse/conic in sketch>'
                break
        fb[lab] += 1
    return fb


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--extracted')
    ap.add_argument('--archive')
    ap.add_argument('--extract-to')
    ap.add_argument('--jobs', type=int, default=8)
    ap.add_argument('--json')
    a = ap.parse_args()

    root = a.extracted
    if a.archive:
        import py7zr
        root = a.extract_to or '.'
        with py7zr.SevenZipFile(a.archive, 'r') as z:
            z.extractall(path=root)
    if not root:
        ap.error('need --extracted or --archive')

    files = sorted(glob.glob(os.path.join(root, '*', '*.yml')))
    print(f'files {len(files)}', file=sys.stderr)
    with Pool(a.jobs) as p:
        raw = p.map(parse_one, files, chunksize=32)
    errs = [r for r in raw if 'err' in r]
    models = [r for r in raw if 'err' not in r and r['feats']]
    nfeat = sum(len(r['feats']) for r in models)
    unrep = {r['id']: has_unrepresentable_curve(r) for r in models}

    print(f'\nMODEL SET {len(models)} non-empty trees of {len(raw)} files '
          f'({len(raw) - len(models) - len(errs)} empty, {len(errs)} parse errors); '
          f'{nfeat} features\n')

    out = {'models': len(models), 'files': len(raw), 'features': nfeat, 'arms': {},
           'licence': 'corpus provenance UNVERIFIED (MODEL_DATA.md); not a training licence'}

    hdr = (f"{'arm':6s} {'DIRECT':>17s} {'PARTIAL':>17s} {'NONE':>15s} "
           f"{'clear both':>14s} {'DIRECT-ONLY':>14s}")
    print(hdr)
    print('-' * len(hdr))
    for arm in sorted(ARMS):
        inst, clear, do, ob, gb = score(models, arm, unrep)
        tot = sum(inst.values())
        n = len(models)
        print(f'{arm:<6d} {inst["D"]:8d} {100.0*inst["D"]/tot:6.2f}% '
              f'{inst["P"]:8d} {100.0*inst["P"]/tot:6.2f}% '
              f'{inst["N"]:6d} {100.0*inst["N"]/tot:6.2f}% '
              f'{clear:6d} {100.0*clear/n:6.2f}% {do:6d} {100.0*do/n:6.2f}%')
        out['arms'][str(arm)] = {
            'description': ARMS[arm], 'direct': inst['D'], 'partial': inst['P'],
            'none': inst['N'], 'instances': tot, 'clear_both_gates': clear,
            'direct_ops_alone': do, 'op_blocked': ob, 'geom_blocked': gb}
    for arm in sorted(ARMS):
        print(f'  arm {arm}: {ARMS[arm]}')

    # ---- first blocker, measured on the arm that describes today
    print('\nFIRST BLOCKING FEATURE (arm 3, what Archie may emit today)')
    fb = first_blocker(models, 3, unrep)
    den = sum(fb.values())
    agg = collections.Counter()
    for t, c in fb.most_common():
        k = ('UNRECOVERABLE IN PRINCIPLE' if t in UNRECOVERABLE_IN_PRINCIPLE
             else 'geometry gap' if t.startswith('<') else 'not yet implemented')
        agg[k] += c
        print(f'  {t:36s} {c:6d} {100.0*c/den:7.2f}%  {k}')
    print(f'  non-clearing total {den}')
    for k, v in agg.most_common():
        print(f'    {k:30s} {v:6d} {100.0*v/den:7.2f}%')
    out['first_blocker'] = dict(fb)
    out['first_blocker_classes'] = dict(agg)

    # ---- MEASURED recovery, never inferred
    # Measured against the arm that describes TODAY, which is now arm 3. The
    # clear-both-gates figure is IDENTICAL on arms 1 and 3 -- the sketch family
    # converts PARTIAL into DIRECT and unblocks nothing -- so every recovery
    # number below is unchanged by this branch, which is exactly what makes
    # re-pointing it safe and worth doing rather than cosmetic.
    _, base, _, _, _ = score(models, 3, unrep)
    print(f'\nMEASURED RECOVERY per candidate op (arm 3 baseline clear = {base})')
    none_inst = collections.Counter()
    with_model = collections.Counter()
    for r in models:
        for t in set(f['t'] for f in r['feats']):
            with_model[t] += 1
        for f in r['feats']:
            if classify(f, 1) == 'N':
                none_inst[f['t']] += 1
    rec = {}
    for t, ni in none_inst.most_common():
        got = score(models, 3, unrep, exempt={t})[1] - base
        rec[t] = {'instances': ni, 'models_containing': with_model[t],
                  'measured_recovery': got}
        print(f'  {t:30s} inst {ni:6d}  models {with_model[t]:5d}  '
              f'MEASURED +{got:<5d} (naive would say {with_model[t]})')
    g = score(models, 3, unrep, fix_geom=True)[1] - base
    rec['<curve entities: spline/ellipse/conic>'] = {
        'models_containing': sum(1 for v in unrep.values() if v), 'measured_recovery': g}
    print(f'  {"<curve entities>":30s} '
          f'models {sum(1 for v in unrep.values() if v):5d}  MEASURED +{g}')
    out['measured_recovery'] = rec

    every = set(none_inst) - UNRECOVERABLE_IN_PRINCIPLE
    combos = {
        'draft+splitPart+helix': score(models, 3, unrep, exempt={'draft', 'splitPart', 'helix'})[1] - base,
        'every_not_yet_implemented_op': score(models, 3, unrep, exempt=every)[1] - base,
        'curve_entities_only': g,
        'every_op_plus_curve_entities': score(models, 3, unrep, exempt=every, fix_geom=True)[1] - base,
    }
    print('\nCOMBINATIONS (measured, not summed):')
    for k, v in combos.items():
        print(f'  {k:34s} +{v}')
    out['combinations'] = combos
    ceiling = base + combos['every_op_plus_curve_entities']
    out['ceiling'] = ceiling
    out['unrecoverable_in_principle'] = len(models) - ceiling
    print(f'\nEND TO END: translatable today {base} ({100.0*base/len(models):.2f}%); '
          f'ceiling {ceiling} ({100.0*ceiling/len(models):.2f}%); '
          f'unrecoverable in principle {len(models)-ceiling}')
    print('LICENCE: corpus provenance UNVERIFIED (MODEL_DATA.md).')

    if a.json:
        with open(a.json, 'w') as fh:
            json.dump(out, fh, indent=1, sort_keys=True)
        print(f'wrote {a.json}', file=sys.stderr)


if __name__ == '__main__':
    main()
