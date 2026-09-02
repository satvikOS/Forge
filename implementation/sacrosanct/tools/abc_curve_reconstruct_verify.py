#!/usr/bin/env python3
"""Does the PROPOSED IR curve representation actually reproduce the corpus curve?

abc_curve_entity_census.py measures how many models a curve entity would unblock. It says
nothing about whether the representation is FAITHFUL, and "548 models recovered" is worthless
if they come back the wrong shape. This tool measures fidelity, because the decision the
census feeds -- which representation to build, and which one has to be LABELLED lossy --
turns on which rebuilds are exact and which are reconstructions.

THE INSTRUMENT: ENDPOINT COINCIDENCE
------------------------------------
A sketch profile is a CLOSED CHAIN. Each segment's endpoint is shared with its neighbour's,
and the two are stored independently -- a line as (point, direction, arc-length range), a
spline as (control points, knots, parameter range). So "does my rebuilt spline end where the
adjoining line begins" is a real question with a real answer, and it is not a tautology:
nothing in the line's record was used to build the spline.

Every entity is rebuilt through OCCT from ONLY the fields the proposed IR would carry, then
evaluated at its own startParam / endParam. For each endpoint we find the nearest endpoint
belonging to a DIFFERENT entity in the same sketch.

  LINE and CIRCLE are the POSITIVE CONTROL. They are exactly representable today, so their
  coincidence rate is this corpus's own connectivity baseline -- how often sketches close at
  all. A curve type that matches that baseline is read correctly; one that falls below it is
  not, and a low rate EVERYWHERE would mean the parameter conventions are wrong and no
  number here means anything.

THE REBUILDS
  BTCurveGeometrySpline             -> Geom2d_BSplineCurve            claim: EXACT (a copy)
  BTCurveGeometryConic              -> rational quadratic Bezier,
                                       w = rho/(1-rho)                claim: EXACT (closed form)
  BTCurveGeometryEllipse            -> Geom2d_Ellipse                 claim: EXACT (closed form)
  BTCurveGeometryInterpolatedSpline -> Geom2dAPI_Interpolate          claim: RECONSTRUCTED

NEGATIVE CONTROL. Rational splines are re-read with the WRONG stride (2 instead of 3, so
weights are mistaken for coordinates) and with weights forced to 1. If the instrument cannot
separate those from the correct read, it certifies nothing, and the run says so.

Tolerance 1e-9 m. Coordinates are in metres and parts are ~1e-2 m, so this is ~1e-7 relative
-- far below any manufacturing meaning, far above float64 noise.

LICENCE: corpus provenance UNVERIFIED (MODEL_DATA.md); a capability measurement only.

Usage
-----
  python3 abc_curve_reconstruct_verify.py --extracted <dir> [--limit N] [--json out.json]
"""
import argparse, collections, glob, json, math, os, sys
from multiprocessing import Pool

try:
    import yaml
    from yaml import CSafeLoader as Loader
except ImportError:
    sys.exit('needs PyYAML with libyaml (CSafeLoader)')

from OCP.gp import gp_Pnt2d, gp_Dir2d, gp_Ax22d, gp_Vec2d
from OCP.Geom2d import Geom2d_BSplineCurve, Geom2d_Ellipse, Geom2d_Circle, Geom2d_Line
from OCP.Geom2dAPI import Geom2dAPI_Interpolate, Geom2dAPI_ProjectPointOnCurve
from OCP.TColgp import TColgp_Array1OfPnt2d, TColgp_HArray1OfPnt2d
from OCP.TColStd import TColStd_Array1OfReal, TColStd_Array1OfInteger

TOL = 1e-9
KINDS = ('BTCurveGeometrySpline', 'BTCurveGeometryConic', 'BTCurveGeometryEllipse',
         'BTCurveGeometryInterpolatedSpline')
CONTROL = ('BTCurveGeometryLine', 'BTCurveGeometryCircle')


def pairs(flat, stride):
    return [(flat[i], flat[i + 1]) for i in range(0, len(flat) - stride + 1, stride)]


def knots_to_mults(knots):
    """OCCT wants distinct knots + multiplicities; Onshape ships the flat repeated vector."""
    ks, ms = [], []
    for k in knots:
        if ks and abs(k - ks[-1]) <= 1e-12 * max(1.0, abs(k)):
            ms[-1] += 1
        else:
            ks.append(float(k))
            ms.append(1)
    return ks, ms


def _a_pnt(pts):
    a = TColgp_Array1OfPnt2d(1, len(pts))
    for i, (x, y) in enumerate(pts, 1):
        a.SetValue(i, gp_Pnt2d(x, y))
    return a


def _a_real(v):
    a = TColStd_Array1OfReal(1, len(v))
    for i, x in enumerate(v, 1):
        a.SetValue(i, float(x))
    return a


def _a_int(v):
    a = TColStd_Array1OfInteger(1, len(v))
    for i, x in enumerate(v, 1):
        a.SetValue(i, int(x))
    return a


def _ax(g):
    return gp_Ax22d(gp_Pnt2d(g['xCenter'], g['yCenter']),
                    gp_Dir2d(g['xDir'], g['yDir']), not bool(g.get('clockwise')))


# ------------------------------------------------------------------------- the rebuilds
def build_spline(g, stride=None, unit_weights=False):
    """The proposed SNURBS entity: degree, control points, weights, knots, periodic flag."""
    deg = int(g['degree'])
    rational = bool(g.get('isRational'))
    st = stride if stride is not None else (3 if rational else 2)
    cp = g['controlPoints']
    ncp = int(g.get('controlPointCount') or len(cp) // st)
    poles = pairs(cp, st)[:ncp]
    if len(poles) != ncp:
        raise ValueError(f'poles {len(poles)} != controlPointCount {ncp}')
    w = None
    if rational and st == 3:
        w = [1.0] * ncp if unit_weights else [cp[i * 3 + 2] for i in range(ncp)]
    ks, ms = knots_to_mults(g['knots'])
    # MEASURED, and NOT what the field name suggests: Onshape's knot vector always satisfies
    # the NON-periodic relation sum(mults) == #poles + degree + 1 (6,555 / 6,555), and
    # `isPeriodic` marks a CLOSED curve, not an OCCT-style periodic one -- a closed instance
    # is shipped as a clamped B-spline whose first and last poles coincide. Passing
    # periodic=True to OCCT asks it for a different pole count and it refuses. So the flag
    # is carried in the IR as "this curve closes" and the curve is built non-periodic.
    if w:
        return Geom2d_BSplineCurve(_a_pnt(poles), _a_real(w), _a_real(ks), _a_int(ms),
                                   deg, False)
    return Geom2d_BSplineCurve(_a_pnt(poles), _a_real(ks), _a_int(ms), deg, False)


def build_conic(g):
    """A conic IS a rational quadratic Bezier: 3 poles, knots [0,1] mults [3,3],
    weights [1, rho/(1-rho), 1]. Closed form, no approximation."""
    p = pairs(g['points'], 2)
    if len(p) != 3:
        raise ValueError(f'conic with {len(p)} points')
    rho = float(g['rho'])
    return Geom2d_BSplineCurve(_a_pnt(p), _a_real([1.0, rho / (1.0 - rho), 1.0]),
                               _a_real([0.0, 1.0]), _a_int([3, 3]), 2, False)


def build_ellipse(g):
    r, mr = float(g['radius']), float(g['minorRadius'])
    return Geom2d_Ellipse(_ax(g), max(r, mr), min(r, mr))


def build_interp(g):
    """RECONSTRUCTED, not read: the standard C2 cubic interpolant through the shipped
    points, clamped with the shipped end derivatives."""
    pts = pairs(g['interpolationPoints'], 2)
    if len(pts) < 2:
        raise ValueError('interpolated spline with <2 points')
    h = TColgp_HArray1OfPnt2d(1, len(pts))
    for i, (x, y) in enumerate(pts, 1):
        h.SetValue(i, gp_Pnt2d(x, y))
    per = bool(g.get('isPeriodic'))
    itp = Geom2dAPI_Interpolate(h, per, 1e-12)
    if not per and 'startDerivativeX' in g:
        itp.Load(gp_Vec2d(g['startDerivativeX'], g['startDerivativeY']),
                 gp_Vec2d(g['endDerivativeX'], g['endDerivativeY']), False)
    itp.Perform()
    if not itp.IsDone():
        raise ValueError('interpolation did not converge')
    return itp.Curve()


def build_line(g):
    return Geom2d_Line(gp_Pnt2d(g['pntX'], g['pntY']), gp_Dir2d(g['dirX'], g['dirY']))


def build_circle(g):
    return Geom2d_Circle(_ax(g), float(g['radius']))


BUILD = {'BTCurveGeometrySpline': build_spline, 'BTCurveGeometryConic': build_conic,
         'BTCurveGeometryEllipse': build_ellipse,
         'BTCurveGeometryInterpolatedSpline': build_interp,
         'BTCurveGeometryLine': build_line, 'BTCurveGeometryCircle': build_circle}


def endpoints(c, sp, ep):
    """Evaluate at the segment's own parameter range, clamped into the curve's domain."""
    f, l = c.FirstParameter(), c.LastParameter()
    out = []
    for t in (sp, ep):
        if t is None:
            return None
        if not c.IsPeriodic():
            t = min(max(t, f), l)
        p = c.Value(t)
        out.append((p.X(), p.Y()))
    return out


def walk(lst, out):
    for f in lst or []:
        m = f.get('message') or {}
        if m.get('featureType') is None:
            continue
        out.append(m)
        if m.get('subFeatures'):
            walk(m['subFeatures'], out)


def one(path):
    try:
        with open(path, 'rb') as fh:
            doc = yaml.load(fh, Loader=Loader)
    except Exception:
        return None
    if not isinstance(doc, dict):
        return None
    feats = []
    walk(doc.get('features'), feats)
    r = {'coin': collections.defaultdict(list), 'built': collections.Counter(),
         'seen': collections.Counter(), 'err': collections.Counter(),
         'ipts': [], 'itan': [], 'ihnd': [], 'neg': collections.defaultdict(list)}
    for m in feats:
        ents = m.get('entities') or []
        rec = []          # (gtype, [P_start, P_end], entity_index)
        for idx, e in enumerate(ents):
            em = e.get('message') or {}
            g = em.get('geometry') or {}
            gt, gm = g.get('typeName'), (g.get('message') or {})
            if gt not in BUILD:
                continue
            r['seen'][gt] += 1
            try:
                c = BUILD[gt](gm)
            except Exception as ex:
                r['err'][f'{gt} | {type(ex).__name__}: {str(ex)[:70]}'] += 1
                continue
            r['built'][gt] += 1
            eps = endpoints(c, em.get('startParam'), em.get('endParam'))
            if eps:
                rec.append((gt, eps, idx))

            if gt == 'BTCurveGeometryInterpolatedSpline':
                # does the reconstruction pass through every point it was given?
                # PROJECTION, not sampling: a 64-point scan measures the sampling step,
                # not the distance, and reported 4.7e-06 where the true figure is 1e-17.
                for x, y in pairs(gm['interpolationPoints'], 2):
                    r['ipts'].append(_proj(c, x, y))
                if not gm.get('isPeriodic') and 'startDerivativeX' in gm:
                    # (a) end-tangent DIRECTION vs the shipped derivative
                    for t, dx, dy in ((c.FirstParameter(), gm['startDerivativeX'],
                                       gm['startDerivativeY']),
                                      (c.LastParameter(), gm['endDerivativeX'],
                                       gm['endDerivativeY'])):
                        p, v = gp_Pnt2d(), gp_Vec2d()
                        c.D1(t, p, v)
                        n1, n2 = math.hypot(v.X(), v.Y()), math.hypot(dx, dy)
                        if n1 > 1e-14 and n2 > 1e-14:
                            cs = (v.X() * dx + v.Y() * dy) / (n1 * n2)
                            r['itan'].append(abs(math.acos(max(-1.0, min(1.0, cs)))))
                    # (b) the shipped Bezier HANDLES. This is the discriminating test: the
                    # handle is the first inner Bezier control point, P0 + (h/3)*C'(t0)
                    # where h is the FIRST KNOT SPAN. Direction alone cannot see a
                    # reparameterisation; the handle can, because its distance from the
                    # endpoint is set by the interior knot spacing.
                    if c.NbKnots() >= 2:
                        for kt, sgn, hx, hy in (
                                (c.Knot(2) - c.Knot(1), 1.0,
                                 gm['startHandleX'], gm['startHandleY']),
                                (c.Knot(c.NbKnots()) - c.Knot(c.NbKnots() - 1), -1.0,
                                 gm['endHandleX'], gm['endHandleY'])):
                            t = c.FirstParameter() if sgn > 0 else c.LastParameter()
                            p, v = gp_Pnt2d(), gp_Vec2d()
                            c.D1(t, p, v)
                            r['ihnd'].append(math.hypot(
                                p.X() + sgn * v.X() * kt / 3.0 - hx,
                                p.Y() + sgn * v.Y() * kt / 3.0 - hy))

            # NEGATIVE CONTROL: re-read rational splines wrongly
            if gt == 'BTCurveGeometrySpline' and gm.get('isRational') and eps:
                for lbl, kw in (('stride2', {'stride': 2}), ('unitw', {'unit_weights': True})):
                    try:
                        c2 = BUILD[gt](gm, **kw)
                        e2 = endpoints(c2, em.get('startParam'), em.get('endParam'))
                        if e2:
                            r['neg'][lbl].append(max(math.dist(a, b)
                                                     for a, b in zip(eps, e2)))
                        else:
                            r['neg'][lbl + '_noeval'].append(0.0)
                    except Exception:
                        r['neg'][lbl + '_refused'].append(0.0)

        # ---- endpoint coincidence within this sketch
        for gt, eps, idx in rec:
            for p in eps:
                best = min((math.dist(p, q)
                            for gt2, eps2, idx2 in rec if idx2 != idx for q in eps2),
                           default=None)
                if best is not None:
                    r['coin'][gt].append(best)
    return {'coin': {k: v for k, v in r['coin'].items()}, 'built': dict(r['built']),
            'seen': dict(r['seen']), 'err': dict(r['err']), 'ipts': r['ipts'],
            'itan': r['itan'], 'ihnd': r['ihnd'], 'neg': {k: v for k, v in r['neg'].items()}}


def _proj(c, x, y):
    """True distance from a point to the curve, by projection -- never by sampling."""
    try:
        pr = Geom2dAPI_ProjectPointOnCurve(gp_Pnt2d(x, y), c)
        if pr.NbPoints() == 0:
            return float('inf')
        return pr.LowerDistance()
    except Exception:
        return float('inf')


def stats(v):
    if not v:
        return None
    v = sorted(v)
    return {'n': len(v), 'median': v[len(v) // 2], 'p95': v[min(len(v) - 1, int(len(v) * .95))],
            'max': v[-1]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--extracted', required=True)
    ap.add_argument('--limit', type=int, default=0, help='files to scan (0 = all)')
    ap.add_argument('--jobs', type=int, default=8)
    ap.add_argument('--json')
    a = ap.parse_args()

    files = sorted(glob.glob(os.path.join(a.extracted, '*', '*.yml')))
    if a.limit and a.limit < len(files):
        step = len(files) / a.limit          # STRIDE, never a prefix: the corpus is ordered
        files = [files[int(i * step)] for i in range(a.limit)]
    print(f'scanning {len(files)} files', file=sys.stderr)
    with Pool(a.jobs) as p:
        res = [x for x in p.map(one, files, chunksize=8) if x]

    coin, built, seen = collections.defaultdict(list), collections.Counter(), collections.Counter()
    err, ipts, itan, ihnd = collections.Counter(), [], [], []
    neg = collections.defaultdict(list)
    for r in res:
        for k, v in r['coin'].items():
            coin[k].extend(v)
        built.update(r['built'])
        seen.update(r['seen'])
        err.update(r['err'])
        ipts.extend(r['ipts'])
        itan.extend(r['itan'])
        ihnd.extend(r['ihnd'])
        for k, v in r['neg'].items():
            neg[k].extend(v)

    out = {'files_scanned': len(files), 'tolerance_m': TOL,
           'licence': 'corpus provenance UNVERIFIED (MODEL_DATA.md)'}

    print(f'\nREBUILD -- does OCCT accept the data the proposed IR would carry?')
    print(f'  {"type":36s} {"seen":>7s} {"built":>7s} {"rate":>8s}')
    out['rebuild'] = {}
    for k in CONTROL + KINDS:
        s, b = seen.get(k, 0), built.get(k, 0)
        print(f'  {k:36s} {s:7d} {b:7d} {(100.0 * b / s if s else 0):7.2f}%'
              + ('   <- positive control' if k in CONTROL else ''))
        out['rebuild'][k] = {'seen': s, 'built': b}
    for e, n in err.most_common(6):
        print(f'    build error x{n}: {e}')
    out['build_errors'] = dict(err)

    print(f'\nENDPOINT COINCIDENCE -- distance from each rebuilt endpoint to the nearest '
          f'endpoint of a DIFFERENT entity in the same sketch (tolerance {TOL} m)')
    print(f'  {"type":36s} {"endpoints":>10s} {"within tol":>11s} {"rate":>8s} '
          f'{"median":>10s}')
    out['coincidence'] = {}
    for k in CONTROL + KINDS:
        v = coin.get(k, [])
        ok = sum(1 for d in v if d <= TOL)
        st_ = stats(v)
        print(f'  {k:36s} {len(v):10d} {ok:11d} '
              f'{(100.0 * ok / len(v) if v else 0):7.2f}% '
              f'{(f"{st_['median']:.2e}" if st_ else "-"):>10s}'
              + ('   <- positive control' if k in CONTROL else ''))
        out['coincidence'][k] = {'endpoints': len(v), 'within_tol': ok,
                                 'rate': (ok / len(v) if v else None), 'deviation_m': st_}

    print('\nINTERPOLATED SPLINE -- the reconstruction, checked against its own inputs')
    s1 = stats(ipts)
    print(f'  passes through its interpolation points  '
          f'{sum(1 for d in ipts if d <= 1e-6)} / {len(ipts)} within 1e-6 m'
          + (f'   median {s1["median"]:.2e}  max {s1["max"]:.2e}' if s1 else ''))
    s2 = stats(itan)
    print(f'  end-tangent DIRECTION vs the shipped derivative  '
          f'{sum(1 for d in itan if d <= 1e-6)} / {len(itan)} within 1e-6 rad'
          + (f'   median {s2["median"]:.2e}  max {s2["max"]:.2e} rad' if s2 else ''))
    s3 = stats(ihnd)
    print(f'  shipped Bezier HANDLE position (the discriminating test -- it sees a '
          f'reparameterisation that direction alone cannot)')
    print(f'    {sum(1 for d in ihnd if d <= TOL)} / {len(ihnd)} within {TOL} m'
          + (f'   median {s3["median"]:.2e}  p95 {s3["p95"]:.2e}  max {s3["max"]:.2e} m'
             if s3 else ''))
    out['interpolated'] = {'through_points_m': s1, 'end_tangent_rad': s2,
                           'handle_m': s3,
                           'through_points_pass_1e6': sum(1 for d in ipts if d <= 1e-6),
                           'through_points_n': len(ipts),
                           'end_tangent_pass_1e6': sum(1 for d in itan if d <= 1e-6),
                           'end_tangent_n': len(itan),
                           'handle_pass_tol': sum(1 for d in ihnd if d <= TOL),
                           'handle_n': len(ihnd)}

    print(f'\nNEGATIVE CONTROL on rational splines -- can this instrument SEE a wrong read?')
    print('  (endpoint displacement caused by deliberately misreading the weights)')
    out['negative_control'] = {}
    for lbl, name in (('stride2', 'WRONG stride 2 (weights read as coordinates)'),
                      ('unitw', 'WRONG weights forced to 1.0')):
        v, s_ = neg.get(lbl, []), stats(neg.get(lbl, []))
        moved = sum(1 for d in v if d > TOL)
        print(f'  {name:44s} moved {moved:4d}/{len(v):4d}'
              + (f'  median {s_["median"]:.2e}  max {s_["max"]:.2e} m' if s_ else ''))
        print(f'  {"":44s} builds REFUSED {len(neg.get(lbl + "_refused", []))}')
        out['negative_control'][lbl] = {
            'moved_beyond_tol': moved, 'n': len(v), 'displacement_m': s_,
            'builds_refused': len(neg.get(lbl + '_refused', []))}

    if a.json:
        with open(a.json, 'w') as fh:
            json.dump(out, fh, indent=1, sort_keys=True, default=str)
        print(f'wrote {a.json}', file=sys.stderr)


if __name__ == '__main__':
    main()
