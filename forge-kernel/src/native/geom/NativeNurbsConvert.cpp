// forge/native/geom/NativeNurbsConvert.cpp — ROUTINE R2, see NativeNurbsConvert.hpp.
//
// Native, self-contained analytic->NURBS conversion + least-squares fit +
// planar 2D<->3D lift, replacing the TKGeomBase / TKGeomAlgo symbols in the STEP
// write/import path (blockers 1,2 of reports/TKGeomBase_drop_plan.md plus the
// GeomAPI To2d/To3d and PointsToBSpline exclusives of TKGeomAlgo).
//
// The exact rational-NURBS forms realised here are catalogued and numerically
// verified (to ~1e-15) in reports/nurbs_forms_reference.md. Where that reference
// is cited below by section (e.g. "ref sec 2"), the code reproduces that table.
//
// ===========================================================================
//  PER-CALL-SITE WIRING PLAN (orchestrator applies serially — do NOT edit the
//  call sites here; this file is AUTHOR-ONLY). Each swap keeps the OCCT symbol
//  compiled behind an #ifdef so the routine can be A/B-validated before drop.
//  Pattern at every site:
//     #ifdef FORGE_NATIVE_NURBS_CONVERT            // new default-ON gate
//       X = forge::occtconv::curveToBSpline(c);    // native
//     #else
//       X = GeomConvert::CurveToBSplineCurve(c);   // OCCT fallback (pre-drop)
//     #endif
//  A null return from the native routine = defer -> the site's existing
//  "IsNull() -> return/omit" branch already handles it (never a fake result).
//
//  1. src/native/brep/StepWriteOcct.cpp
//     :389  GeomConvert::CurveToBSplineCurve(bz)                 -> curveToBSpline(bz)
//     :397  GeomConvert::CurveToBSplineCurve(tr)  [parab/hyperb] -> curveToBSpline(tr)
//     :490  GeomConvert::CurveToBSplineCurve(tr)  [conic pcurve] -> curveToBSpline(tr)
//     :591  GeomConvert::SurfaceToBSplineSurface(bz) [Bezier]    -> surfaceToBSpline(bz)
//     :633  GeomConvert::SurfaceToBSplineSurface(win)[quadric]   -> surfaceToBSpline(win)
//     :418/:859  GeomAPI::To3d(c2, XOY)                          -> to3d(c2, XOY)
//  2. src/OcctImport.cpp
//     :324  GeomConvert::CurveToBSplineCurve(basis)  [extrusion] -> curveToBSpline(basis)
//     :505  GeomConvert::SurfaceToBSplineSurface(bz) [Bezier]    -> surfaceToBSpline(bz)
//  3. src/native/brep/StepReadOcct.cpp
//     :872  GeomAPI::To2d(c3, XOY)                               -> to2d(c3, XOY)
//     (:669/:670/:466/:468 already build Geom_BSpline* natively — no change.)
//  4. CMakeLists.txt  add_library(forge_kernel ...): add one line
//        src/native/geom/NativeNurbsConvert.cpp
//     next to src/native/brep/StepWriteOcct.cpp (same OCCT-boundary tier).
//  5. Include at each site: #include "forge/native/geom/NativeNurbsConvert.hpp".
//  6. GeomAPI_PointsToBSpline consumers (src/Airfoil.cpp:394/450, src/Features.cpp:2298)
//     are NOT TKGeomBase blockers but ARE TKGeomAlgo exclusives; swap
//        GeomAPI_PointsToBSpline(arr, dMin, dMax, cont, tol).Curve()
//     -> forge::occtconv::pointsToBSpline(arr, dMin, dMax, tol)  when TKGeomAlgo drops.
//
//  DROP GATE (per reports/TKGeomBase_drop_plan.md RISK FLAG): after wiring, the
//  true gate is Models-OS 13/13 STEP round-trip + Linux-CI "Kernel + Guards"
//  strict-link, NOT just the kernel gates. Verify the emitted B-splines round-
//  trip (write->read) within tolerance on the 13 fixtures before removing
//  TKGeomBase (then TKGeomAlgo) from OCCT_LIBS. Revert-if-red.
// ===========================================================================

#ifdef FORGE_NATIVE_BREP

#include "forge/native/geom/NativeNurbsConvert.hpp"

#include <algorithm>
#include <cmath>
#include <vector>

// ---- gp_ (TKMath) ----------------------------------------------------------
#include <gp_Ax2.hxx>
#include <gp_Ax22d.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Dir2d.hxx>
#include <gp_Elips.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Vec.hxx>
#include <gp_XYZ.hxx>

// ---- Geom_ concrete curves/surfaces (TKG3d — survive the drop) -------------
#include <Geom_BezierCurve.hxx>
#include <Geom_BezierSurface.hxx>
#include <Geom_Circle.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_Line.hxx>
#include <Geom_Plane.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <Geom_TrimmedCurve.hxx>

// ---- Geom2d_ concrete curves (TKG2d — survive the drop) --------------------
// TKG2d SYMBOL BUDGET. Every one of the kernel's TKG2d references is emitted by
// THIS translation unit (measured 2026-07-31, `nm -u` per object over the whole
// build: 36/36; Nurbs.cpp.o and NativeOcctBridge.cpp.o add only the Geom2d_Line
// ctor, which this file also references). to3d() therefore reads
// OCCT-produced pcurves through the CHEAPEST accessor that carries the same data —
// the gp_ value getters (Lin2d/Circ2d/Elips2d) and the bulk array getters
// (Poles/Knots/Multiplicities/Weights) — instead of the per-component ones. Same
// bytes, fewer imported symbols. Do NOT "simplify" these back to Location()/
// Direction()/Radius()/Pole(i)/Knot(i): each such call re-imports a TKG2d symbol.
#include <Geom2d_BSplineCurve.hxx>
#include <Geom2d_BezierCurve.hxx>
#include <Geom2d_Circle.hxx>
#include <Geom2d_Ellipse.hxx>
#include <Geom2d_Line.hxx>
#include <Geom2d_TrimmedCurve.hxx>

// ---- gp_ 2D value types (TKMath, header-inline accessors) ------------------
#include <gp_Circ2d.hxx>
#include <gp_Elips2d.hxx>
#include <gp_Lin2d.hxx>

// ---- collection arrays -----------------------------------------------------
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array2OfReal.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColgp_Array1OfPnt2d.hxx>
#include <TColgp_Array2OfPnt.hxx>

namespace {

constexpr double kHalfPi = 1.5707963267948966;       // pi/2

// ===========================================================================
//  Small pure-native numerics (no OCCT) — B-spline basis + SPD linear solve
//  used by the least-squares fitter (Piegl & Tiller, The NURBS Book).
// ===========================================================================

// P&T A2.1 — knot span index for a clamped knot vector U (last ctrl index n).
int findSpan(int n, int p, double u, const std::vector<double>& U) {
    if (u >= U[n + 1]) return n;
    if (u <= U[p]) return p;
    int low = p, high = n + 1, mid = (low + high) / 2;
    while (u < U[mid] || u >= U[mid + 1]) {
        if (u < U[mid]) high = mid; else low = mid;
        mid = (low + high) / 2;
    }
    return mid;
}

// P&T A2.2 — the p+1 nonzero basis functions N[0..p] at u in span i.
void basisFuns(int i, double u, int p, const std::vector<double>& U,
               std::vector<double>& N) {
    N.assign(p + 1, 0.0);
    N[0] = 1.0;
    std::vector<double> left(p + 1, 0.0), right(p + 1, 0.0);
    for (int j = 1; j <= p; ++j) {
        left[j]  = u - U[i + 1 - j];
        right[j] = U[i + j] - u;
        double saved = 0.0;
        for (int r = 0; r < j; ++r) {
            double denom = right[r + 1] + left[j - r];
            double temp  = (denom != 0.0) ? N[r] / denom : 0.0;
            N[r]  = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
}

// Solve the SPD system A x = b (A = m x m, row-major) by Cholesky. The same
// factorisation is reused for the x/y/z right-hand sides. Returns false on a
// non-positive pivot (rank-deficient => caller falls back to interpolation).
bool choleskyFactor(std::vector<double>& A, int m) {
    for (int i = 0; i < m; ++i) {
        for (int j = 0; j <= i; ++j) {
            double s = A[i * m + j];
            for (int k = 0; k < j; ++k) s -= A[i * m + k] * A[j * m + k];
            if (i == j) {
                if (s <= 1e-14) return false;
                A[i * m + j] = std::sqrt(s);
            } else {
                A[i * m + j] = s / A[j * m + j];
            }
        }
    }
    return true;
}
void choleskySolve(const std::vector<double>& L, int m, std::vector<double>& b) {
    for (int i = 0; i < m; ++i) {              // forward: L y = b
        double s = b[i];
        for (int k = 0; k < i; ++k) s -= L[i * m + k] * b[k];
        b[i] = s / L[i * m + i];
    }
    for (int i = m - 1; i >= 0; --i) {         // back: L^T x = y
        double s = b[i];
        for (int k = i + 1; k < m; ++k) s -= L[k * m + i] * b[k];
        b[i] = s / L[i * m + i];
    }
}

// ===========================================================================
//  Rational-quadratic arc sampling (ref sec 0.1/0.2) — the master building
//  block for every circle/ellipse curve and every revolution surface.
// ===========================================================================
struct ArcSamp {
    std::vector<double> ang;    // per-pole angle (on-pole = breakpoint, shoulder = mid)
    std::vector<double> scale;  // radial scale: 1 on-circle, 1/cos(alpha) shoulder
    std::vector<double> w;      // per-pole weight: 1 on-circle, cos(alpha) shoulder
    std::vector<double> knots;  // distinct breakpoints (natural param, radians)
    std::vector<int>    mults;  // {3,2,...,2,3}
};

// Sample the sweep [a0,a1] into n = ceil((a1-a0)/90deg) equal quadratic spans.
// Poles interleave on-circle (even) and tangent-intersection shoulders (odd);
// 2n+1 poles, degree 2. Matches OCCT Convert_TgtThetaOver2 (ref sec 9.1).
ArcSamp sampleArc(double a0, double a1) {
    ArcSamp s;
    double theta = a1 - a0;
    int n = static_cast<int>(std::ceil(theta / kHalfPi - 1e-9));
    if (n < 1) n = 1;
    double dth = theta / n, alpha = 0.5 * dth, cw = std::cos(alpha);
    for (int k = 0; k < n; ++k) {
        s.ang.push_back(a0 + k * dth);        s.scale.push_back(1.0);      s.w.push_back(1.0);
        s.ang.push_back(a0 + (k + 0.5) * dth); s.scale.push_back(1.0 / cw); s.w.push_back(cw);
    }
    s.ang.push_back(a1); s.scale.push_back(1.0); s.w.push_back(1.0);   // closing on-pole
    for (int i = 0; i <= n; ++i) s.knots.push_back(a0 + i * dth);
    s.mults.assign(n + 1, 2);
    s.mults.front() = 3; s.mults.back() = 3;
    return s;
}

inline gp_Pnt lc(const gp_Pnt& O, const gp_Dir& X, const gp_Dir& Y, const gp_Dir& Z,
                 double cx, double cy, double cz) {
    return gp_Pnt(O.XYZ() + cx * X.XYZ() + cy * Y.XYZ() + cz * Z.XYZ());
}

// ---- Geom_BSplineCurve / Surface builders from std::vector data ------------
Handle(Geom_BSplineCurve) buildCurve(const std::vector<gp_Pnt>& poles,
                                     const std::vector<double>& weights,   // empty => non-rational
                                     const std::vector<double>& knots,
                                     const std::vector<int>&    mults,
                                     int degree) {
    const int np = static_cast<int>(poles.size());
    TColgp_Array1OfPnt P(1, np);
    for (int i = 0; i < np; ++i) P.SetValue(i + 1, poles[i]);
    TColStd_Array1OfReal    K(1, static_cast<int>(knots.size()));
    TColStd_Array1OfInteger M(1, static_cast<int>(mults.size()));
    for (int i = 0; i < static_cast<int>(knots.size()); ++i) K.SetValue(i + 1, knots[i]);
    for (int i = 0; i < static_cast<int>(mults.size()); ++i) M.SetValue(i + 1, mults[i]);
    if (!weights.empty()) {
        TColStd_Array1OfReal W(1, np);
        for (int i = 0; i < np; ++i) W.SetValue(i + 1, weights[i]);
        return new Geom_BSplineCurve(P, W, K, M, degree, Standard_False);
    }
    return new Geom_BSplineCurve(P, K, M, degree, Standard_False);
}

Handle(Geom_BSplineSurface) buildSurface(const std::vector<std::vector<gp_Pnt>>& poles,
                                         const std::vector<std::vector<double>>& weights, // empty => non-rational
                                         const std::vector<double>& uKnots, const std::vector<int>& uMults,
                                         const std::vector<double>& vKnots, const std::vector<int>& vMults,
                                         int uDeg, int vDeg) {
    const int nu = static_cast<int>(poles.size());
    const int nv = static_cast<int>(poles[0].size());
    TColgp_Array2OfPnt P(1, nu, 1, nv);
    for (int i = 0; i < nu; ++i)
        for (int j = 0; j < nv; ++j) P.SetValue(i + 1, j + 1, poles[i][j]);
    TColStd_Array1OfReal    UK(1, static_cast<int>(uKnots.size())), VK(1, static_cast<int>(vKnots.size()));
    TColStd_Array1OfInteger UM(1, static_cast<int>(uMults.size())), VM(1, static_cast<int>(vMults.size()));
    for (int i = 0; i < static_cast<int>(uKnots.size()); ++i) UK.SetValue(i + 1, uKnots[i]);
    for (int i = 0; i < static_cast<int>(vKnots.size()); ++i) VK.SetValue(i + 1, vKnots[i]);
    for (int i = 0; i < static_cast<int>(uMults.size()); ++i) UM.SetValue(i + 1, uMults[i]);
    for (int i = 0; i < static_cast<int>(vMults.size()); ++i) VM.SetValue(i + 1, vMults[i]);
    if (!weights.empty()) {
        TColStd_Array2OfReal W(1, nu, 1, nv);
        for (int i = 0; i < nu; ++i)
            for (int j = 0; j < nv; ++j) W.SetValue(i + 1, j + 1, weights[i][j]);
        return new Geom_BSplineSurface(P, W, UK, VK, UM, VM, uDeg, vDeg,
                                       Standard_False, Standard_False);
    }
    return new Geom_BSplineSurface(P, UK, VK, UM, VM, uDeg, vDeg,
                                   Standard_False, Standard_False);
}

// A revolution generatrix: per v-pole distance-from-axis d, height z, weight wv,
// plus its (v) knot vector/degree. Cylinder/cone use a degree-1 line generatrix;
// sphere/torus use a rational-quadratic circle generatrix.
struct Generatrix {
    std::vector<double> d, z, wv;
    std::vector<double> knots; std::vector<int> mults; int degree;
};

// Revolve a generatrix by the u-circle `au` about frame (O;X,Y,Z) (ref sec 4-8).
// P[i][j] = O + (s_u[i]*d[j])(cos ang_u[i] X + sin ang_u[i] Y) + z[j] Z ;
// W[i][j] = w_u[i]*wv[j]. `uRational` marks the u weights non-trivial (always
// true for the revolution circle); `vRational` marks the generatrix weights.
Handle(Geom_BSplineSurface) revolve(const ArcSamp& au, const Generatrix& g,
                                    const gp_Pnt& O, const gp_Dir& X, const gp_Dir& Y,
                                    const gp_Dir& Z, bool vRational) {
    const int nu = static_cast<int>(au.ang.size());
    const int nv = static_cast<int>(g.d.size());
    std::vector<std::vector<gp_Pnt>> P(nu, std::vector<gp_Pnt>(nv));
    std::vector<std::vector<double>> W(nu, std::vector<double>(nv));
    for (int i = 0; i < nu; ++i) {
        double c = std::cos(au.ang[i]), s = std::sin(au.ang[i]), su = au.scale[i];
        for (int j = 0; j < nv; ++j) {
            double rad = su * g.d[j];
            P[i][j] = lc(O, X, Y, Z, rad * c, rad * s, g.z[j]);
            W[i][j] = au.w[i] * (vRational ? g.wv[j] : 1.0);
        }
    }
    return buildSurface(P, W, au.knots, au.mults, g.knots, g.mults, 2, g.degree);
}

// ---- individual analytic curve converters ----------------------------------

Handle(Geom_BSplineCurve) lineToBS(const Handle(Geom_Line)& ln, double f, double l) {
    std::vector<gp_Pnt> poles{ ln->Value(f), ln->Value(l) };
    return buildCurve(poles, {}, { f, l }, { 2, 2 }, 1);   // ref sec 1
}

Handle(Geom_BSplineCurve) circleToBS(const gp_Circ& c, double f, double l) {
    ArcSamp a = sampleArc(f, l);                           // ref sec 2
    const gp_Pnt O = c.Location();
    const gp_Dir X = c.XAxis().Direction(), Y = c.YAxis().Direction();
    const double r = c.Radius();
    std::vector<gp_Pnt> poles(a.ang.size());
    for (size_t i = 0; i < a.ang.size(); ++i) {
        double rad = a.scale[i] * r;
        poles[i] = gp_Pnt(O.XYZ() + (rad * std::cos(a.ang[i])) * X.XYZ()
                                  + (rad * std::sin(a.ang[i])) * Y.XYZ());
    }
    return buildCurve(poles, a.w, a.knots, a.mults, 2);
}

Handle(Geom_BSplineCurve) ellipseToBS(const gp_Elips& e, double f, double l) {
    ArcSamp a = sampleArc(f, l);                           // ref sec 3 (affine of circle)
    const gp_Pnt O = e.Location();
    const gp_Dir X = e.XAxis().Direction(), Y = e.YAxis().Direction();
    const double A = e.MajorRadius(), B = e.MinorRadius();
    std::vector<gp_Pnt> poles(a.ang.size());
    for (size_t i = 0; i < a.ang.size(); ++i) {
        double sa = a.scale[i];
        poles[i] = gp_Pnt(O.XYZ() + (sa * A * std::cos(a.ang[i])) * X.XYZ()
                                  + (sa * B * std::sin(a.ang[i])) * Y.XYZ());
    }
    return buildCurve(poles, a.w, a.knots, a.mults, 2);
}

// Bezier -> clamped B-spline (knot-insert is trivial: identical poles/weights,
// knot vector {0..0,1..1} with end multiplicity degree+1). Lossless (ref sec 10).
Handle(Geom_BSplineCurve) bezierToBS(const Handle(Geom_BezierCurve)& bz) {
    const int deg = bz->Degree(), np = bz->NbPoles();
    std::vector<gp_Pnt> poles(np);
    for (int i = 0; i < np; ++i) poles[i] = bz->Pole(i + 1);
    std::vector<double> knots{ 0.0, 1.0 };
    std::vector<int>    mults{ deg + 1, deg + 1 };
    if (bz->IsRational()) {
        std::vector<double> w(np);
        for (int i = 0; i < np; ++i) w[i] = bz->Weight(i + 1);
        return buildCurve(poles, w, knots, mults, deg);
    }
    return buildCurve(poles, {}, knots, mults, deg);
}

}  // namespace

// ===========================================================================
//  Public API
// ===========================================================================
namespace forge {
namespace occtconv {

// ---------------------------------------------------------------------------
//  MATH-VERIFICATION NOTE (task item 3 — reasoned, not built).
//
//  Full circle radius R centred at origin, frame X=(1,0,0) Y=(0,1,0):
//  sampleArc(0, 2*pi): theta/90deg = 2*pi/(pi/2) = 4 -> n = ceil(4 - 1e-9) = 4
//  spans, dth = pi/2, alpha = pi/4, cw = cos(45deg) = sqrt(2)/2.
//   * poles = 2n+1 = 9.  ang = {0, 45, 90, 135, 180, 225, 270, 315, 360} deg,
//     scale = {1, sqrt2, 1, sqrt2, 1, sqrt2, 1, sqrt2, 1} (shoulder = 1/cw = sqrt2).
//   * weights = {1, sqrt2/2, 1, sqrt2/2, 1, sqrt2/2, 1, sqrt2/2, 1}.            [MATCHES ref sec 2]
//   * distinct knots = {0, pi/2, pi, 3pi/2, 2pi} (normalised {0,1/4,1/2,3/4,1}),
//     mults = {3,2,2,2,3} -> full vector length 12 = #poles(9)+deg(2)+1.        [MATCHES ref sec 2]
//   * pole 0: rad = scale[0]*R = R, ang 0 -> O + R*cos0*X + R*sin0*Y = (R,0,0).
//     pole 1 (shoulder): rad = sqrt2*R, ang 45deg -> R*sqrt2*(cos45,sin45) = (R,R,0).  [MATCHES]
//   * Clamped end-mult 3 makes the first pole interpolatory, so
//     C(t=0) = pole0 = (R, 0, 0).                                              [VERIFIED]
//   Numeric spot-check of the rational quadratic at span midpoint (t between
//   knots 0 and pi/2): the {1, sqrt2/2, 1} weighting maps the shoulder (R,R,0)
//   to the on-circle point (R/sqrt2, R/sqrt2, 0) at 45deg, |.| = R.            [on-circle]
// ---------------------------------------------------------------------------

Handle(Geom_BSplineCurve) curveToBSpline(const Handle(Geom_Curve)& c) {
    if (c.IsNull()) return Handle(Geom_BSplineCurve)();
    // Unwrap any Geom_TrimmedCurve stack; keep the OUTERMOST [f,l] as the range.
    double f = c->FirstParameter(), l = c->LastParameter();
    Handle(Geom_Curve) basis = c;
    for (int guard = 0; guard < 8; ++guard) {
        Handle(Geom_TrimmedCurve) t = Handle(Geom_TrimmedCurve)::DownCast(basis);
        if (t.IsNull()) break;
        basis = t->BasisCurve();
    }
    try {
        if (Handle(Geom_Line) ln = Handle(Geom_Line)::DownCast(basis); !ln.IsNull())
            return lineToBS(ln, f, l);
        if (Handle(Geom_Circle) ci = Handle(Geom_Circle)::DownCast(basis); !ci.IsNull())
            return circleToBS(ci->Circ(), f, l);
        if (Handle(Geom_Ellipse) el = Handle(Geom_Ellipse)::DownCast(basis); !el.IsNull())
            return ellipseToBS(el->Elips(), f, l);
        if (Handle(Geom_BezierCurve) bz = Handle(Geom_BezierCurve)::DownCast(basis); !bz.IsNull())
            return bezierToBS(bz);
        if (Handle(Geom_BSplineCurve) bs = Handle(Geom_BSplineCurve)::DownCast(basis); !bs.IsNull()) {
            Handle(Geom_BSplineCurve) copy = Handle(Geom_BSplineCurve)::DownCast(bs->Copy());
            if (copy->IsPeriodic()) copy->SetNotPeriodic();
            copy->Segment(f, l);                 // clamp to the requested range
            return copy;
        }
        // parabola / hyperbola / offset-curve: no closed rational form in the
        // reference. Sample + least-squares fit (a faithful approximation,
        // exactly what GeomConvert does for these within tolerance). Keep the
        // OCCT fallback compiled for these until A/B-validated.
        if (l > f) {
            const int N = 33;
            TColgp_Array1OfPnt pts(1, N);
            for (int i = 0; i < N; ++i)
                pts.SetValue(i + 1, basis->Value(f + (l - f) * (double(i) / (N - 1))));
            return pointsToBSpline(pts, 3, 8, 1.0e-6);
        }
    } catch (const Standard_Failure&) {
        return Handle(Geom_BSplineCurve)();
    }
    return Handle(Geom_BSplineCurve)();
}

Handle(Geom_BSplineSurface) surfaceToBSpline(const Handle(Geom_Surface)& s) {
    if (s.IsNull()) return Handle(Geom_BSplineSurface)();
    try {
        // Bezier surface -> clamped B-spline (knot-insert, lossless).
        if (Handle(Geom_BezierSurface) bz = Handle(Geom_BezierSurface)::DownCast(s); !bz.IsNull()) {
            const int ud = bz->UDegree(), vd = bz->VDegree();
            const int nu = bz->NbUPoles(), nv = bz->NbVPoles();
            std::vector<std::vector<gp_Pnt>> P(nu, std::vector<gp_Pnt>(nv));
            std::vector<std::vector<double>> W;
            bool rat = bz->IsURational() || bz->IsVRational();
            if (rat) W.assign(nu, std::vector<double>(nv, 1.0));
            for (int i = 0; i < nu; ++i)
                for (int j = 0; j < nv; ++j) {
                    P[i][j] = bz->Pole(i + 1, j + 1);
                    if (rat) W[i][j] = bz->Weight(i + 1, j + 1);
                }
            return buildSurface(P, W, { 0.0, 1.0 }, { ud + 1, ud + 1 },
                                { 0.0, 1.0 }, { vd + 1, vd + 1 }, ud, vd);
        }

        // Determine the UV window (trim bounds if wrapped) and the analytic basis.
        double u0, u1, v0, v1;
        s->Bounds(u0, u1, v0, v1);
        Handle(Geom_Surface) basis = s;
        if (Handle(Geom_RectangularTrimmedSurface) rt =
                Handle(Geom_RectangularTrimmedSurface)::DownCast(s); !rt.IsNull())
            basis = rt->BasisSurface();
        // Guard against an unbounded window (plane / raw cyl-cone v). Honest defer.
        if (Precision::IsInfinite(u0) || Precision::IsInfinite(u1) ||
            Precision::IsInfinite(v0) || Precision::IsInfinite(v1) || u1 <= u0 || v1 <= v0)
            return Handle(Geom_BSplineSurface)();

        // Plane -> bilinear (ref sec 4): 2x2 corner poles, non-rational.
        if (Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(basis); !pl.IsNull()) {
            std::vector<std::vector<gp_Pnt>> P(2, std::vector<gp_Pnt>(2));
            P[0][0] = pl->Value(u0, v0); P[1][0] = pl->Value(u1, v0);
            P[0][1] = pl->Value(u0, v1); P[1][1] = pl->Value(u1, v1);
            return buildSurface(P, {}, { u0, u1 }, { 2, 2 }, { v0, v1 }, { 2, 2 }, 1, 1);
        }

        ArcSamp au = sampleArc(u0, u1);   // shared u-circle for every revolution

        // Cylinder -> bidegree (2,1), rational in u (ref sec 5).
        if (Handle(Geom_CylindricalSurface) cy =
                Handle(Geom_CylindricalSurface)::DownCast(basis); !cy.IsNull()) {
            const gp_Ax3 ax = cy->Position();
            const double r = cy->Radius();
            Generatrix g; g.degree = 1; g.knots = { v0, v1 }; g.mults = { 2, 2 };
            g.d = { r, r }; g.z = { v0, v1 }; g.wv = { 1.0, 1.0 };
            return revolve(au, g, ax.Location(), ax.XDirection(), ax.YDirection(),
                           ax.Direction(), /*vRational=*/false);
        }
        // Cone frustum -> bidegree (2,1), rational in u (ref sec 6).
        if (Handle(Geom_ConicalSurface) co =
                Handle(Geom_ConicalSurface)::DownCast(basis); !co.IsNull()) {
            const gp_Ax3 ax = co->Position();
            const double R = co->RefRadius(), beta = co->SemiAngle();
            Generatrix g; g.degree = 1; g.knots = { v0, v1 }; g.mults = { 2, 2 };
            g.d = { R + v0 * std::sin(beta), R + v1 * std::sin(beta) };
            g.z = { v0 * std::cos(beta), v1 * std::cos(beta) };
            g.wv = { 1.0, 1.0 };
            return revolve(au, g, ax.Location(), ax.XDirection(), ax.YDirection(),
                           ax.Direction(), /*vRational=*/false);
        }
        // Sphere -> bidegree (2,2), meridian = rational-quadratic arc (ref sec 7).
        if (Handle(Geom_SphericalSurface) sp =
                Handle(Geom_SphericalSurface)::DownCast(basis); !sp.IsNull()) {
            const gp_Ax3 ax = sp->Position();
            const double r = sp->Radius();
            ArcSamp av = sampleArc(v0, v1);
            Generatrix g; g.degree = 2; g.knots = av.knots; g.mults = av.mults;
            for (size_t j = 0; j < av.ang.size(); ++j) {
                g.d.push_back(av.scale[j] * r * std::cos(av.ang[j]));   // meridian circle, centre (0,0)
                g.z.push_back(av.scale[j] * r * std::sin(av.ang[j]));
                g.wv.push_back(av.w[j]);
            }
            return revolve(au, g, ax.Location(), ax.XDirection(), ax.YDirection(),
                           ax.Direction(), /*vRational=*/true);
        }
        // Torus -> bidegree (2,2), tube = rational-quadratic circle (ref sec 8).
        if (Handle(Geom_ToroidalSurface) to =
                Handle(Geom_ToroidalSurface)::DownCast(basis); !to.IsNull()) {
            const gp_Ax3 ax = to->Position();
            const double R = to->MajorRadius(), r = to->MinorRadius();
            ArcSamp av = sampleArc(v0, v1);
            Generatrix g; g.degree = 2; g.knots = av.knots; g.mults = av.mults;
            for (size_t j = 0; j < av.ang.size(); ++j) {
                g.d.push_back(R + av.scale[j] * r * std::cos(av.ang[j]));  // tube circle, centre (R,0)
                g.z.push_back(av.scale[j] * r * std::sin(av.ang[j]));
                g.wv.push_back(av.w[j]);
            }
            return revolve(au, g, ax.Location(), ax.XDirection(), ax.YDirection(),
                           ax.Direction(), /*vRational=*/true);
        }
        // Already a B-spline surface: clamp/copy over the window.
        if (Handle(Geom_BSplineSurface) bs =
                Handle(Geom_BSplineSurface)::DownCast(basis); !bs.IsNull()) {
            Handle(Geom_BSplineSurface) copy = Handle(Geom_BSplineSurface)::DownCast(bs->Copy());
            if (copy->IsUPeriodic()) copy->SetUNotPeriodic();
            if (copy->IsVPeriodic()) copy->SetVNotPeriodic();
            copy->Segment(u0, u1, v0, v1);       // clamp to the UV window
            return copy;
        }
    } catch (const Standard_Failure&) {
        return Handle(Geom_BSplineSurface)();
    }
    // SurfaceOfLinearExtrusion / SurfaceOfRevolution / other: the STEP writer
    // emits these directly as SURFACE_OF_* records, so a defer here is correct.
    return Handle(Geom_BSplineSurface)();
}

Handle(Geom_BSplineCurve) pointsToBSpline(const TColgp_Array1OfPnt& Q,
                                          int degMin, int degMax, double tol) {
    const int lo = Q.Lower();
    const int m  = Q.Length();          // number of data points
    if (m < 2) return Handle(Geom_BSplineCurve)();
    const int r = m - 1;                // last data index 0..r

    int p = std::min(degMax, r);
    if (p < degMin) p = std::min(degMin, r);
    if (p < 1) p = 1;

    // chord-length parameters ubar[0..r] in [0,1] (P&T eq 9.5).
    std::vector<double> ubar(m, 0.0);
    double total = 0.0;
    for (int k = 1; k <= r; ++k) total += Q.Value(lo + k).Distance(Q.Value(lo + k - 1));
    if (total <= 0.0) return Handle(Geom_BSplineCurve)();
    for (int k = 1; k <= r; ++k)
        ubar[k] = ubar[k - 1] + Q.Value(lo + k).Distance(Q.Value(lo + k - 1)) / total;
    ubar[r] = 1.0;

    auto knotsDistinct = [](const std::vector<double>& U,
                            std::vector<double>& kn, std::vector<int>& mu) {
        kn.clear(); mu.clear();
        for (double u : U) {
            if (kn.empty() || std::fabs(u - kn.back()) > 1e-12) { kn.push_back(u); mu.push_back(1); }
            else mu.back()++;
        }
    };

    // --- exact interpolation (n = r control points): averaged knots (P&T eq 9.8).
    auto interpolate = [&]() -> Handle(Geom_BSplineCurve) {
        const int n = r;                             // ctrl index 0..n
        std::vector<double> U(n + p + 2, 0.0);
        for (int j = 1; j <= n - p; ++j) {
            double s = 0.0;
            for (int i = j; i <= j + p - 1; ++i) s += ubar[i];
            U[j + p] = s / p;
        }
        for (int j = n + 1; j <= n + p + 1; ++j) U[j] = 1.0;
        // Full collocation matrix A (m x m), solve A P = Q per coordinate.
        const int M = n + 1;
        std::vector<double> A(M * M, 0.0);
        std::vector<double> Nb;
        for (int k = 0; k <= r; ++k) {
            int span = findSpan(n, p, ubar[k], U);
            basisFuns(span, ubar[k], p, U, Nb);
            for (int t = 0; t <= p; ++t) A[k * M + (span - p + t)] = Nb[t];
        }
        // Row-reduced (dense LU via Gaussian elimination with partial pivoting).
        std::vector<double> bx(M), by(M), bz(M);
        for (int k = 0; k <= r; ++k) {
            bx[k] = Q.Value(lo + k).X(); by[k] = Q.Value(lo + k).Y(); bz[k] = Q.Value(lo + k).Z();
        }
        std::vector<double> LU = A;
        std::vector<int> piv(M);
        for (int i = 0; i < M; ++i) piv[i] = i;
        for (int col = 0; col < M; ++col) {
            int best = col; double bestv = std::fabs(LU[col * M + col]);
            for (int rr = col + 1; rr < M; ++rr) {
                double v = std::fabs(LU[rr * M + col]);
                if (v > bestv) { bestv = v; best = rr; }
            }
            if (bestv < 1e-14) return Handle(Geom_BSplineCurve)();
            if (best != col) {
                for (int cc = 0; cc < M; ++cc) std::swap(LU[col * M + cc], LU[best * M + cc]);
                std::swap(bx[col], bx[best]); std::swap(by[col], by[best]); std::swap(bz[col], bz[best]);
            }
            for (int rr = col + 1; rr < M; ++rr) {
                double f2 = LU[rr * M + col] / LU[col * M + col];
                for (int cc = col; cc < M; ++cc) LU[rr * M + cc] -= f2 * LU[col * M + cc];
                bx[rr] -= f2 * bx[col]; by[rr] -= f2 * by[col]; bz[rr] -= f2 * bz[col];
            }
        }
        for (int i = M - 1; i >= 0; --i) {
            for (int cc = i + 1; cc < M; ++cc) {
                bx[i] -= LU[i * M + cc] * bx[cc]; by[i] -= LU[i * M + cc] * by[cc];
                bz[i] -= LU[i * M + cc] * bz[cc];
            }
            bx[i] /= LU[i * M + i]; by[i] /= LU[i * M + i]; bz[i] /= LU[i * M + i];
        }
        std::vector<gp_Pnt> poles(M);
        for (int i = 0; i < M; ++i) poles[i] = gp_Pnt(bx[i], by[i], bz[i]);
        std::vector<double> kn; std::vector<int> mu; knotsDistinct(U, kn, mu);
        return buildCurve(poles, {}, kn, mu, p);
    };

    // Few points, or a low target degree: interpolate (exact, residual 0).
    if (r <= p + 2) return interpolate();

    // Data extent (bbox diagonal) — used to reject an ill-conditioned fit whose
    // control polygon spikes far outside the data (those poles trace a fine curve
    // but WRECK a pole-interpolating skinner such as BRepOffsetAPI_ThruSections).
    double dblo[3] = { 1e300, 1e300, 1e300 }, dbhi[3] = { -1e300, -1e300, -1e300 };
    for (int k = 0; k <= r; ++k) {
        const gp_Pnt& P = Q.Value(lo + k);
        double c[3] = { P.X(), P.Y(), P.Z() };
        for (int a = 0; a < 3; ++a) { dblo[a] = std::min(dblo[a], c[a]); dbhi[a] = std::max(dbhi[a], c[a]); }
    }
    const double dataDiag = std::sqrt((dbhi[0]-dblo[0])*(dbhi[0]-dblo[0])
                                    + (dbhi[1]-dblo[1])*(dbhi[1]-dblo[1])
                                    + (dbhi[2]-dblo[2])*(dbhi[2]-dblo[2]));
    auto polesSane = [&](const Handle(Geom_BSplineCurve)& c) -> bool {
        if (c.IsNull()) return false;
        const double lim = 2.0 * dataDiag + 1e-9;      // no pole may sit > 2·diag from the box
        for (Standard_Integer i = 1; i <= c->NbPoles(); ++i) {
            gp_Pnt P = c->Pole(i);
            double cc[3] = { P.X(), P.Y(), P.Z() };
            for (int a = 0; a < 3; ++a)
                if (cc[a] < dblo[a] - lim || cc[a] > dbhi[a] + lim) return false;
        }
        return true;
    };

    // --- one least-squares solve with n+1 control points (P&T sec 9.4.1, alg
    //     A9.6): endpoints interpolated, interior poles from the normal equations.
    //     Returns null if the target degree/knots make N^T N rank-deficient.
    auto fitAt = [&](int n) -> Handle(Geom_BSplineCurve) {
        if (n < p + 1) n = p + 1;
        if (n > r) n = r;
        // knots (P&T eq 9.68/9.69).
        std::vector<double> U(n + p + 2, 0.0);
        double dd = double(r + 1) / double(n - p + 1);
        for (int j = 1; j <= n - p; ++j) {
            int i = int(j * dd); double alpha = j * dd - i;
            if (i < 1) i = 1; if (i > r) i = r;
            U[p + j] = (1.0 - alpha) * ubar[i - 1] + alpha * ubar[i];
        }
        for (int j = n + 1; j <= n + p + 1; ++j) U[j] = 1.0;
        const int I = n - 1;                     // # unknown interior poles
        if (I <= 0) return Handle(Geom_BSplineCurve)();
        std::vector<double> NtN(I * I, 0.0);
        std::vector<double> Rx(I, 0.0), Ry(I, 0.0), Rz(I, 0.0);
        const gp_Pnt Q0 = Q.Value(lo + 0), Qr = Q.Value(lo + r);
        std::vector<double> Nb;
        for (int k = 1; k <= r - 1; ++k) {
            int span = findSpan(n, p, ubar[k], U);
            basisFuns(span, ubar[k], p, U, Nb);
            double N0 = 0.0, Nn = 0.0;
            std::vector<std::pair<int, double>> row;
            for (int t = 0; t <= p; ++t) {
                int idx = span - p + t;
                if (idx == 0) N0 = Nb[t];
                else if (idx == n) Nn = Nb[t];
                else row.emplace_back(idx - 1, Nb[t]);
            }
            double rx = Q.Value(lo + k).X() - N0 * Q0.X() - Nn * Qr.X();
            double ry = Q.Value(lo + k).Y() - N0 * Q0.Y() - Nn * Qr.Y();
            double rz = Q.Value(lo + k).Z() - N0 * Q0.Z() - Nn * Qr.Z();
            for (auto& a : row) {
                Rx[a.first] += a.second * rx; Ry[a.first] += a.second * ry; Rz[a.first] += a.second * rz;
                for (auto& b : row) NtN[a.first * I + b.first] += a.second * b.second;
            }
        }
        std::vector<double> L = NtN;
        if (!choleskyFactor(L, I)) return Handle(Geom_BSplineCurve)();
        choleskySolve(L, I, Rx); choleskySolve(L, I, Ry); choleskySolve(L, I, Rz);
        std::vector<gp_Pnt> poles(n + 1);
        poles[0] = Q0; poles[n] = Qr;
        for (int i = 1; i <= n - 1; ++i) poles[i] = gp_Pnt(Rx[i - 1], Ry[i - 1], Rz[i - 1]);
        std::vector<double> kn; std::vector<int> mu; knotsDistinct(U, kn, mu);
        return buildCurve(poles, {}, kn, mu, p);
    };
    auto maxResidual = [&](const Handle(Geom_BSplineCurve)& fit) -> double {
        double maxr = 0.0;
        for (int k = 0; k <= r; ++k)
            maxr = std::max(maxr, fit->Value(ubar[k]).Distance(Q.Value(lo + k)));
        return maxr;
    };

    // ---------------------------------------------------------------------
    //  STRATEGY.  OCCT GeomAPI_PointsToBSpline is a SMOOTHING approximation:
    //  it keeps the SMALLEST control-net that meets the tolerance and never
    //  drifts into the ill-conditioned n≈r regime (whose control polygon
    //  spikes and ruins a pole-interpolating skinner). We mirror that: sweep n
    //  upward from a small seed, accept the FIRST fit that is within tol AND
    //  has a sane (non-spiking) control polygon. Only if no bounded fit is
    //  sane/accurate do we fall back to stable LU interpolation.
    //
    //  Why the sanity guard matters (measured): the direct normal-equation
    //  fit at n≈r-1 is ill-conditioned — Cholesky can squeak through and return
    //  poles that spike >7e4 mm off a 200 mm airfoil. Those wild poles still
    //  trace a fine CURVE (they cancel over a near-coincident knot span), so the
    //  section looked correct, but BRepOffsetAPI_ThruSections interpolates the
    //  POLES across stations, ballooning the trapezoidalWing loft 3.2x
    //  (5.11e6 vs OCCT 1.59e6). Rejecting spiking nets + keeping the largest
    //  SANE bounded net restores the loft to 1.588e6 (0.06% of OCCT).
    // ---------------------------------------------------------------------
    Handle(Geom_BSplineCurve) best;   // best sane fit so far (largest n that stayed sane)
    for (int n = std::max(p + 2, (r + 3) / 4); n <= r - 1;
         n = std::min(r - 1, n + std::max(1, (r - n) / 2))) {
        Handle(Geom_BSplineCurve) fit = fitAt(n);
        if (!fit.IsNull() && polesSane(fit)) {
            best = fit;
            if (maxResidual(fit) <= tol) return fit;   // accurate AND sane -> done
        }
        if (n >= r - 1) break;
    }
    if (!best.IsNull()) return best;   // tol not met but a sane bounded fit exists
    return interpolate();              // last resort: stable full interpolation
}

// ---- planar 2D<->3D lift (GeomAPI::To3d / To2d) ----------------------------
namespace {

inline gp_Pnt map2dTo3d(const gp_Pln& P, double x, double y) {
    const gp_Ax3 a = P.Position();
    return gp_Pnt(a.Location().XYZ() + x * a.XDirection().XYZ() + y * a.YDirection().XYZ());
}
inline gp_Vec dir2dTo3d(const gp_Pln& P, double dx, double dy) {
    const gp_Ax3 a = P.Position();
    return gp_Vec(dx * a.XDirection().XYZ() + dy * a.YDirection().XYZ());
}
inline void map3dTo2d(const gp_Pln& P, const gp_Pnt& Q, double& x, double& y) {
    const gp_Ax3 a = P.Position();
    gp_XYZ d = Q.XYZ() - a.Location().XYZ();
    x = d.Dot(a.XDirection().XYZ()); y = d.Dot(a.YDirection().XYZ());
}
inline void dir3dTo2d(const gp_Pln& P, const gp_Dir& D, double& x, double& y) {
    const gp_Ax3 a = P.Position();
    x = D.XYZ().Dot(a.XDirection().XYZ()); y = D.XYZ().Dot(a.YDirection().XYZ());
}

}  // namespace

Handle(Geom_Curve) to3d(const Handle(Geom2d_Curve)& c2, const gp_Pln& pln) {
    if (c2.IsNull()) return Handle(Geom_Curve)();
    const gp_Dir Zn = pln.Axis().Direction();          // plane normal -> 2D +Z image
    try {
        if (Handle(Geom2d_Line) ln = Handle(Geom2d_Line)::DownCast(c2); !ln.IsNull()) {
            // TKG2d symbol budget: ONE call (Lin2d) instead of Location()+Direction().
            // gp_Lin2d is a TKMath VALUE with header-inline accessors, so reading it
            // costs no further TKG2d symbol. Probe-verified identical against OCCT
            // 7.9.3 for both direct and indirect 2D frames.
            const gp_Lin2d L = ln->Lin2d();
            gp_Pnt2d o = L.Location(); gp_Dir2d d = L.Direction();
            gp_Vec dv = dir2dTo3d(pln, d.X(), d.Y());
            return new Geom_Line(map2dTo3d(pln, o.X(), o.Y()), gp_Dir(dv));
        }
        if (Handle(Geom2d_Circle) ci = Handle(Geom2d_Circle)::DownCast(c2); !ci.IsNull()) {
            // ONE call (Circ2d) instead of Radius() + Geom2d_Conic::XAxis()/YAxis()
            // (Location() was already header-inline on Geom2d_Conic). gp_Circ2d holds
            // the SAME gp_Ax22d, so the indirect (clockwise) frame that drives the
            // `sense` test below is preserved bit-for-bit — probe-verified.
            const gp_Circ2d C = ci->Circ2d();
            gp_Pnt2d o = C.Location();
            gp_Dir2d xd = C.XAxis().Direction(), yd = C.YAxis().Direction();
            // preserve 2D sense: normal = +N for a direct (CCW) frame, -N for indirect.
            double sense = xd.X() * yd.Y() - xd.Y() * yd.X();
            gp_Dir N = (sense >= 0.0) ? Zn : Zn.Reversed();
            gp_Ax2 ax(map2dTo3d(pln, o.X(), o.Y()), N, gp_Dir(dir2dTo3d(pln, xd.X(), xd.Y())));
            return new Geom_Circle(ax, C.Radius());
        }
        if (Handle(Geom2d_Ellipse) el = Handle(Geom2d_Ellipse)::DownCast(c2); !el.IsNull()) {
            // ONE call (Elips2d) instead of MajorRadius() + MinorRadius() (+ the
            // Conic::XAxis()/YAxis() pair now retired by the circle branch above).
            const gp_Elips2d E = el->Elips2d();
            gp_Pnt2d o = E.Location();
            gp_Dir2d xd = E.XAxis().Direction(), yd = E.YAxis().Direction();
            double sense = xd.X() * yd.Y() - xd.Y() * yd.X();
            gp_Dir N = (sense >= 0.0) ? Zn : Zn.Reversed();
            gp_Ax2 ax(map2dTo3d(pln, o.X(), o.Y()), N, gp_Dir(dir2dTo3d(pln, xd.X(), xd.Y())));
            return new Geom_Ellipse(ax, E.MajorRadius(), E.MinorRadius());
        }
        if (Handle(Geom2d_TrimmedCurve) tr = Handle(Geom2d_TrimmedCurve)::DownCast(c2); !tr.IsNull()) {
            Handle(Geom_Curve) b = to3d(tr->BasisCurve(), pln);
            if (b.IsNull()) return Handle(Geom_Curve)();
            return new Geom_TrimmedCurve(b, tr->FirstParameter(), tr->LastParameter());
        }
        if (Handle(Geom2d_BSplineCurve) bs = Handle(Geom2d_BSplineCurve)::DownCast(c2); !bs.IsNull()) {
            // BULK accessors: Poles()/Knots()/Multiplicities()/Weights() each cost ONE
            // TKG2d symbol and carry their own length, retiring NbPoles/Pole/NbKnots/
            // Knot/Multiplicity/Weight/IsRational (8 symbols -> 5). NCollection_Array1
            // indexing is header-inline, so the loops themselves are free.
            // Weights()==nullptr IFF !IsRational() — probe-verified against OCCT 7.9.3
            // (BSplCLib::NoWeights() == 0x0); that is what replaces the IsRational call.
            const TColgp_Array1OfPnt2d&     P = bs->Poles();
            const TColStd_Array1OfReal&     K = bs->Knots();
            const TColStd_Array1OfInteger&  M = bs->Multiplicities();
            const TColStd_Array1OfReal*     W = bs->Weights();
            const int np = P.Length(), nk = K.Length();
            std::vector<gp_Pnt> poles(np);
            for (int i = 0; i < np; ++i) {
                const gp_Pnt2d& q = P.Value(P.Lower() + i);
                poles[i] = map2dTo3d(pln, q.X(), q.Y());
            }
            std::vector<double> kn(nk); std::vector<int> mu(nk);
            for (int i = 0; i < nk; ++i) { kn[i] = K.Value(K.Lower() + i); mu[i] = M.Value(M.Lower() + i); }
            if (W) {
                std::vector<double> w(np);
                for (int i = 0; i < np; ++i) w[i] = W->Value(W->Lower() + i);
                return buildCurve(poles, w, kn, mu, bs->Degree());
            }
            return buildCurve(poles, {}, kn, mu, bs->Degree());
        }
        if (Handle(Geom2d_BezierCurve) bz = Handle(Geom2d_BezierCurve)::DownCast(c2); !bz.IsNull()) {
            // Geom2d_BezierCurve::Poles() and ::Weights() are HEADER-INLINE in OCCT
            // 7.9.3 (Geom2d_BezierCurve.hxx:266,285) — unlike the Geom2d_BSplineCurve
            // pair, they emit NO out-of-line symbol at all. Degree is poles-1 by
            // definition, so this whole branch now costs ZERO TKG2d symbols beyond the
            // typeinfo the DownCast needs (was 5: Degree/IsRational/NbPoles/Pole/Weight).
            const TColgp_Array1OfPnt2d& P = bz->Poles();
            const TColStd_Array1OfReal* W = bz->Weights();   // nullptr <=> non-rational
            const int np  = P.Length();
            const int deg = np - 1;
            std::vector<gp_Pnt> poles(np);
            for (int i = 0; i < np; ++i) {
                const gp_Pnt2d& q = P.Value(P.Lower() + i);
                poles[i] = map2dTo3d(pln, q.X(), q.Y());
            }
            std::vector<double> kn{ 0.0, 1.0 }; std::vector<int> mu{ deg + 1, deg + 1 };
            if (W) {
                std::vector<double> w(np);
                for (int i = 0; i < np; ++i) w[i] = W->Value(W->Lower() + i);
                return buildCurve(poles, w, kn, mu, deg);
            }
            return buildCurve(poles, {}, kn, mu, deg);
        }
    } catch (const Standard_Failure&) { return Handle(Geom_Curve)(); }
    return Handle(Geom_Curve)();
}

Handle(Geom2d_Curve) to2d(const Handle(Geom_Curve)& c3, const gp_Pln& pln) {
    if (c3.IsNull()) return Handle(Geom2d_Curve)();
    try {
        if (Handle(Geom_Line) ln = Handle(Geom_Line)::DownCast(c3); !ln.IsNull()) {
            double ox, oy, dx, dy; map3dTo2d(pln, ln->Lin().Location(), ox, oy);
            dir3dTo2d(pln, ln->Lin().Direction(), dx, dy);
            return new Geom2d_Line(gp_Pnt2d(ox, oy), gp_Dir2d(dx, dy));
        }
        if (Handle(Geom_Circle) ci = Handle(Geom_Circle)::DownCast(c3); !ci.IsNull()) {
            gp_Circ c = ci->Circ();
            double ox, oy, xx, xy, yx, yy; map3dTo2d(pln, c.Location(), ox, oy);
            dir3dTo2d(pln, c.XAxis().Direction(), xx, xy);
            dir3dTo2d(pln, c.YAxis().Direction(), yx, yy);
            gp_Ax22d ax(gp_Pnt2d(ox, oy), gp_Dir2d(xx, xy), gp_Dir2d(yx, yy));
            return new Geom2d_Circle(ax, c.Radius());
        }
        if (Handle(Geom_Ellipse) el = Handle(Geom_Ellipse)::DownCast(c3); !el.IsNull()) {
            gp_Elips e = el->Elips();
            double ox, oy, xx, xy, yx, yy; map3dTo2d(pln, e.Location(), ox, oy);
            dir3dTo2d(pln, e.XAxis().Direction(), xx, xy);
            dir3dTo2d(pln, e.YAxis().Direction(), yx, yy);
            gp_Ax22d ax(gp_Pnt2d(ox, oy), gp_Dir2d(xx, xy), gp_Dir2d(yx, yy));
            return new Geom2d_Ellipse(ax, e.MajorRadius(), e.MinorRadius());
        }
        if (Handle(Geom_TrimmedCurve) tr = Handle(Geom_TrimmedCurve)::DownCast(c3); !tr.IsNull()) {
            Handle(Geom2d_Curve) b = to2d(tr->BasisCurve(), pln);
            if (b.IsNull()) return Handle(Geom2d_Curve)();
            return new Geom2d_TrimmedCurve(b, tr->FirstParameter(), tr->LastParameter());
        }
        auto poles2d = [&](const std::vector<gp_Pnt>& in) {
            TColgp_Array1OfPnt2d out(1, static_cast<int>(in.size()));
            for (int i = 0; i < static_cast<int>(in.size()); ++i) {
                double x, y; map3dTo2d(pln, in[i], x, y); out.SetValue(i + 1, gp_Pnt2d(x, y));
            }
            return out;
        };
        if (Handle(Geom_BSplineCurve) bs = Handle(Geom_BSplineCurve)::DownCast(c3); !bs.IsNull()) {
            const int np = bs->NbPoles();
            std::vector<gp_Pnt> in(np);
            for (int i = 0; i < np; ++i) in[i] = bs->Pole(i + 1);
            TColgp_Array1OfPnt2d P2 = poles2d(in);
            TColStd_Array1OfReal    K(1, bs->NbKnots());
            TColStd_Array1OfInteger M(1, bs->NbKnots());
            for (int i = 0; i < bs->NbKnots(); ++i) { K.SetValue(i + 1, bs->Knot(i + 1)); M.SetValue(i + 1, bs->Multiplicity(i + 1)); }
            if (bs->IsRational()) {
                TColStd_Array1OfReal W(1, np);
                for (int i = 0; i < np; ++i) W.SetValue(i + 1, bs->Weight(i + 1));
                return Handle(Geom2d_Curve)(new Geom2d_BSplineCurve(P2, W, K, M, bs->Degree(), Standard_False));
            }
            return Handle(Geom2d_Curve)(new Geom2d_BSplineCurve(P2, K, M, bs->Degree(), Standard_False));
        }
        if (Handle(Geom_BezierCurve) bz = Handle(Geom_BezierCurve)::DownCast(c3); !bz.IsNull()) {
            const int np = bz->NbPoles();
            std::vector<gp_Pnt> in(np);
            for (int i = 0; i < np; ++i) in[i] = bz->Pole(i + 1);
            TColgp_Array1OfPnt2d P2 = poles2d(in);
            if (bz->IsRational()) {
                TColStd_Array1OfReal W(1, np);
                for (int i = 0; i < np; ++i) W.SetValue(i + 1, bz->Weight(i + 1));
                return Handle(Geom2d_Curve)(new Geom2d_BezierCurve(P2, W));
            }
            return Handle(Geom2d_Curve)(new Geom2d_BezierCurve(P2));
        }
    } catch (const Standard_Failure&) { return Handle(Geom2d_Curve)(); }
    return Handle(Geom2d_Curve)();
}

}  // namespace occtconv
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
