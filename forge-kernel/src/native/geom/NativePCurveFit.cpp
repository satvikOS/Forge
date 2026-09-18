// src/native/geom/NativePCurveFit.cpp — the native 2-D least-squares B-spline
// pcurve fit for a drafted plane meeting a CYLINDER (TKOffset family J).
//
// Read include/forge/native/geom/NativePCurveFit.hpp first: it carries the
// derivation, the drop hygiene, and why the error bound is measured rather than
// assumed. This file is the code.
//
// ★ T-154: THIS TRANSLATION UNIT INCLUDES NO OCCT HEADER AND HAS NO
//   `#ifdef FORGE_NATIVE_BREP` GUARD. It used to have both, and the pair was
//   lethal in combination: the guard made a bare compile build an EMPTY file
//   that returned 0 (two invalid "it compiles" measurements are recorded in
//   README.NativePCurveFit.rescue.md), while the OCCT includes made every
//   OCCT-free pass over `src/native` fail outright. The arithmetic below is
//   byte-for-byte the arithmetic that was here; only the CARRIER types changed.
//   Callers that need Handle(Geom_Curve) / Handle(Geom2d_Curve) go through
//   src/PCurveFitOcctBridge.cpp.
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

#include "forge/native/geom/NativePCurveFit.hpp"

#include "forge/native/geom/BSplineBasis.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>

namespace forge {
namespace pcurvefit {

namespace {

using forge::bsplinebasis::basisFuns;
using forge::bsplinebasis::choleskyFactor;
using forge::bsplinebasis::choleskySolve;
using forge::bsplinebasis::findSpan;

constexpr double kPi    = 3.14159265358979323846;
constexpr double kTwoPi = 2.0 * kPi;

// The threshold below which a component of the pcurve is taken to be EXACTLY
// affine in the curve parameter. It is a parameter-space number (radians for u,
// model length for v), and it is deliberately far tighter than any tolerance a
// BRep would accept: this test decides "exact" vs "approximated", and a loose
// threshold here would let a genuine sinusoid be emitted as a straight line.
constexpr double kAffineEps = 1.0e-12;

inline double dist2d(const Pnt2d& a, const Pnt2d& b) {
    const double dx = a.x - b.x, dy = a.y - b.y;
    return std::sqrt(dx * dx + dy * dy);
}

// Expand (distinct knots, multiplicities) into the full knot vector the basis
// routines take. Returns false when the expansion is not a legal clamped vector
// for `degree` and `nPoles`.
bool expandKnots(const std::vector<double>& kn, const std::vector<int>& mu,
                 int degree, int nPoles, std::vector<double>& U) {
    if (kn.size() < 2 || kn.size() != mu.size() || degree < 1 || nPoles < degree + 1)
        return false;
    U.clear();
    for (std::size_t i = 0; i < kn.size(); ++i) {
        if (mu[i] < 1) return false;
        for (int r = 0; r < mu[i]; ++r) U.push_back(kn[i]);
    }
    return U.size() == static_cast<std::size_t>(nPoles + degree + 1);
}

// de Boor via the shared basis functions. `U` is the EXPANDED knot vector.
Pnt2d evalAt(const std::vector<Pnt2d>& poles, const std::vector<double>& U,
             int degree, double t) {
    const int n = static_cast<int>(poles.size()) - 1;
    const double lo = U[static_cast<std::size_t>(degree)];
    const double hi = U[static_cast<std::size_t>(n + 1)];
    if (t < lo) t = lo;
    if (t > hi) t = hi;
    const int span = findSpan(n, degree, t, U);
    std::vector<double> N;
    basisFuns(span, t, degree, U, N);
    Pnt2d out;
    for (int j = 0; j <= degree; ++j) {
        const std::size_t idx = static_cast<std::size_t>(span - degree + j);
        out.x += N[static_cast<std::size_t>(j)] * poles[idx].x;
        out.y += N[static_cast<std::size_t>(j)] * poles[idx].y;
    }
    return out;
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
// 0. THE NATIVE CARRIERS
// ---------------------------------------------------------------------------

bool BSpline2d::valid() const {
    if (degree < 1) return false;
    if (poles.size() < 2) return false;
    if (knots.size() < 2 || knots.size() != mults.size()) return false;
    std::vector<double> U;
    return expandKnots(knots, mults, degree, static_cast<int>(poles.size()), U);
}

double BSpline2d::first() const { return knots.empty() ? 0.0 : knots.front(); }
double BSpline2d::last()  const { return knots.empty() ? 0.0 : knots.back(); }

Pnt2d BSpline2d::value(double t) const {
    std::vector<double> U;
    if (!expandKnots(knots, mults, degree, static_cast<int>(poles.size()), U)) return Pnt2d{};
    return evalAt(poles, U, degree, t);
}

Vec3 Conic3::value(double t) const {
    return centre + xdir * (a * std::cos(t)) + ydir * (b * std::sin(t));
}

double Conic3::last() const { return kTwoPi; }

Pnt2d PCurve2d::value(double t) const {
    if (!valid) return Pnt2d{};
    if (line) return Pnt2d{ origin.x + dir.x * t, origin.y + dir.y * t };
    return spline.value(t);
}

// ---------------------------------------------------------------------------
// 1. THE FITTER
// ---------------------------------------------------------------------------

BSpline2d fitBSpline2dAt(const std::vector<Pnt2d>&  Q,
                         const std::vector<double>& params,
                         int                        degree,
                         int                        nCtrl,
                         double&                    maxResidual) {
    maxResidual = -1.0;
    const int m = static_cast<int>(Q.size());
    const int r = m - 1;
    if (m < 2 || static_cast<int>(params.size()) != m) return BSpline2d{};
    for (int k = 1; k <= r; ++k)
        if (!(params[static_cast<std::size_t>(k)] > params[static_cast<std::size_t>(k) - 1]))
            return BSpline2d{};

    const int p = degree;
    int n = nCtrl - 1;
    if (n < p) return BSpline2d{};
    if (n > r) n = r;                               // never more poles than data

    const double t0 = params.front(), t1 = params.back();
    std::vector<double> U;
    if (!uniformClampedKnots(t0, t1, p, n + 1, U)) return BSpline2d{};

    std::vector<Pnt2d> poles(static_cast<std::size_t>(n + 1));
    const Pnt2d Q0 = Q.front(), Qr = Q[static_cast<std::size_t>(r)];
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
            const Pnt2d Qk = Q[static_cast<std::size_t>(k)];
            const double rx = Qk.x - N0 * Q0.x - Nn * Qr.x;
            const double ry = Qk.y - N0 * Q0.y - Nn * Qr.y;
            for (auto& a : row) {
                Rx[static_cast<std::size_t>(a.first)] += a.second * rx;
                Ry[static_cast<std::size_t>(a.first)] += a.second * ry;
                for (auto& b : row)
                    NtN[static_cast<std::size_t>(a.first) * static_cast<std::size_t>(I)
                        + static_cast<std::size_t>(b.first)] += a.second * b.second;
            }
        }
        std::vector<double> L = NtN;
        if (!choleskyFactor(L, I)) return BSpline2d{};
        choleskySolve(L, I, Rx);
        choleskySolve(L, I, Ry);
        for (int i = 1; i <= n - 1; ++i)
            poles[static_cast<std::size_t>(i)] =
                Pnt2d{ Rx[static_cast<std::size_t>(i) - 1], Ry[static_cast<std::size_t>(i) - 1] };
    }

    BSpline2d c;
    c.degree = p;
    c.poles  = poles;
    distinctKnots(U, c.knots, c.mults);
    if (!c.valid()) return BSpline2d{};

    maxResidual = 0.0;
    for (int k = 0; k <= r; ++k)
        maxResidual = std::max(maxResidual,
                               dist2d(evalAt(c.poles, U, p, params[static_cast<std::size_t>(k)]),
                                      Q[static_cast<std::size_t>(k)]));
    return c;
}

BSpline2d pointsToBSpline2d(const std::vector<Pnt2d>&  Q,
                            const std::vector<double>& paramsIn,
                            int degMin, int degMax, double tol) {
    const int m = static_cast<int>(Q.size());
    const int r = m - 1;
    if (m < 2) return BSpline2d{};

    // Parameters: given, or chord length on [0,1] (what the 3-D sibling does).
    std::vector<double> params;
    if (!paramsIn.empty()) {
        if (static_cast<int>(paramsIn.size()) != m) return BSpline2d{};
        params = paramsIn;
    } else {
        params.assign(static_cast<std::size_t>(m), 0.0);
        double total = 0.0;
        for (int k = 1; k <= r; ++k)
            total += dist2d(Q[static_cast<std::size_t>(k)], Q[static_cast<std::size_t>(k) - 1]);
        if (total <= 0.0) return BSpline2d{};
        for (int k = 1; k <= r; ++k)
            params[static_cast<std::size_t>(k)] =
                params[static_cast<std::size_t>(k) - 1]
                + dist2d(Q[static_cast<std::size_t>(k)], Q[static_cast<std::size_t>(k) - 1]) / total;
        params[static_cast<std::size_t>(r)] = 1.0;
    }
    for (int k = 1; k <= r; ++k)
        if (!(params[static_cast<std::size_t>(k)] > params[static_cast<std::size_t>(k) - 1]))
            return BSpline2d{};

    int p = std::min(degMax, r);
    if (p < degMin) p = std::min(degMin, r);
    if (p < 1) p = 1;

    // The same sanity guard the 3-D sibling carries, for the same measured
    // reason: an ill-conditioned normal-equation fit at n ~ r can return poles
    // that spike far outside the data. They trace a fine curve but wreck any
    // consumer that interpolates POLES.
    double blo[2] = { 1e300, 1e300 }, bhi[2] = { -1e300, -1e300 };
    for (int k = 0; k <= r; ++k) {
        const Pnt2d P = Q[static_cast<std::size_t>(k)];
        const double c[2] = { P.x, P.y };
        for (int a = 0; a < 2; ++a) { blo[a] = std::min(blo[a], c[a]); bhi[a] = std::max(bhi[a], c[a]); }
    }
    const double diag = std::sqrt((bhi[0] - blo[0]) * (bhi[0] - blo[0])
                                + (bhi[1] - blo[1]) * (bhi[1] - blo[1]));
    auto polesSane = [&](const BSpline2d& c) -> bool {
        if (!c.valid()) return false;
        const double lim = 2.0 * diag + 1e-9;
        for (const Pnt2d& P : c.poles) {
            const double cc[2] = { P.x, P.y };
            for (int a = 0; a < 2; ++a)
                if (cc[a] < blo[a] - lim || cc[a] > bhi[a] + lim) return false;
        }
        return true;
    };

    BSpline2d best;
    for (int nCtrl = std::max(p + 1, (r + 4) / 4); nCtrl <= r + 1;
         nCtrl = std::min(r + 1, nCtrl + std::max(1, (r + 1 - nCtrl) / 2))) {
        double res = -1.0;
        BSpline2d fit = fitBSpline2dAt(Q, params, p, nCtrl, res);
        if (fit.valid() && polesSane(fit)) {
            best = fit;
            if (res >= 0.0 && res <= tol) return fit;
        }
        if (nCtrl >= r + 1) break;
    }
    return best;   // may be invalid: every net size was rank-deficient or insane
}

// ---------------------------------------------------------------------------
// 2. THE EXACT SECTION
// ---------------------------------------------------------------------------

PlaneCylSection planeCylinderSection(const Vec3& n, double d,
                                     const Ax3& cylAx, double radius,
                                     double tol) {
    PlaneCylSection out;
    if (!(radius > 0.0)) { out.defer = "the cylinder radius is not positive"; return out; }

    const Vec3   a  = cylAx.dir;
    const Vec3   L  = cylAx.loc;
    const double c  = n.dot(a);
    out.cosAxis = c;
    const double s2 = 1.0 - c * c;

    // |c| ~ 0: the plane is PARALLEL to the axis. The section is 0, 1 or 2
    // straight generatrices — each with an exact u = const pcurve, but it is not
    // one curve, and choosing a branch for the caller is exactly the kind of
    // plausible guess this engine refuses. Named, and declined.
    if (s2 >= 1.0 - tol) {
        const double dist = std::fabs(d - n.dot(L));
        if (dist > radius + tol)       { out.kind = SectionKind::None;
                                         out.defer = "the plane is parallel to the axis and misses the cylinder"; }
        else if (dist > radius - tol)  { out.kind = SectionKind::Tangent;
                                         out.defer = "the plane is parallel to the axis and tangent (one generatrix)"; }
        else                           { out.kind = SectionKind::TwoLines;
                                         out.defer = "the plane is parallel to the axis (the section is two generatrices, not one curve)"; }
        return out;
    }

    // The centre: where the axis meets the plane. |c| > 0 here, so this is safe.
    const double sPar = (d - n.dot(L)) / c;
    const Vec3   O    = L + a * sPar;

    // |c| ~ 1: plane perpendicular to the axis -> a CIRCLE of radius r.
    if (s2 <= tol) {
        // Frame: normal = the axis (== +-n here); X taken from the cylinder's own
        // frame so the section's parameterisation tracks the cylinder's u. This
        // reproduces gp_Ax2(O, a, cylAx.XDirection()) exactly: gp_Ax2 orthogonalises
        // the given X against the main direction and takes Y = N ^ X.
        Vec3 X = cylAx.xdir - a * cylAx.xdir.dot(a);
        if (!X.normalize()) {
            out.defer = "the cylinder frame's X direction is parallel to its axis";
            return out;
        }
        out.kind          = SectionKind::Circle;
        out.curve.valid   = true;
        out.curve.circle  = true;
        out.curve.centre  = O;
        out.curve.xdir    = X;
        out.curve.ydir    = a.cross(X);
        out.curve.a       = radius;
        out.curve.b       = radius;
        return out;
    }

    // The general case: an ELLIPSE. semi-minor r along m = (a x n)/s,
    // semi-major r/|c| along M = (a - c n)/s. Both derived in the header; the
    // caller can re-check them numerically with sectionResidual().
    const double s = std::sqrt(s2);
    Vec3 md = a.cross(n) / s;
    Vec3 Md = (a - n * c) / s;
    if (!md.normalize() || !Md.normalize()) {
        out.defer = "the plane/cylinder frame degenerated";
        return out;
    }
    const double A = radius / std::fabs(c);
    const double B = radius;

    // The OCCT form was gp_Ax2(O, Nd, Md) with Nd = Md x md, which yields
    // XDirection == Md and YDirection == Nd x Md == md. Carrying Md and md
    // directly is the same frame with the intermediate step removed.
    out.kind         = SectionKind::Ellipse;
    out.curve.valid  = true;
    out.curve.circle = false;
    out.curve.centre = O;
    out.curve.xdir   = Md;
    out.curve.ydir   = md;
    out.curve.a      = A;
    out.curve.b      = B;
    return out;
}

double sectionResidual(const PlaneCylSection& sec, const Vec3& n, double d,
                       const Ax3& cylAx, double radius, int nSamples) {
    if (!sec.curve.valid || nSamples < 2) return std::numeric_limits<double>::infinity();
    const Vec3 a = cylAx.dir;
    const Vec3 L = cylAx.loc;
    const double t0 = sec.curve.first();
    const double t1 = sec.curve.last();
    double worst = 0.0;
    for (int k = 0; k < nSamples; ++k) {
        const double t = t0 + (t1 - t0) * double(k) / double(nSamples - 1);
        const Vec3 P = sec.curve.value(t);
        const Vec3 w = P - L;
        const double axial = w.dot(a);
        const Vec3 rad = w - a * axial;
        worst = std::max(worst, std::fabs(std::sqrt(rad.dot(rad)) - radius));
        worst = std::max(worst, std::fabs(P.dot(n) - d));
    }
    return worst;
}

// ---------------------------------------------------------------------------
// 3. THE PCURVE
// ---------------------------------------------------------------------------

PCurveFit cylinderPCurve(const Curve3dEval& c3, double t0, double t1,
                         const Ax3& cylAx, double radius,
                         double tol3d, double uNear) {
    PCurveFit R;
    if (!c3)              { R.defer = "no 3-D curve"; return R; }
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
            Vec3 P;
            if (!c3(t, P)) return false;
            double u = 0.0, v = 0.0;
            cylinderParameters(cylAx, radius, P, u, v);
            // Unwrap: cylinderParameters returns u in [0, 2pi), and a section
            // that crosses the seam would otherwise jump by 2pi mid-edge. The
            // unwrapped u is the only one that can be affine in t.
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
    auto audit3d = [&](const PCurve2d& c2, int nAudit,
                       double& devU, double aU, double bU) -> double {
        devU = 0.0;
        double worst = 0.0;
        for (int k = 0; k < nAudit; ++k) {
            // half-step offset: never a fit sample, never an endpoint.
            const double t = t0 + (t1 - t0) * (double(k) + 0.5) / double(nAudit);
            Vec3 P3;
            if (!c3(t, P3)) return std::numeric_limits<double>::infinity();
            const Pnt2d q = c2.value(t);
            const Vec3  S = cylinderValue(q.x, q.y, cylAx, radius);
            worst = std::max(worst, S.distance(P3));
            devU  = std::max(devU, std::fabs(q.x - (aU + bU * t)));
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
        if (!(nrm > 0.0)) { R.defer = "the affine pcurve is degenerate (zero direction)"; return R; }

        // The affine map t -> (aU + du t, aV + dv t). `dir` is deliberately NOT
        // normalised: the pcurve must share the 3-D curve's parameter, and the
        // OCCT bridge picks Geom2d_Line vs a degree-1 two-pole B-spline from
        // exactly this — a unit-direction Geom2d_Line cannot carry a non-unit
        // affine map, a degree-1 B-spline can, and it is just as exact.
        PCurve2d line;
        line.valid  = true;
        line.line   = true;
        line.origin = Pnt2d{ aU, aV };
        line.dir    = Pnt2d{ du, dv };
        line.tFirst = t0;
        line.tLast  = t1;

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
            R.curve = PCurve2d{};
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

        std::vector<Pnt2d> Q(static_cast<std::size_t>(m));
        for (int k = 0; k < m; ++k)
            Q[static_cast<std::size_t>(k)] = Pnt2d{ su[static_cast<std::size_t>(k)],
                                                    sv[static_cast<std::size_t>(k)] };

        double res = -1.0;
        BSpline2d fit = fitBSpline2dAt(Q, st, p, nCtrl, res);
        if (!fit.valid()) continue;               // rank-deficient at this net size

        PCurve2d cand;
        cand.valid  = true;
        cand.line   = false;
        cand.spline = fit;
        cand.tFirst = fit.first();
        cand.tLast  = fit.last();

        double dU = 0;
        const int nAudit = kAuditPer * m;
        const double dev = audit3d(cand, nAudit, dU, aU, bU);

        R.curve    = cand;
        R.exact    = false;
        R.degree   = p;
        R.nPoles   = fit.nPoles();
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

    R.curve = PCurve2d{};
    R.defer = "the pcurve fit did not reach the requested deviation bound within the span cap";
    return R;
}

Conic2 planePCurve(const Conic3& c3, const Vec3& O, const Vec3& px, const Vec3& py) {
    Conic2 out;
    if (!c3.valid) return out;
    auto to2d = [&](const Vec3& P) {
        const Vec3 w = P - O;
        return Pnt2d{ w.dot(px), w.dot(py) };
    };
    // gp_Dir2d normalises and REFUSES a null vector; the same refusal, made
    // explicit, is what keeps a conic whose frame does not lie in this plane
    // from being emitted as a plausible wrong pcurve.
    auto dir2d = [&](const Vec3& D, Pnt2d& q) -> bool {
        const double x = D.dot(px), y = D.dot(py);
        const double n = std::sqrt(x * x + y * y);
        if (!(n > 1.0e-15)) return false;
        q = Pnt2d{ x / n, y / n };
        return true;
    };
    Pnt2d X, Y;
    if (!dir2d(c3.xdir, X) || !dir2d(c3.ydir, Y)) return out;
    out.valid  = true;
    out.circle = c3.circle;
    out.centre = to2d(c3.centre);
    out.xdir   = X;
    out.ydir   = Y;
    out.a      = c3.a;
    out.b      = c3.b;
    return out;
}

// ---------------------------------------------------------------------------
// 4. THE CYLINDER'S OWN PARAMETERISATION — the native ElSLib
// ---------------------------------------------------------------------------

void cylinderParameters(const Ax3& cylAx, double /*radius*/, const Vec3& p,
                        double& u, double& v) {
    const Vec3 w = p - cylAx.loc;
    const double x = w.dot(cylAx.xdir);
    const double y = w.dot(cylAx.ydir);
    u = std::atan2(y, x);
    // ElSLib's exact seam handling, transcribed: a u just below zero is lifted
    // by a full turn, and a u inside the negative epsilon band is clamped to 0
    // rather than to 2pi. Reproducing the band matters — the two rules differ by
    // a whole period on points that sit exactly on the seam.
    if (u < -1.0e-16) u += kTwoPi;
    else if (u < 0.0) u = 0.0;
    v = w.dot(cylAx.dir);
}

Vec3 cylinderValue(double u, double v, const Ax3& cylAx, double radius) {
    return cylAx.loc
         + cylAx.xdir * (radius * std::cos(u))
         + cylAx.ydir * (radius * std::sin(u))
         + cylAx.dir  * v;
}

}  // namespace pcurvefit
}  // namespace forge
