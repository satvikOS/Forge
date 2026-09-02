#!/usr/bin/env python3
"""Census the CURVE ENTITIES that gate the ABC / Onshape corpus, by TYPE and by DEGREE,
and MEASURE the model-level recovery of each candidate IR representation.

Why this exists
---------------
abc_yield_census.py measured that the largest single recoverable item in the corpus is not a
missing op: 548 models are gated by curve entities (splines, ellipses, conics), more than any
op. It measured the SIZE of that item and nothing about its SHAPE. Before designing an IR
representation we need to know what is actually in there -- a plan that handles ellipses but
not B-splines may capture most of the value for a fraction of the work, and a plan that
handles degree-3 polynomial B-splines but not rational ones may capture almost none.

Everything here is MEASURED against the same 9,846 trees the yield census scored, with the
same op gate, so the two are paired. A POSITIVE CONTROL asserts at startup that this tool's
baseline reproduces that census's arm-1 clearance (5,629) and geometry gate (882 models);
if it does not, the run aborts rather than reporting an unpaired number.

Recovery is never inferred from an instance count: each stage is scored by RE-RUNNING the
model-level gate with exactly that stage's entity types made representable, because a blocked
model is usually blocked more than once and instance counts err in BOTH directions.

LICENCE: the provenance of this corpus is UNVERIFIED (see MODEL_DATA.md). Nothing measured
here clears that flag; these counts are a capability measurement, not a training licence.

Usage
-----
  python3 abc_curve_entity_census.py --extracted <dir> [--json out.json]
"""
import argparse, collections, glob, json, math, os, sys
from multiprocessing import Pool

TAU = 2 * math.pi

try:
    import yaml
    from yaml import CSafeLoader as Loader
except ImportError:
    sys.exit('needs PyYAML with libyaml (CSafeLoader)')

# The four typeNames the yield census refuses. Byte-identical to that tool, so the geometry
# gate measured here is the same gate.
UNREPRESENTABLE = ('BTCurveGeometrySpline', 'BTCurveGeometryInterpolatedSpline',
                   'BTCurveGeometryEllipse', 'BTCurveGeometryConic')
EXACT_TODAY = ('BTCurveGeometryLine', 'BTCurveGeometryCircle')

# op map, verbatim from abc_yield_census.py -- the op gate must not move
DIRECT = {'extrude', 'fillet', 'chamfer', 'revolve', 'booleanBodies', 'mirror',
          'circularPattern', 'linearPattern', 'shell', 'loft', 'hole', 'transform'}
PARTIAL = {'newSketch', 'cPlane', 'sweep', 'moveFace', 'deleteFace', 'deleteBodies',
           'splitPart'}
ARM1_EXTRA = {'thicken'}          # THICKEN became user-invocable in the 46-op vocabulary

# reference count for the yield census's geometry gate, for the positive control
EXPECT_BASELINE_CLEAR = 5629
EXPECT_GEOM_BLOCKED = 882
EXPECT_MODELS = 9846


def _closed(sp, ep):
    """Onshape encodes a CLOSED curve as a BTMSketchCurve with NO start/endParam, and a
    trimmed one as a BTMSketchCurveSegment that carries them. A zero or full-turn sweep is
    also closed. MEASURED: 61,261 circles carry no param and 48,111 carry an arc range."""
    if sp is None or ep is None:
        return True
    d = abs(ep - sp)
    return d < 1e-9 or abs(d - TAU) < 1e-6


def _detail(gt, g, seg):
    """Per-entity shape facts, by geometry type. seg is the BTMSketchCurveSegment message."""
    d = {}
    sp, ep = seg.get('startParam'), seg.get('endParam')
    if gt == 'BTCurveGeometrySpline':
        d['degree'] = g.get('degree')
        d['rational'] = bool(g.get('isRational'))
        d['periodic'] = bool(g.get('isPeriodic'))
        cp = g.get('controlPoints') or []
        ncp = g.get('controlPointCount')
        # MEASURED: weights are inline in controlPoints -- stride 3 (x,y,w) when isRational,
        # stride 2 (x,y) when not, with no exception in 6,555 instances. There is no
        # separate `weights` field, so a reader that assumes stride 2 silently mangles
        # every rational spline.
        if ncp is None and cp:
            ncp = len(cp) // (3 if d['rational'] else 2)
        d['ncp'] = ncp
        d['stride'] = (len(cp) / ncp) if ncp else None
        knots = g.get('knots') or []
        d['nknots'] = len(knots)
        deg = d['degree']
        # clamped/periodic B-spline invariant: #knots == #ctrlpts + degree + 1
        d['knot_invariant'] = (ncp is not None and deg is not None
                               and len(knots) == ncp + deg + 1)
        # TRIMMED means the segment's parameter range is narrower than the curve's own
        # KNOT DOMAIN [knots[degree], knots[n-degree-1]] -- NOT [0,1]. Measured: the domain
        # is often not [0,1] at all (104 splines run 0..80), so a [0,1] test mislabels them.
        if sp is None or ep is None:
            d['trimmed'] = False
        elif deg is not None and len(knots) >= 2 * (deg + 1):
            lo, hi = knots[deg], knots[len(knots) - deg - 1]
            span = max(abs(hi - lo), 1e-12)
            d['trimmed'] = (abs(sp - lo) / span > 1e-9) or (abs(ep - hi) / span > 1e-9)
        else:
            d['trimmed'] = None
    elif gt == 'BTCurveGeometryInterpolatedSpline':
        d['npts'] = len(g.get('interpolationPoints') or []) // 2
        d['periodic'] = bool(g.get('isPeriodic'))
        d['has_start_deriv'] = 'startDerivativeX' in g
        d['has_end_deriv'] = 'endDerivativeX' in g
        d['has_handles'] = 'startHandleX' in g
        d['trimmed'] = not _closed(sp, ep) and (sp, ep) != (0.0, 1.0)
    elif gt == 'BTCurveGeometryEllipse':
        r, mr = g.get('radius'), g.get('minorRadius')
        d['full'] = _closed(sp, ep)
        if isinstance(r, (int, float)) and isinstance(mr, (int, float)) and max(r, mr) > 0:
            d['ratio'] = round(min(r, mr) / max(r, mr), 3)
            d['degenerate_circle'] = abs(r - mr) <= 1e-9 * max(r, mr)
        else:
            d['ratio'], d['degenerate_circle'] = None, None
    elif gt == 'BTCurveGeometryConic':
        rho = g.get('rho')
        d['rho'] = rho
        d['npts'] = len(g.get('points') or []) // 2
        # rho is the projective discriminant of a rational quadratic Bezier
        d['kind'] = (None if not isinstance(rho, (int, float)) else
                     'ellipse' if rho < 0.5 - 1e-12 else
                     'parabola' if abs(rho - 0.5) <= 1e-12 else 'hyperbola')
    elif gt == 'BTCurveGeometryCircle':
        d['full'] = _closed(sp, ep)
    return d


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
            cur, seen_ids = [], []
            for e in ents:
                em = e.get('message') or {}
                gm = (em.get('geometry') or {}).get('message') or {}
                gt = (em.get('geometry') or {}).get('typeName') or 'NONE'
                con = bool(em.get('isConstruction'))
                geo[gt + ('|c' if con else '')] += 1
                det = _detail(gt, gm, em)
                if gt in UNREPRESENTABLE:
                    cur.append({'gt': gt, 'con': con, 'eid': em.get('entityId'), **det})
                if gt == 'BTCurveGeometryCircle':
                    geo['__circle_full' if det.get('full') else '__circle_arc'] += 1
                if gt in EXACT_TODAY or gt in UNREPRESENTABLE:
                    seen_ids.append((em.get('entityId'), con, gt))
            rec['geo'] = dict(geo)
            if cur:
                rec['cur'] = cur
            if seen_ids:
                rec['ids'] = seen_ids
        # every feature's PARAMETERS are where one feature points at another's geometry
        rec['ptxt'] = json.dumps(m.get('parameters') or [], sort_keys=True)
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
    # A construction curve is only droppable if NOTHING CONSUMES IT -- a revolve axis or a
    # sweep path is a consumer. Sketch CONSTRAINTS are not: this corpus ships the evaluated
    # sketch geometry, so the constraint system is dropped wholesale by every arm. So the
    # search space is exactly the feature PARAMETERS (where queries live), never constraints.
    qtext = '\n'.join(f['ptxt'] for f in feats)
    refs, ctl = set(), {'con_ref': 0, 'con_tot': 0, 'real_ref': 0, 'real_tot': 0}
    for f in feats:
        for eid, con, gt in f.get('ids') or []:
            if not eid:
                continue
            hit = eid in qtext
            if con:
                ctl['con_tot'] += 1
                ctl['con_ref'] += hit
                if hit:
                    refs.add(eid)
            else:
                ctl['real_tot'] += 1
                ctl['real_ref'] += hit
    for f in feats:
        f.pop('ptxt', None)
        f.pop('ids', None)
    return {'id': os.path.basename(path), 'feats': feats, 'crefs': sorted(refs), 'ctl': ctl}


# ------------------------------------------------------------------------ the two gates
def op_blocked(model):
    """arm 1 (46 emittable ops). True when some feature has no op at all."""
    for f in model['feats']:
        t = f['t']
        if t not in DIRECT and t not in PARTIAL and t not in ARM1_EXTRA:
            return True
    return False


def _repr_ok(c, representable):
    """Is this one entity stateable by a stage that offers `representable`?

    'BTCurveGeometryInterpolatedSpline@2' means ONLY the 2-point instances, which are the
    ones MEASURED to be an exact cubic Bezier (handle == P +/- derivative/3, max error
    4.4e-16 over 511 instances). The n>2 instances are a reconstruction, not a read, so a
    stage that claims exactness must not silently include them."""
    if c['gt'] in representable:
        return True
    if (c['gt'] == 'BTCurveGeometryInterpolatedSpline'
            and 'BTCurveGeometryInterpolatedSpline@2' in representable):
        return c.get('npts') == 2
    return False


def geom_blocked(model, representable=(), drop_unreferenced_construction=False):
    """True when the model carries a curve entity this stage still cannot state."""
    for f in model['feats']:
        for c in f.get('cur') or []:
            if _repr_ok(c, representable):
                continue
            if (drop_unreferenced_construction and c['con']
                    and c.get('eid') not in model['crefs']):
                continue
            return True
    return False


def clears(models, representable=(), drop_con=False):
    return sum(1 for m in models
               if not m['_ob'] and not geom_blocked(m, representable, drop_con))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--extracted', required=True)
    ap.add_argument('--jobs', type=int, default=8)
    ap.add_argument('--json')
    a = ap.parse_args()

    files = sorted(glob.glob(os.path.join(a.extracted, '*', '*.yml')))
    print(f'files {len(files)}', file=sys.stderr)
    with Pool(a.jobs) as p:
        raw = p.map(parse_one, files, chunksize=32)
    errs = [r for r in raw if 'err' in r]
    models = [r for r in raw if 'err' not in r and r['feats']]
    for m in models:
        m['_ob'] = op_blocked(m)

    # ------------------------------------------------------------- POSITIVE CONTROL
    base = clears(models)
    gb = sum(1 for m in models if geom_blocked(m))
    print(f'\nPOSITIVE CONTROL against abc_yield_census.py arm 1')
    print(f'  models      {len(models):6d}  expect {EXPECT_MODELS}')
    print(f'  clear both  {base:6d}  expect {EXPECT_BASELINE_CLEAR}')
    print(f'  geom gated  {gb:6d}  expect {EXPECT_GEOM_BLOCKED}')
    if (len(models), base, gb) != (EXPECT_MODELS, EXPECT_BASELINE_CLEAR, EXPECT_GEOM_BLOCKED):
        sys.exit('POSITIVE CONTROL FAILED -- this tool is not measuring the same gate as the '
                 'yield census, so no number below would be paired with it. Aborting.')
    print('  PASS -- same corpus, same op gate, same geometry gate\n')

    out = {'models': len(models), 'files': len(raw), 'parse_errors': len(errs),
           'baseline_clear': base, 'geometry_gated_models': gb,
           'positive_control': 'PASS: reproduces abc_yield_census arm 1 '
                               f'({EXPECT_MODELS} models, {EXPECT_BASELINE_CLEAR} clear, '
                               f'{EXPECT_GEOM_BLOCKED} geometry-gated)',
           'licence': 'corpus provenance UNVERIFIED (MODEL_DATA.md); not a training licence'}

    # ------------------------------------------------------------------ ENTITY CENSUS
    geo = collections.Counter()
    for m in models:
        for f in m['feats']:
            for k, v in (f.get('geo') or {}).items():
                geo[k] += v
    circ_full, circ_arc = geo.pop('__circle_full', 0), geo.pop('__circle_arc', 0)
    tot_ent = sum(geo.values())
    print(f'SKETCH ENTITY CENSUS -- {tot_ent} entities in {len(models)} models')
    print(f'  {"geometry type":44s} {"count":>8s} {"share":>8s}')
    for k, v in geo.most_common():
        print(f'  {k:44s} {v:8d} {100.0 * v / tot_ent:7.3f}%')
    unrep_n = sum(v for k, v in geo.items() if k.split('|')[0] in UNREPRESENTABLE)
    print(f'\n  splines/ellipses/conics {unrep_n} = {100.0 * unrep_n / tot_ent:.3f}% of entities')
    print(f'  BTCurveGeometryCircle: full circle {circ_full}, ARC {circ_arc}')
    out.update({'entities_total': tot_ent, 'entity_census': dict(geo),
                'unrepresentable_entities': unrep_n,
                'circle_full': circ_full, 'circle_arc': circ_arc})

    # ------------------------------------------------------------------------ BY TYPE
    per = collections.defaultdict(list)
    for m in models:
        for f in m['feats']:
            for c in f.get('cur') or []:
                per[c['gt']].append(c)
    mc = {t: sum(1 for m in models
                 if any(c['gt'] == t for f in m['feats'] for c in (f.get('cur') or [])))
          for t in UNREPRESENTABLE}
    print('\nBY TYPE')
    print(f'  {"type":38s} {"inst":>7s} {"models":>7s} {"constr":>7s}')
    out['by_type'] = {}
    for t in UNREPRESENTABLE:
        L = per.get(t, [])
        ncon = sum(1 for c in L if c['con'])
        print(f'  {t:38s} {len(L):7d} {mc[t]:7d} {ncon:7d}')
        out['by_type'][t] = {'instances': len(L), 'models_containing': mc[t],
                             'construction': ncon}

    # ----------------------------------------------------------------------- BY DEGREE
    L = per.get('BTCurveGeometrySpline', [])
    print(f'\nBTCurveGeometrySpline BY DEGREE  ({len(L)} instances)')
    deg = collections.Counter(c.get('degree') for c in L)
    out['spline_by_degree'] = {}
    for d, n in sorted(deg.items(), key=lambda kv: (kv[0] is None, kv[0])):
        sub = [c for c in L if c.get('degree') == d]
        cps = sorted(c['ncp'] for c in sub if c.get('ncp'))
        rat = sum(1 for c in sub if c['rational'])
        prd = sum(1 for c in sub if c['periodic'])
        trm = sum(1 for c in sub if c['trimmed'])
        print(f'  degree {str(d):4s} {n:7d} {100.0 * n / max(len(L), 1):6.2f}%  '
              f'rational {rat:5d}  periodic {prd:5d}  trimmed {trm:5d}  ctrlpts '
              f'{cps[0] if cps else 0}/{cps[len(cps) // 2] if cps else 0}/'
              f'{cps[-1] if cps else 0} (min/med/max)')
        out['spline_by_degree'][str(d)] = {'instances': n, 'rational': rat, 'periodic': prd,
                                           'trimmed': trm,
                                           'ctrlpts_min': cps[0] if cps else 0,
                                           'ctrlpts_max': cps[-1] if cps else 0}
    for k, f in (('spline_rational', lambda c: c['rational']),
                 ('spline_periodic', lambda c: c['periodic']),
                 ('spline_trimmed', lambda c: c['trimmed']),
                 ('spline_knot_invariant_holds', lambda c: c.get('knot_invariant'))):
        out[k] = sum(1 for c in L if f(c))
    print(f'  TOTAL rational {out["spline_rational"]}  periodic {out["spline_periodic"]}  '
          f'trimmed {out["spline_trimmed"]}')
    strides = collections.Counter((c['rational'], c.get('stride')) for c in L)
    print(f'  controlPoints stride (isRational, len/count): '
          f'{ {("rational" if r else "polynomial"): s for (r, s) in strides} } '
          f'-- weights are INLINE, there is no separate weights field')
    print(f'  clamped/periodic knot invariant #knots == #ctrlpts + degree + 1 holds for '
          f'{out["spline_knot_invariant_holds"]} / {len(L)}')
    out['spline_stride'] = {f'{"rational" if r else "polynomial"}': s
                            for (r, s) in strides}

    LI = per.get('BTCurveGeometryInterpolatedSpline', [])
    print(f'\nBTCurveGeometryInterpolatedSpline BY INTERPOLATION-POINT COUNT '
          f'({len(LI)} instances)')
    np_ = collections.Counter(c.get('npts') for c in LI)
    for n, k in sorted(np_.items(), key=lambda kv: (kv[0] is None, kv[0]))[:12]:
        print(f'  {str(n):>4s} points {k:6d} {100.0 * k / max(len(LI), 1):6.2f}%')
    out['interp_by_npts'] = {str(k): v for k, v in np_.items()}
    out['interp_periodic'] = sum(1 for c in LI if c['periodic'])
    out['interp_with_derivs'] = sum(1 for c in LI if c.get('has_start_deriv'))
    out['interp_with_handles'] = sum(1 for c in LI if c.get('has_handles'))
    out['interp_2pt'] = sum(1 for c in LI if c.get('npts') == 2)
    print(f'  periodic {out["interp_periodic"]}  start-derivative '
          f'{out["interp_with_derivs"]}  handles {out["interp_with_handles"]}  '
          f'(of {len(LI)} -- the spec is COMPLETE and uniform on every instance)')
    print(f'  2-point (a single cubic Bezier, fully determined by the two handles) '
          f'{out["interp_2pt"]}')

    LE = per.get('BTCurveGeometryEllipse', [])
    full = sum(1 for c in LE if c.get('full'))
    degen = sum(1 for c in LE if c.get('degenerate_circle'))
    ratios = collections.Counter(c.get('ratio') for c in LE)
    print(f'\nBTCurveGeometryEllipse ({len(LE)} instances)')
    print(f'  full ellipse {full}   elliptical ARC {len(LE) - full}   '
          f'degenerate (radius == minorRadius, a circle) {degen}')
    print(f'  most common minor/major ratios '
          f'{[r for r, _ in ratios.most_common(6)]}')
    out['ellipse'] = {'instances': len(LE), 'full': full, 'arc': len(LE) - full,
                      'degenerate_circle': degen}

    LC = per.get('BTCurveGeometryConic', [])
    kd = collections.Counter(c.get('kind') for c in LC)
    npc = collections.Counter(c.get('npts') for c in LC)
    print(f'\nBTCurveGeometryConic ({len(LC)} instances) -- rational quadratic Bezier')
    print(f'  kinds by rho {dict(kd)}   control-point counts {dict(npc)}')
    out['conic'] = {'instances': len(LC), 'kinds': {str(k): v for k, v in kd.items()},
                    'npts': {str(k): v for k, v in npc.items()}}

    # ------------------------------------------------- construction-reference control
    ctl = collections.Counter()
    for m in models:
        for k, v in m['ctl'].items():
            ctl[k] += v
    print('\nCONSTRUCTION-DROP REFERENCE CONTROL (are curve entityIds ever named by a '
          'feature parameter?)')
    print(f'  NON-construction curve entities referenced {ctl["real_ref"]} / '
          f'{ctl["real_tot"]}  ({100.0 * ctl["real_ref"] / max(ctl["real_tot"], 1):.3f}%)')
    print(f'  construction     curve entities referenced {ctl["con_ref"]} / '
          f'{ctl["con_tot"]}  ({100.0 * ctl["con_ref"] / max(ctl["con_tot"], 1):.3f}%)')
    ctl_ok = ctl['real_ref'] > 0
    print(f'  control {"PASS -- the reference mechanism does fire" if ctl_ok else
                       "FAIL -- ZERO references of ANY kind were found, so this instrument "
                       "cannot tell a referenced curve from an unreferenced one. S0 is "
                       "UNPROVEN, not proven."}')
    out['construction_reference_control'] = dict(ctl)
    out['construction_reference_control_pass'] = bool(ctl_ok)

    # ------------------------------------------------------------------ STAGED RECOVERY
    print(f'\nMEASURED RECOVERY -- baseline (arm 1, 46 emittable ops) clear = {base}')
    E, C = 'BTCurveGeometryEllipse', 'BTCurveGeometryConic'
    S, I2 = 'BTCurveGeometrySpline', 'BTCurveGeometryInterpolatedSpline@2'
    stages = [
        ('S1  ELLIPSE / elliptical arc primitive      [EXACT]', (E,), False),
        ('S2  + CONIC (rational quadratic Bezier)     [EXACT]', (E, C), False),
        ('S3  + NURBS spline entity                   [EXACT]', (E, C, S), False),
        ('S4a + 2-point interpolated spline           [EXACT, cubic Bezier]',
         (E, C, S, I2), False),
        ('S4b + n>2 interpolated spline               [LOSSY, reconstructed]',
         UNREPRESENTABLE, False),
    ]
    out['stages'], prev = {}, base
    print(f'  {"stage":68s} {"clear":>6s} {"cum":>7s} {"marginal":>9s}')
    for name, rep, dc in stages:
        c = clears(models, rep, dc)
        print(f'  {name:68s} {c:6d} {c - base:+7d} {c - prev:+9d}')
        out['stages'][name] = {'clear': c, 'cumulative_recovery': c - base,
                               'marginal_recovery': c - prev}
        prev = c
    xc = clears(models, ('BTCurveGeometryEllipse', 'BTCurveGeometryConic',
                         'BTCurveGeometrySpline',
                         'BTCurveGeometryInterpolatedSpline@2'), False)
    print(f'\n  EXACT-ONLY ceiling (S1..S4a, nothing labelled lossy)  {xc}  '
          f'{xc - base:+d} of the {clears(models, UNREPRESENTABLE, False) - base} total '
          f'({100.0 * (xc - base) / max(clears(models, UNREPRESENTABLE, False) - base, 1):.1f}%)')
    out['exact_only_recovery'] = xc - base
    # the construction-drop probe is reported separately: its instrument did not verify
    cd = clears(models, (), True) - base
    print(f'  construction-drop probe (NOT part of the plan -- its reference control '
          f'FAILED): {cd:+d}')
    out['construction_drop_unproven'] = cd

    print('\n  each type ALONE (measured singly, construction-drop OFF -- so the staging '
          'order is not what makes a type look big):')
    out['singles'] = {}
    for t in UNREPRESENTABLE:
        c = clears(models, (t,), False)
        print(f'    {t:40s} +{c - base}')
        out['singles'][t] = c - base
    for lbl, rep, dc in (('ALL FOUR, construction-drop OFF', UNREPRESENTABLE, False),
                         ('construction drop ALONE', (), True),
                         ('ALL FOUR + construction drop', UNREPRESENTABLE, True)):
        c = clears(models, rep, dc)
        print(f'    {lbl:40s} +{c - base}')
        out['singles'][lbl] = c - base

    if a.json:
        with open(a.json, 'w') as fh:
            json.dump(out, fh, indent=1, sort_keys=True)
        print(f'wrote {a.json}', file=sys.stderr)


if __name__ == '__main__':
    main()
