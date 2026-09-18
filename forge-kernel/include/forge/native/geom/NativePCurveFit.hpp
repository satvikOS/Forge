// forge/native/geom/NativePCurveFit.hpp — the NATIVE 2-D least-squares B-spline
// pcurve fit, and the exact plane-cylinder section that needs it.
//
// ROUTINE (kernel OCCT-zero drop plan, TKOffset FAMILY J — DRAFT). This file is
// the named blocker of reports/DRAFT_NATIVE_ENGINE.md section 5, and nothing more:
//
//     "The entire remaining gap to OCCT is 73 parts, and every one is a drafted
//      plane meeting a CYLINDER. ... What blocks it is the pcurve on the
//      cylinder. On the cylinder's own (u, v) parameterisation that section is
//      v(u) = a + b cos u + c sin u, a sinusoid. No Geom2d conic represents it,
//      so it must be approximated."
//
// ===========================================================================
// ★ T-154: THIS HEADER IS OCCT-FREE, AND THAT IS THE POINT OF IT
// ===========================================================================
// It used to include SEVEN OCCT headers (Geom2d_BSplineCurve, Geom2d_Curve,
// Geom_Curve, TColgp_Array1OfPnt2d, gp_Ax3, gp_Dir, gp_Pnt) and RETURN OCCT
// types. That made it a PRODUCER OF OCCT TYPES living inside `src/native` — the
// subtree whose gates assert OCCT-freedom — and it disabled every one of them:
// six "compile the native tree OCCT-free" builders exited 1 at their first step.
//
// The algorithm never needed OCCT. Piegl & Tiller ch. 9 is arithmetic; OCCT was
// only the CARRIER of the inputs and results. So the carrier changed and the
// arithmetic did not:
//
//   * gp_Pnt/gp_Dir      -> forge::math::Vec3   (header-only, already native)
//   * gp_Ax3             -> pcurvefit::Ax3      (loc, dir, xdir AND ydir — see
//                           the note on left-handed frames at its declaration)
//   * TColgp_Array1OfPnt2d -> std::vector<Pnt2d>
//   * Handle(Geom_Curve) input -> Curve3dEval, a `bool(double t, Vec3& p)`
//                           evaluator. ANY curve ANY kernel can evaluate can now
//                           be fitted; that is strictly more general than a
//                           Handle, and it is what makes the fit kernel-free.
//   * Handle(Geom2d_BSplineCurve)/Handle(Geom2d_Curve) -> BSpline2d / PCurve2d
//   * Geom_Circle/Geom_Ellipse -> Conic3
//   * ElSLib::CylinderParameters/CylinderValue -> cylinderParameters/cylinderValue
//                           below, transcribed from the closed form OCCT itself
//                           uses (the `U < -1e-16` branch included, so the two
//                           agree bit for bit on the seam).
//
// CALLERS THAT WANT OCCT TYPES USE THE BRIDGE: forge/PCurveFitOcctBridge.hpp
// exposes `forge::pcurvefit::occt::` with the EXACT signatures this header used
// to carry, converting at the boundary and nowhere else. `NativeDraftLocal.cpp`
// — the only caller in the tree — uses it, because a BRep edge genuinely needs a
// Handle(Geom_Curve) to be built on.
//
// ★ AND THE GUARD IS GONE. This file used to sit entirely inside
//   `#ifdef FORGE_NATIVE_BREP`, so a compile without that define built an EMPTY
//   translation unit and returned 0 for ever — a trap that produced TWO invalid
//   "it compiles" measurements, recorded in
//   src/native/geom/README.NativePCurveFit.rescue.md. The guard existed because
//   of OCCT. With OCCT gone the guard is gone, and the native pcurve fit is now
//   compiled FOR REAL by every OCCT-free pass over `src/native`. That is the
//   measurable difference: the symbol `forge::pcurvefit::cylinderPCurve` is now
//   emitted by an OCCT-free compile, and the six restored builders assert it.
//
// ===========================================================================
// WHY IT IS NATIVE AND NOT `Geom2dAPI_PointsToBSpline`
// ===========================================================================
// OCCT's own approximator lives in TKGeomAlgo, and its `GeomAPI` / `GeomConvert`
// neighbours in TKGeomBase. Those two toolkits are in OCCT_CLOSURE today as
// FREE RIDERS: the kernel has NO reference of its own left to either, so they
// leave at drop steps 5 and 6 for nothing (reports/OCCT_DROP_ORDER.md s4.2).
// One call to `Geom2dAPI_PointsToBSpline` from here would convert two zero-cost
// closure points into two funded work items and no other gate in the build would
// notice.
//
// ★ CORRECTION (T-154): the previous text of this paragraph said
//   "`test/run_ab_native_pcurve_fit.sh` asserts 0 TKGeomBase and 0 TKGeomAlgo
//   imports on THIS translation unit's object file". THAT SCRIPT DOES NOT EXIST
//   and never did — `ls forge-kernel/test/run_ab_native_pcurve_fit.sh` is a
//   no-such-file. A header that cites its own guard by name, and names one that
//   was never written, is the quiet-instrument failure this program keeps
//   paying for. The claim now rests on something real: this translation unit
//   includes NO OCCT header at all, which every one of the six OCCT-free
//   builders compiles and proves, and `test/run_pcurve_fit_gate.sh` asserts
//   directly.
//
// ===========================================================================
// THE GEOMETRY, DERIVED — AND WHY THE FIT IS SCALAR, NOT PLANAR
// ===========================================================================
// Plane {n . x = d} (n unit), cylinder (Ax3 frame with axis a, radius r),
// c = n . a, s = sqrt(1 - c^2).
//
//   * |c| = 1  -> the plane is PERPENDICULAR to the axis: the section is a
//                 CIRCLE and the pcurve is the straight line v = const. EXACT.
//   * |c| = 0  -> the plane CONTAINS the axis direction: the section is two
//                 straight lines (or one tangent line, or empty). Each pcurve is
//                 u = const. EXACT, but it is not one curve, so this file
//                 reports the kind and DEFERS rather than guessing a branch.
//   * else     -> an ELLIPSE, in closed form:
//                    centre O    = where the axis meets the plane
//                    minor dir m = (a x n)/s ,           semi-minor B = r
//                    major dir M = (a - c n)/s ,         semi-major A = r/|c|
//                 C3(t) = O + A cos t . M + B sin t . m
//                 VERIFIED algebraically, not assumed: the distance of C3(t)
//                 from the axis is A^2 c^2 cos^2 t + B^2 sin^2 t = r^2 for all
//                 t, and C3(t) . n = d for all t. Both are re-checked
//                 NUMERICALLY at run time by sectionResidual().
//
// The pcurve of that ellipse on the cylinder is, exactly:
//
//        u(t) = alpha -/+ t                (AFFINE in t, slope exactly -/+1)
//        v(t) = v0 + (r s / |c|) cos t     (a pure COSINE — the sinusoid)
//
// That is the report's `v = a + b cos u + c sin u` written in the ellipse's own
// parameter t instead of the cylinder's u. It matters here for two reasons:
//
//   1. u(t) is DEGREE 1, so ANY B-spline basis of degree >= 1 reproduces it
//      EXACTLY. Only v is approximated.
//   2. On a cylinder, a pcurve deviation (du, dv) displaces the 3-D point by
//      exactly sqrt( (2 r sin(du/2))^2 + dv^2 ). With du = 0 the 3-D deviation
//      IS |dv|. So the scalar residual of the v-fit is not a proxy for the
//      geometric error — it is equal to it. The bound is therefore asserted on
//      the quantity that matters, and audited in 3-D anyway (see below).
//
// ===========================================================================
// THE BOUND IS MEASURED, NEVER ASSUMED
// ===========================================================================
// Every fit returns `maxDev3d`: the maximum over a DENSE AUDIT SET — 8x the fit
// sample count and deliberately OFFSET from it, so a fit that merely
// interpolates its own samples cannot score zero — of
//
//        | S_cylinder( C2(t) )  -  C3(t) |     in millimetres
//
// The span count is doubled until that number is <= the caller's tolerance, and
// if the cap is reached the fit DEFERS with a named reason. A pcurve whose
// deviation was never measured is exactly the "plausible wrong shape" the draft
// engine refuses to emit; this one carries its own error bar.
//
// An INVALID return is an HONEST DEFER and `PCurveFit::defer` names the guard.

#ifndef FORGE_NATIVE_GEOM_NATIVEPCURVEFIT_HPP
#define FORGE_NATIVE_GEOM_NATIVEPCURVEFIT_HPP

#include <functional>
#include <string>
#include <vector>

#include "forge/math/Vec3.hpp"

namespace forge {
namespace pcurvefit {

using forge::math::Vec3;

// ---------------------------------------------------------------------------
// 0. THE NATIVE CARRIERS
// ---------------------------------------------------------------------------

// A point in a surface's own (u, v) parameter space.
struct Pnt2d {
    double x = 0.0;
    double y = 0.0;
};

// A cylinder's placement frame — the native stand-in for gp_Ax3.
//
// ★ `ydir` IS STORED, NOT DERIVED, and that is deliberate. gp_Ax3 may be
//   LEFT-handed: its YDirection() is `dir ^ xdir` for a direct frame and the
//   NEGATIVE of that for an indirect one. Deriving y = dir x xdir here would
//   silently mirror the u parameterisation of every indirect cylinder — a wrong
//   pcurve that looks perfectly well-formed. The bridge fills this from
//   `gp_Ax3::YDirection()` so the handedness survives the conversion.
struct Ax3 {
    Vec3 loc  {0.0, 0.0, 0.0};
    Vec3 dir  {0.0, 0.0, 1.0};   // the cylinder axis (unit)
    Vec3 xdir {1.0, 0.0, 0.0};   // unit, perpendicular to dir
    Vec3 ydir {0.0, 1.0, 0.0};   // unit, = +/- (dir x xdir); see above
};

// A 2-D B-spline curve: poles, DISTINCT knots and their multiplicities.
//
// ★ `valid()` VALIDATES, it does not merely count. A knot vector is UNTRUSTED
//   INPUT the moment it comes from a parsed file, and the first version of this
//   carrier checked only "multiplicity >= 1" and the expanded length. MEASURED on
//   that version: a NaN knot returned `valid() == true` and `value()` returned
//   (nan, nan) — NON-FINITE COORDINATES from a curve calling itself valid — and a
//   DECREASING knot vector returned a plausible, wrong (10, 0).
//
//   That is the defect class T-153 tracks: 30 runtime `assert()` sites under
//   `src/native` guarding degenerate weights and cusps from parsed STEP. Under
//   NDEBUG an assert is not a guard — the arithmetic runs on +-inf/NaN; without
//   NDEBUG it aborts. Neither is a refusal, so this REFUSES BY RETURN VALUE, which
//   behaves identically in every build.
//
//   THE CONTRACT — non-periodic and CLAMPED, which is all this carrier represents:
//     * degree >= 1, and at least degree + 1 poles, every pole FINITE;
//     * `knots` are DISTINCT, hence STRICTLY INCREASING, and every one FINITE;
//     * the first and last multiplicity are EXACTLY degree + 1 (clamped);
//     * interior multiplicities lie in [1, degree] — degree + 1 inside would split
//       the curve in two, which this carrier does not represent;
//     * the multiplicities sum to nPoles + degree + 1.
//   `value()` applies the SAME guard and returns Pnt2d{} on refusal, so a caller
//   that skipped `valid()` cannot reach the basis functions with a vector
//   `valid()` would have refused.
struct BSpline2d {
    int                 degree = 0;
    std::vector<Pnt2d>  poles;
    std::vector<double> knots;   // distinct, strictly increasing
    std::vector<int>    mults;   // parallel to `knots`

    bool   valid() const;
    double first() const;        // knots.front(); 0 when invalid
    double last()  const;        // knots.back();  0 when invalid
    int    nPoles() const { return static_cast<int>(poles.size()); }
    Pnt2d  value(double t) const;   // de Boor via the shared BSplineBasis
};

// A conic in space — the native stand-in for Geom_Circle / Geom_Ellipse.
// C(t) = centre + a cos(t) * xdir + b sin(t) * ydir , t in [0, 2pi].
// For a circle a == b == radius. `xdir` and `ydir` are unit and orthogonal, so
// the bridge can rebuild the exact gp_Ax2 the OCCT form needs from them alone.
struct Conic3 {
    bool   valid  = false;
    bool   circle = false;
    Vec3   centre;
    Vec3   xdir;
    Vec3   ydir;
    double a = 0.0;   // semi-major (circle: the radius)
    double b = 0.0;   // semi-minor (circle: the radius)

    Vec3   value(double t) const;
    double first() const { return 0.0; }
    double last()  const;             // 2*pi
};

// A conic in a surface's (u, v) — the native stand-in for Geom2d_Circle /
// Geom2d_Ellipse. Same convention as Conic3, one dimension down.
struct Conic2 {
    bool   valid  = false;
    bool   circle = false;
    Pnt2d  centre;
    Pnt2d  xdir;
    Pnt2d  ydir;
    double a = 0.0;
    double b = 0.0;
};

// ---------------------------------------------------------------------------
// 1. THE 2-D SIBLING of forge::occtconv::pointsToBSpline (NativeNurbsConvert).
//    Piegl & Tiller, The NURBS Book ch. 9: endpoints interpolated, interior
//    poles from the normal equations, native SPD (Cholesky) solve, control-net
//    size escalated until the residual meets `tol`.
//
//    `params` is the parameter of each point. A PCURVE MUST SHARE ITS 3-D
//    CURVE'S PARAMETERISATION, so this overload takes them explicitly and the
//    resulting curve's first()/last() are params.front()/back().
//    Pass an empty vector for chord-length parametrisation on [0,1], which is
//    what the 3-D sibling does.
//
//    Invalid => fewer than 2 points, a non-increasing parameter vector, or a
//    rank-deficient normal matrix at every attempted net size.
BSpline2d pointsToBSpline2d(const std::vector<Pnt2d>&  pts,
                            const std::vector<double>& params,
                            int    degMin = 3,
                            int    degMax = 8,
                            double tol    = 1.0e-9);

// One least-squares solve at a PRESCRIBED degree and control-net size over a
// uniform clamped knot vector on [params.front(), params.back()]. The building
// block of the adaptive loop above; exposed because the pcurve fitter drives
// the net size itself and reads back the residual it achieved. `maxResidual`
// is the largest 2-D distance between a data point and the fit.
BSpline2d fitBSpline2dAt(const std::vector<Pnt2d>&  pts,
                         const std::vector<double>& params,
                         int     degree,
                         int     nCtrl,
                         double& maxResidual);

// ---------------------------------------------------------------------------
// 2. THE EXACT 3-D SECTION of a plane with a cylinder. Closed form, no fitting.
enum class SectionKind {
    None,      // the plane misses the cylinder entirely (parallel case only)
    Circle,    // plane perpendicular to the axis
    Ellipse,   // the general case
    TwoLines,  // plane parallel to the axis and cutting it: two generatrices
    Tangent    // plane parallel to the axis and tangent: one generatrix
};

struct PlaneCylSection {
    SectionKind kind    = SectionKind::None;
    Conic3      curve;           // valid only for Circle / Ellipse
    double      cosAxis = 0;     // n . a, the discriminant
    std::string defer;           // why `curve` is not valid
};

// `planeNormal` MUST be unit; `planeD` is the Hesse constant for it, i.e. the
// plane is { x : planeNormal . x = planeD }.
PlaneCylSection planeCylinderSection(const Vec3& planeNormal,
                                     double      planeD,
                                     const Ax3&  cylAx,
                                     double      radius,
                                     double      tol = 1.0e-9);

// The largest deviation of `sec.curve` from BOTH of its defining surfaces,
// sampled over the full period: max( | dist(C(t), axis) - r | , |n.C(t) - d| ).
// This is the section's own correctness check and the fitter runs it before any
// pcurve is built — a wrong 3-D curve with a perfect pcurve is still a wrong edge.
double sectionResidual(const PlaneCylSection& sec,
                       const Vec3&            planeNormal,
                       double                 planeD,
                       const Ax3&             cylAx,
                       double                 radius,
                       int                    nSamples = 361);

// ---------------------------------------------------------------------------
// 3. THE PCURVE ITSELF, with its measured error bar.

// Either an AFFINE map t -> origin + t * dir (the exact cases — note `dir` is
// NOT normalised, because the pcurve must share the 3-D curve's parameter and a
// unit-direction line cannot carry a non-unit affine map), or a B-spline.
struct PCurve2d {
    bool      valid  = false;
    bool      line   = false;
    Pnt2d     origin;          // line only
    Pnt2d     dir;             // line only, NOT unit
    BSpline2d spline;          // used when !line

    // The parameter range the pcurve was built for. Carried EXPLICITLY because
    // an affine map has no intrinsic range and the OCCT bridge needs one: a
    // non-unit affine map is emitted as a degree-1 two-pole B-spline whose poles
    // sit at these two parameters.
    double tFirst = 0.0;
    double tLast  = 0.0;

    Pnt2d value(double t) const;
};

struct PCurveFit {
    PCurve2d    curve;                     // .valid == false is a defer
    bool        exact     = false;         // true only for the closed-form kinds
    double      maxDev3d  = -1.0;          // mm, over the dense OFFSET audit set
    double      maxDevU   = -1.0;          // parameter-space u deviation (must be ~0)
    int         degree    = 0;
    int         nPoles    = 0;
    int         nSpans    = 0;
    int         nAudit    = 0;
    std::string defer;                     // named guard when `curve` is invalid
};

// How the 3-D curve reaches this file. Return false to report that the curve
// could not be evaluated at `t` (the OCCT bridge returns false where
// Geom_Curve::Value would have thrown a Standard_Failure).
using Curve3dEval = std::function<bool(double t, Vec3& p)>;

// Fit the pcurve on the CYLINDER of the 3-D curve `c3` over [t0, t1].
// `uNear` selects the 2*pi branch: the fitted u is shifted by the multiple of
// 2*pi that puts u(t0) nearest to it, so the new pcurve lands on the same period
// as the face's existing ones. `tol3d` is the deviation the fit must achieve, in
// the model's own length unit.
PCurveFit cylinderPCurve(const Curve3dEval& c3,
                         double             t0,
                         double             t1,
                         const Ax3&         cylAx,
                         double             radius,
                         double             tol3d = 1.0e-7,
                         double             uNear = 0.0);

// The pcurve of a conic section on the drafted PLANE — exact, and a concrete
// 2-D conic, never a fit: a conic in its own plane is a conic in that plane's
// coordinates. `planeOrigin`, `planeX`, `planeY` are the plane's frame; the
// returned curve satisfies
// C3(t) = planeOrigin + C2(t).x * planeX + C2(t).y * planeY for every t.
Conic2 planePCurve(const Conic3& c3,
                   const Vec3&   planeOrigin,
                   const Vec3&   planeX,
                   const Vec3&   planeY);

// ---------------------------------------------------------------------------
// 4. THE CYLINDER'S OWN PARAMETERISATION — the native ElSLib.
//
// Transcribed from the closed form OCCT's ElSLib uses, including its exact
// seam handling (`U < -1e-16 -> U += 2pi`, else a negative U is clamped to 0),
// so a pcurve fitted here and a pcurve fitted through OCCT land on the same
// branch. `radius` is unused by cylinderParameters and is taken for symmetry
// with the OCCT signature this replaces.
void cylinderParameters(const Ax3& cylAx, double radius, const Vec3& p,
                        double& u, double& v);
Vec3 cylinderValue(double u, double v, const Ax3& cylAx, double radius);

}  // namespace pcurvefit
}  // namespace forge

#endif  // FORGE_NATIVE_GEOM_NATIVEPCURVEFIT_HPP
