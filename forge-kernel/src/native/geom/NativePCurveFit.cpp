// src/native/geom/NativePCurveFit.cpp — the native 2-D least-squares B-spline
// pcurve fit for a drafted plane meeting a CYLINDER (TKOffset family J).
//
// Read include/forge/native/geom/NativePCurveFit.hpp first: it carries the
// derivation, the drop hygiene, and why the error bound is measured rather than
// assumed. This file is the code.
//
// THE ONE STRUCTURAL DECISION, restated where it is implemented:
// cylinderPCurve() does NOT case-analyse the plane/cylinder arrangement to
// decide whether the pcurve is a straight line or a spline. It SAMPLES the
// relation, least-squares fits an affine model to each component, and MEASURES
// how far the data are from it. If both components are affine to 1e-12 the
// pcurve is emitted exactly; if only u is, the spline is fitted for v alone; if
// neither is, it defers. That ordering matters: a case analysis derived on
// paper is a claim, and every claim in this engine has to be re-derivable at run
// time from the numbers in front of it. It also means the two exact cases (a
// plane perpendicular to the axis -> v = const; a plane containing the axis ->
// u = const) fall out of the SAME code path with no special case to get wrong.

#ifdef FORGE_NATIVE_BREP

#include "forge/native/geom/NativePCurveFit.hpp"

#include "forge/native/geom/BSplineBasis.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

#include <ElSLib.hxx>
#include <Geom2d_BSplineCurve.hxx>
#include <Geom2d_Circle.hxx>
#include <Geom2d_Ellipse.hxx>
#include <Geom2d_Line.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Ellipse.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColgp_Array1OfPnt2d.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax22d.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Vec.hxx>

namespace forge {
namespace pcurvefit {

namespace {

using forge::bsplinebasis::basisFuns;
using forge::bsplinebasis::choleskyFactor;
using forge::bsplinebasis::choleskySolve;
using forge::bsplinebasis::findSpan;

constexpr double kPi   = 3.14159265358979323846;
constexpr double kTwoPi = 2.0 * kPi;

// The threshold below which a component of the pcurve is taken to be EXACTLY
// affine in the curve parameter. It is a parameter-space number (radians for u,
// model length for v), and it is deliberately far tighter than any tolerance a
// BRep would accept: this test decides "exact" vs "approximated", and a loose
// threshold here would let a genuine sinusoid be emitted as a straight line.
constexpr double kAffineEps = 1.0e-12;

Handle(Geom2d_BSplineCurve) buildCurve2d(const std::vector<gp_Pnt2d>& poles,
                                         const std::vector<double>&   knots,
                                         const std::vector<int>&      mults,
                                         int                          degree) {
    const int np = static_cast<int>(poles.size());
    if (np < 2 || knots.size() < 2 || knots.size() != mults.size())
        return Handle(Geom2d_BSplineCurve)();
    TColgp_Array1OfPnt2d P(1, np);
    for (int i = 0; i < np; ++i) P.SetValue(i + 1, poles[static_cast<std::size_t>(i)]);
    TColStd_Array1OfReal    K(1, static_cast<int>(knots.size()));
    TColStd_Array1OfInteger M(1, static_cast<int>(mults.size()));
    for (int i = 0; i < static_cast<int>(knots.size()); ++i)
        K.SetValue(i + 1, knots[static_cast<std::size_t>(i)]);
    for (int i = 0; i < static_cast<int>(mults.size()); ++i)
        M.SetValue(i + 1, mults[static_cast<std::size_t>(i)]);
    try {
        return new Geom2d_BSplineCurve(P, K, M, degree, Standard_False);
    } catch (const Standard_Failure&) {
        return Handle(Geom2d_BSplineCurve)();
    }
}

// A uniform CLAMPED knot vector on [t0, t1] with `nCtrl` control points of
// degree p. Uniform rather than P&T's averaged knots (eq 9.68) because the
// parameterisation here is PRESCRIBED by the 3-D curve, not chosen by the
// fitter: averaging is a device for clustering knots where chord-length
// parameters cluster, and there is nothing to cluster when the samples are
// uniform in t. Returns false if the requested net size is inadmissible.
bool uniformClampedKnots(double t0, double t1, int p, int nCtrl,
                         std::vector<double>& U) {
    const int n = nCtrl - 1;              // last control index
    if (p < 1 || nCtrl < p + 1 || t1 <= t0) return false;
    U.assign(static_cast<std::size_t>(n + p + 2), 0.0);
    for (int j = 0; j <= p; ++j) U[static_cast<std::size_t>(j)] = t0;
    for (int j = n + 1; j <= n + p + 1; ++j) U[static_cast<std::size_t>(j)] = t1;
    const int nInterior = n - p;          // interior knots
    for (int j = 1; j <= nInterior; ++j)
        U[static_cast<std::size_t>(p + j)] =
            t0 + (t1 - t0) * double(j) / double(nInterior + 1);
    return true;
}

void distinctKnots(const std::vector<double>& U,
                   std::vector<double>& kn, std::vector<int>& mu) {
    kn.clear(); mu.clear();
    for (double u : U) {
        if (kn.empty() || std::fabs(u - kn.back()) > 1e-14) { kn.push_back(u); mu.push_back(1); }
        else mu.back()++;
    }
}

// Least squares of y on t: y ~ a + b t. Returns false on a degenerate t-spread.
bool affineFit(const std::vector<double>& t, const std::vector<double>& y,
               double& a, double& b, double& maxDev) {
    const std::size_t m = t.size();
    if (m < 2 || y.size() != m) return false;
    double st = 0, sy = 0, stt = 0, sty = 0;
    for (std::size_t k = 0; k < m; ++k) { st += t[k]; sy += y[k]; stt += t[k] * t[k]; sty += t[k] * y[k]; }
    const double dm = double(m);
    const double det = dm * stt - st * st;
    if (std::fabs(det) < 1e-300) return false;
    b = (dm * sty - st * sy) / det;
    a = (sy - b * st) / dm;
    maxDev = 0.0;
    for (std::size_t k = 0; k < m; ++k)
        maxDev = std::max(maxDev, std::fabs(y[k] - (a + b * t[k])));
    return true;
}

// Wrap x into (-pi, pi].
inline double wrapPi(double x) {
    while (x >  kPi) x -= kTwoPi;
    while (x <= -kPi) x += kTwoPi;
    return x;
}

}  // namespace

// ---------------------------------------------------------------------------
// 1. THE FITTER
// ---------------------------------------------------------------------------

Handle(Geom2d_BSplineCurve) fitBSpline2dAt(const TColgp_Array1OfPnt2d& Q,
                                           const std::vector<double>&  params,
                                           int                         degree,
                                           int                         nCtrl,
                                           double&                     maxResidual) {
    maxResidual = -1.0;
    const int lo = Q.Lower();
    const int m  = Q.Length();
    const int r  = m - 1;
    if (m < 2 || static_cast<int>(params.size()) != m) return Handle(Geom2d_BSplineCurve)();
    for (int k = 1; k <= r; ++k)
        if (!(params[static_cast<std::size_t>(k)] > params[static_cast<std::size_t>(k) - 1]))
            return Handle(Geom2d_BSplineCurve)();

    const int p = degree;
    int n = nCtrl - 1;
    if (n < p) return Handle(Geom2d_BSplineCurve)();
    if (n > r) n = r;                               // never more poles than data

    const double t0 = params.front(), t1 = params.back();
    std::vector<double> U;
    if (!uniformClampedKnots(t0, t1, p, n + 1, U)) return Handle(Geom2d_BSplineCurve)();

    std::vector<gp_Pnt2d> poles(static_cast<std::size_t>(n + 1));
    const gp_Pnt2d Q0 = Q.Value(lo), Qr = Q.Value(lo + r);
    poles.front() = Q0;
    poles.back()  = Qr;

    const int I = n - 1;                            // unknown interior poles
    if (I > 0) {
        // P&T A9.6: endpoints interpolated, interior poles from the normal
        // equations of the remaining data. Two right-hand sides (x, y) share one
        // Cholesky factorisation.
        std::vector<double> NtN(static_cast<std::size_t>(I) * static_cast<std::size_t>(I), 0.0);
        std::vector<double> Rx(static_cast<std::size_t>(I), 0.0), Ry(static_cast<std::size_t>(I), 0.0);
        std::vector<double> Nb;
        for (int k = 1; k <= r - 1; ++k) {
            const double tk = params[static_cast<std::size_t>(k)];
            const int span = findSpan(n, p, tk, U);
            basisFuns(span, tk, p, U, Nb);
            double N0 = 0.0, Nn = 0.0;
            std::vector<std::pair<int, double>> row;
            for (int t = 0; t <= p; ++t) {
                const int idx = span - p + t;
                if (idx == 0)      N0 = Nb[static_cast<std::size_t>(t)];
                else if (idx == n) Nn = Nb[static_cast<std::size_t>(t)];
                else               row.emplace_back(idx - 1, Nb[static_cast<std::size_t>(t)]);
            }
            const gp_Pnt2d Qk = Q.Value(lo + k);
            const double rx = Qk.X() - N0 * Q0.X() - Nn * Qr.X();
            const double ry = Qk.Y() - N0 * Q0.Y() - Nn * Qr.Y();
            for (auto& a : row) {
                Rx[static_cast<std::size_t>(a.first)] += a.second * rx;
                Ry[static_cast<std::size_t>(a.first)] += a.second * ry;
                for (auto& b : row)
                    NtN[static_cast<std::size_t>(a.first) * static_cast<std::size_t>(I)
                        + static_cast<std::size_t>(b.first)] += a.second * b.second;
            }
        }
        std::vector<double> L = NtN;
        if (!choleskyFactor(L, I)) return Handle(Geom2d_BSplineCurve)();
        choleskySolve(L, I, Rx);
        choleskySolve(L, I, Ry);
        for (int i = 1; i <= n - 1; ++i)
            poles[static_cast<std::size_t>(i)] =
                gp_Pnt2d(Rx[static_cast<std::size_t>(i) - 1], Ry[static_cast<std::size_t>(i) - 1]);
    }

    std::vector<double> kn; std::vector<int> mu;
    distinctKnots(U, kn, mu);
    Handle(Geom2d_BSplineCurve) c = buildCurve2d(poles, kn, mu, p);
    if (c.IsNull()) return c;

    maxResidual = 0.0;
    for (int k = 0; k <= r; ++k)
        maxResidual = std::max(maxResidual,
                               c->Value(params[static_cast<std::size_t>(k)])
                                   .Distance(Q.Value(lo + k)));
    return c;
}

Handle(Geom2d_BSplineCurve) pointsToBSpline2d(const TColgp_Array1OfPnt2d& Q,
                                              const std::vector<double>&  paramsIn,
                                              int degMin, int degMax, double tol) {
    const int lo = Q.Lower();
    const int m  = Q.Length();
    const int r  = m - 1;
    if (m < 2) return Handle(Geom2d_BSplineCurve)();

    // Parameters: given, or chord length on [0,1] (what the 3-D sibling does).
    std::vector<double> params;
    if (!paramsIn.empty()) {
        if (static_cast<int>(paramsIn.size()) != m) return Handle(Geom2d_BSplineCurve)();
        params = paramsIn;
    } else {
        params.assign(static_cast<std::size_t>(m), 0.0);
        double total = 0.0;
        for (int k = 1; k <= r; ++k) total += Q.Value(lo + k).Distance(Q.Value(lo + k - 1));
        if (total <= 0.0) return Handle(Geom2d_BSplineCurve)();
        for (int k = 1; k <= r; ++k)
            params[static_cast<std::size_t>(k)] =
                params[static_cast<std::size_t>(k) - 1]
                + Q.Value(lo + k).Distance(Q.Value(lo + k - 1)) / total;
        params[static_cast<std::size_t>(r)] = 1.0;
    }
    for (int k = 1; k <= r; ++k)
        if (!(params[static_cast<std::size_t>(k)] > params[static_cast<std::size_t>(k) - 1]))
            return Handle(Geom2d_BSplineCurve)();

    int p = std::min(degMax, r);
    if (p < degMin) p = std::min(degMin, r);
    if (p < 1) p = 1;

    // The same sanity guard the 3-D sibling carries, for the same measured
    // reason: an ill-conditioned normal-equation fit at n ~ r can return poles
    // that spike far outside the data. They trace a fine curve but wreck any
    // consumer that interpolates POLES.
    double blo[2] = { 1e300, 1e300 }, bhi[2] = { -1e300, -1e300 };
    for (int k = 0; k <= r; ++k) {
        const gp_Pnt2d P = Q.Value(lo + k);
        const double c[2] = { P.X(), P.Y() };
        for (int a = 0; a < 2; ++a) { blo[a] = std::min(blo[a], c[a]); bhi[a] = std::max(bhi[a], c[a]); }
    }
    const double diag = std::sqrt((bhi[0] - blo[0]) * (bhi[0] - blo[0])
                                + (bhi[1] - blo[1]) * (bhi[1] - blo[1]));
    auto polesSane = [&](const Handle(Geom2d_BSplineCurve)& c) -> bool {
        if (c.IsNull()) return false;
        const double lim = 2.0 * diag + 1e-9;
        for (Standard_Integer i = 1; i <= c->NbPoles(); ++i) {
            const gp_Pnt2d P = c->Pole(i);
            const double cc[2] = { P.X(), P.Y() };
            for (int a = 0; a < 2; ++a)
                if (cc[a] < blo[a] - lim || cc[a] > bhi[a] + lim) return false;
        }
        return true;
    };

    Handle(Geom2d_BSplineCurve) best;
    for (int nCtrl = std::max(p + 1, (r + 4) / 4); nCtrl <= r + 1;
         nCtrl = std::min(r + 1, nCtrl + std::max(1, (r + 1 - nCtrl) / 2))) {
        double res = -1.0;
        Handle(Geom2d_BSplineCurve) fit = fitBSpline2dAt(Q, params, p, nCtrl, res);
        if (!fit.IsNull() && polesSane(fit)) {
            best = fit;
            if (res >= 0.0 && res <= tol) return fit;
        }
        if (nCtrl >= r + 1) break;
    }
    return best;   // may be null: every net size was rank-deficient or insane
}

// ---------------------------------------------------------------------------
// 2. THE EXACT SECTION
// ---------------------------------------------------------------------------

PlaneCylSection planeCylinderSection(const gp_Dir& n, double d,
                                     const gp_Ax3& cylAx, double radius,
                                     double tol) {
    PlaneCylSection out;
    if (!(radius > 0.0)) { out.defer = "the cylinder radius is not positive"; return out; }

    const gp_Dir  a  = cylAx.Direction();
    const gp_Pnt  L  = cylAx.Location();
    const double  c  = n.Dot(a);
    out.cosAxis = c;
    const double s2 = 1.0 - c * c;

    // |c| ~ 0: the plane is PARALLEL to the axis. The section is 0, 1 or 2
    // straight generatrices — each with an exact u = const pcurve, but it is not
    // one curve, and choosing a branch for the caller is exactly the kind of
    // plausible guess this engine refuses. Named, and declined.
    if (s2 >= 1.0 - tol) {
        const double dist = std::fabs(d - n.XYZ().Dot(L.XYZ()));
        if (dist > radius + tol)       { out.kind = SectionKind::None;
                                         out.defer = "the plane is parallel to the axis and misses the cylinder"; }
        else if (dist > radius - tol)  { out.kind = SectionKind::Tangent;
                                         out.defer = "the plane is parallel to the axis and tangent (one generatrix)"; }
        else                           { out.kind = SectionKind::TwoLines;
                                         out.defer = "the plane is parallel to the axis (the section is two generatrices, not one curve)"; }
        return out;
    }

    // The centre: where the axis meets the plane. |c| > 0 here, so this is safe.
    const double sPar = (d - n.XYZ().Dot(L.XYZ())) / c;
    const gp_Pnt O(L.XYZ() + sPar * a.XYZ());

    // |c| ~ 1: plane perpendicular to the axis -> a CIRCLE of radius r.
    if (s2 <= tol) {
        out.kind = SectionKind::Circle;
        // Frame: normal = the axis (== +-n here); X taken from the cylinder's own
        // frame so the section's parameterisation tracks the cylinder's u.
        out.curve = new Geom_Circle(gp_Ax2(O, a, cylAx.XDirection()), radius);
        return out;
    }

    // The general case: an ELLIPSE. semi-minor r along m = (a x n)/s,
    // semi-major r/|c| along M = (a - c n)/s. Both derived in the header; the
    // caller can re-check them numerically with sectionResidual().
    const double s = std::sqrt(s2);
    const gp_XYZ mXYZ = a.XYZ().Crossed(n.XYZ()) / s;
    const gp_XYZ MXYZ = (a.XYZ() - c * n.XYZ()) / s;
    const double A = radius / std::fabs(c);
    const double B = radius;

    // gp_Ax2(location, N, Vx): the ellipse is C(t) = O + A cos t * Vx + B sin t * Vy
    // with Vy = N x Vx. Choosing N so that N x M == m makes Vy == m exactly and
    // keeps the semi-minor direction the one the derivation names.
    gp_Dir Md(MXYZ), md(mXYZ);
    gp_Dir Nd(Md.XYZ().Crossed(md.XYZ()));
    out.kind  = SectionKind::Ellipse;
    out.curve = new Geom_Ellipse(gp_Ax2(O, Nd, Md), A, B);
    return out;
}

double sectionResidual(const PlaneCylSection& sec, const gp_Dir& n, double d,
                       const gp_Ax3& cylAx, double radius, int nSamples) {
    if (sec.curve.IsNull() || nSamples < 2) return std::numeric_limits<double>::infinity();
    const gp_Dir a = cylAx.Direction();
    const gp_Pnt L = cylAx.Location();
    const double t0 = sec.curve->FirstParameter();
    const double t1 = sec.curve->LastParameter();
    double worst = 0.0;
    for (int k = 0; k < nSamples; ++k) {
        const double t = t0 + (t1 - t0) * double(k) / double(nSamples - 1);
        const gp_Pnt P = sec.curve->Value(t);
        const gp_XYZ w = P.XYZ() - L.XYZ();
        const double axial = w.Dot(a.XYZ());
        const gp_XYZ rad = w - axial * a.XYZ();
        worst = std::max(worst, std::fabs(std::sqrt(rad.Dot(rad)) - radius));
        worst = std::max(worst, std::fabs(P.XYZ().Dot(n.XYZ()) - d));
    }
    return worst;
}

// ---------------------------------------------------------------------------
// 3. THE PCURVE
// ---------------------------------------------------------------------------

PCurveFit cylinderPCurve(const Handle(Geom_Curve)& c3, double t0, double t1,
                         const gp_Ax3& cylAx, double radius,
                         double tol3d, double uNear) {
    PCurveFit R;
    if (c3.IsNull())      { R.defer = "no 3-D curve"; return R; }
    if (!(t1 > t0))       { R.defer = "the parameter range is empty"; return R; }
    if (!(radius > 0.0))  { R.defer = "the cylinder radius is not positive"; return R; }
    if (!(tol3d > 0.0))   { R.defer = "the requested deviation bound is not positive"; return R; }

    // The audit set: dense, and deliberately OFFSET from every sample the fit
    // sees. A fit graded on its own sample points is graded on the one set where
    // a least-squares solution is guaranteed to look good.
    const int kAuditPer = 8;

    auto sampleUV = [&](int m, std::vector<double>& tt,
                        std::vector<double>& uu, std::vector<double>& vv) -> bool {
        tt.clear(); uu.clear(); vv.clear();
        tt.reserve(static_cast<std::size_t>(m));
        uu.reserve(static_cast<std::size_t>(m));
        vv.reserve(static_cast<std::size_t>(m));
        double uPrev = 0.0;
        for (int k = 0; k < m; ++k) {
            const double t = t0 + (t1 - t0) * double(k) / double(m - 1);
            gp_Pnt P;
            try { P = c3->Value(t); } catch (const Standard_Failure&) { return false; }
            Standard_Real u = 0.0, v = 0.0;
            ElSLib::CylinderParameters(cylAx, radius, P, u, v);
            // Unwrap: ElSLib returns u in [0, 2pi), and a section that crosses
            // the seam would otherwise jump by 2pi mid-edge. The unwrapped u is
            // the only one that can be affine in t.
            if (k == 0) uPrev = u;
            else { u = uPrev + wrapPi(u - uPrev); uPrev = u; }
            tt.push_back(t); uu.push_back(u); vv.push_back(v);
        }
        // Branch selection: shift the whole pcurve by the multiple of 2*pi that
        // puts u(t0) nearest `uNear`, so it lands on the same period as the
        // face's existing pcurves.
        const double shift = kTwoPi * std::round((uNear - uu.front()) / kTwoPi);
        if (shift != 0.0) for (double& u : uu) u += shift;
        return true;
    };

    // The 3-D deviation of a candidate pcurve, over the dense offset audit set.
    auto audit3d = [&](const Handle(Geom2d_Curve)& c2, int nAudit,
                       double& devU, double aU, double bU) -> double {
        devU = 0.0;
        double worst = 0.0;
        for (int k = 0; k < nAudit; ++k) {
            // half-step offset: never a fit sample, never an endpoint.
            const double t = t0 + (t1 - t0) * (double(k) + 0.5) / double(nAudit);
            gp_Pnt2d q;
            gp_Pnt   P3;
            try { q = c2->Value(t); P3 = c3->Value(t); }
            catch (const Standard_Failure&) { return std::numeric_limits<double>::infinity(); }
            const gp_Pnt S = ElSLib::CylinderValue(q.X(), q.Y(), cylAx, radius);
            worst = std::max(worst, S.Distance(P3));
            devU  = std::max(devU, std::fabs(q.X() - (aU + bU * t)));
        }
        return worst;
    };

    // --- 1. sample, and test BOTH components against an affine model ---------
    const int mProbe = 65;
    std::vector<double> tt, uu, vv;
    if (!sampleUV(mProbe, tt, uu, vv)) { R.defer = "the 3-D curve could not be evaluated"; return R; }

    double aU = 0, bU = 0, devU = 0, aV = 0, bV = 0, devV = 0;
    if (!affineFit(tt, uu, aU, bU, devU) || !affineFit(tt, vv, aV, bV, devV)) {
        R.defer = "the parameter samples are degenerate";
        return R;
    }
    // Scale the affine test: u is an angle (radians), v is a length. The
    // yardstick for v is the span the section actually covers, so the test is
    // relative and not defeated by a large model.
    double vSpan = 0.0;
    for (double v : vv) vSpan = std::max(vSpan, std::fabs(v - vv.front()));
    const double epsU = kAffineEps * std::max(1.0, std::fabs(bU) * (t1 - t0));
    const double epsV = kAffineEps * std::max(1.0, vSpan);

    // --- 2. BOTH affine -> the pcurve is a straight line. EXACT. -------------
    if (devU <= epsU && devV <= epsV) {
        const double du = bU, dv = bV;
        const double nrm = std::sqrt(du * du + dv * dv);
        Handle(Geom2d_Curve) line;
        if (nrm > 0.0 && std::fabs(nrm - 1.0) <= 1e-12) {
            line = new Geom2d_Line(gp_Pnt2d(aU, aV), gp_Dir2d(du, dv));
        } else if (nrm > 0.0) {
            // A unit-direction Geom2d_Line cannot carry a non-unit affine map at
            // the edge's own parameter. A degree-1 two-pole B-spline can, and it
            // is just as exact.
            std::vector<gp_Pnt2d> poles = { gp_Pnt2d(aU + du * t0, aV + dv * t0),
                                            gp_Pnt2d(aU + du * t1, aV + dv * t1) };
            line = buildCurve2d(poles, { t0, t1 }, { 2, 2 }, 1);
        }
        if (line.IsNull()) { R.defer = "the affine pcurve is degenerate (zero direction)"; return R; }
        double dU = 0;
        const int nAudit = kAuditPer * mProbe;
        R.curve    = line;
        R.exact    = true;
        R.degree   = 1;
        R.nPoles   = 2;
        R.nSpans   = 1;
        R.nAudit   = nAudit;
        R.maxDev3d = audit3d(line, nAudit, dU, aU, bU);
        R.maxDevU  = dU;
        if (!(R.maxDev3d <= tol3d)) {
            R.defer = "the closed-form straight pcurve did not meet the deviation bound";
            R.curve.Nullify();
        }
        return R;
    }

    // --- 3. u affine, v not -> fit. This is the sinusoid case, the blocker. --
    if (devU > epsU) {
        R.maxDevU = devU;
        R.defer = "the pcurve's u-component is not affine in the curve parameter "
                  "(the neighbour is not a cylinder, or the 3-D curve does not lie on it)";
        return R;
    }

    // Degree 5. The v-component is an entire function (a cosine), so the spline
    // error falls like h^(p+1); degree 5 reaches 1e-9 on a full half-period in a
    // handful of spans, and the adaptive loop below proves it rather than
    // trusting it.
    const int    p        = 5;
    const int    kSpanCap = 512;
    const double sweep    = t1 - t0;
    int nSpans = std::max(2, static_cast<int>(std::ceil(sweep / (0.25 * kPi))));

    for (; nSpans <= kSpanCap; nSpans *= 2) {
        const int nCtrl = nSpans + p;
        const int m     = 4 * nCtrl + 1;          // >= 4 data points per span
        std::vector<double> st, su, sv;
        if (!sampleUV(m, st, su, sv)) { R.defer = "the 3-D curve could not be evaluated"; return R; }

        TColgp_Array1OfPnt2d Q(1, m);
        for (int k = 0; k < m; ++k)
            Q.SetValue(k + 1, gp_Pnt2d(su[static_cast<std::size_t>(k)],
                                       sv[static_cast<std::size_t>(k)]));

        double res = -1.0;
        Handle(Geom2d_BSplineCurve) fit = fitBSpline2dAt(Q, st, p, nCtrl, res);
        if (fit.IsNull()) continue;               // rank-deficient at this net size

        double dU = 0;
        const int nAudit = kAuditPer * m;
        const double dev = audit3d(fit, nAudit, dU, aU, bU);

        R.curve    = fit;
        R.exact    = false;
        R.degree   = p;
        R.nPoles   = fit->NbPoles();
        R.nSpans   = nSpans;
        R.nAudit   = nAudit;
        R.maxDev3d = dev;
        R.maxDevU  = dU;

        // BOTH must hold: the geometric deviation AND the claim that the
        // u-component came through the fit exactly. The second is what makes
        // "the 3-D deviation is the scalar v error" a fact about this curve and
        // not only about the model of it.
        if (dev <= tol3d && dU <= std::max(epsU, 1e-11)) return R;
    }

    R.curve.Nullify();
    R.defer = "the pcurve fit did not reach the requested deviation bound within the span cap";
    return R;
}

Handle(Geom2d_Curve) planePCurve(const Handle(Geom_Curve)& c3,
                                 const gp_Pnt& O, const gp_Dir& px, const gp_Dir& py) {
    if (c3.IsNull()) return Handle(Geom2d_Curve)();
    auto to2d = [&](const gp_Pnt& P) {
        const gp_XYZ w = P.XYZ() - O.XYZ();
        return gp_Pnt2d(w.Dot(px.XYZ()), w.Dot(py.XYZ()));
    };
    auto dir2d = [&](const gp_Dir& D) {
        return gp_Dir2d(D.XYZ().Dot(px.XYZ()), D.XYZ().Dot(py.XYZ()));
    };
    try {
        if (Handle(Geom_Ellipse) el = Handle(Geom_Ellipse)::DownCast(c3); !el.IsNull()) {
            const gp_Ax2 ax = el->Position();
            return new Geom2d_Ellipse(
                gp_Ax22d(to2d(ax.Location()), dir2d(ax.XDirection()), dir2d(ax.YDirection())),
                el->MajorRadius(), el->MinorRadius());
        }
        if (Handle(Geom_Circle) ci = Handle(Geom_Circle)::DownCast(c3); !ci.IsNull()) {
            const gp_Ax2 ax = ci->Position();
            return new Geom2d_Circle(
                gp_Ax22d(to2d(ax.Location()), dir2d(ax.XDirection()), dir2d(ax.YDirection())),
                ci->Radius());
        }
    } catch (const Standard_Failure&) {
        return Handle(Geom2d_Curve)();
    }
    return Handle(Geom2d_Curve)();   // honest defer: not a conic this file emits
}

}  // namespace pcurvefit
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
