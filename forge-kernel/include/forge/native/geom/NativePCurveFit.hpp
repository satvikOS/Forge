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
// WHY IT IS NATIVE AND NOT `Geom2dAPI_PointsToBSpline`
// ===========================================================================
// OCCT's own approximator lives in TKGeomAlgo, and its `GeomAPI` / `GeomConvert`
// neighbours in TKGeomBase. Those two toolkits are in OCCT_CLOSURE today as
// FREE RIDERS: the kernel has NO reference of its own left to either, so they
// leave at drop steps 5 and 6 for nothing (reports/OCCT_DROP_ORDER.md s4.2).
// One call to `Geom2dAPI_PointsToBSpline` from here would convert two zero-cost
// closure points into two funded work items and no other gate in the build would
// notice. `test/run_ab_native_pcurve_fit.sh` asserts 0 TKGeomBase and 0
// TKGeomAlgo imports on THIS translation unit's object file, which is the only
// moment they could be reintroduced.
//
// DROP HYGIENE, exhaustively: gp_* and ElSLib (TKMath), Geom_* concrete classes
// (TKG3d), Geom2d_* concrete classes (TKG2d — already a phantom-direct of the
// binary, 24 masked symbols, so this adds no new toolkit). NOTHING else. No
// GeomAPI, no Geom2dAPI, no GeomConvert, no Approx_*, no AppDef_*, no Extrema_*,
// no BRepOffset*.
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
// A NULL return is an HONEST DEFER and `PCurveFit::defer` names the guard.

#ifndef FORGE_NATIVE_GEOM_NATIVEPCURVEFIT_HPP
#define FORGE_NATIVE_GEOM_NATIVEPCURVEFIT_HPP

#ifdef FORGE_NATIVE_BREP

#include <string>
#include <vector>

#include <Geom2d_BSplineCurve.hxx>
#include <Geom2d_Curve.hxx>
#include <Geom_Curve.hxx>
#include <TColgp_Array1OfPnt2d.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>

namespace forge {
namespace pcurvefit {

// ---------------------------------------------------------------------------
// 1. THE 2-D SIBLING of forge::occtconv::pointsToBSpline (NativeNurbsConvert).
//    Piegl & Tiller, The NURBS Book ch. 9: endpoints interpolated, interior
//    poles from the normal equations, native SPD (Cholesky) solve, control-net
//    size escalated until the residual meets `tol`.
//
//    `params` is the parameter of each point. A PCURVE MUST SHARE ITS 3-D
//    CURVE'S PARAMETERISATION, so this overload takes them explicitly and the
//    resulting curve's FirstParameter/LastParameter are params.front()/back().
//    Pass an empty vector for chord-length parametrisation on [0,1], which is
//    what the 3-D sibling does.
//
//    Null => fewer than 2 points, a non-increasing parameter vector, or a
//    rank-deficient normal matrix at every attempted net size.
Handle(Geom2d_BSplineCurve) pointsToBSpline2d(const TColgp_Array1OfPnt2d& pts,
                                              const std::vector<double>& params,
                                              int    degMin = 3,
                                              int    degMax = 8,
                                              double tol    = 1.0e-9);

// One least-squares solve at a PRESCRIBED degree and control-net size over a
// uniform clamped knot vector on [params.front(), params.back()]. The building
// block of the adaptive loop above; exposed because the pcurve fitter drives
// the net size itself and reads back the residual it achieved. `maxResidual`
// is the largest 2-D distance between a data point and the fit.
Handle(Geom2d_BSplineCurve) fitBSpline2dAt(const TColgp_Array1OfPnt2d& pts,
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
    SectionKind        kind = SectionKind::None;
    Handle(Geom_Curve) curve;        // Geom_Circle or Geom_Ellipse; null for the line kinds
    double             cosAxis = 0;  // n . a, the discriminant
    std::string        defer;        // why `curve` is null
};

// `planeNormal` need not be unit; `planeD` is the Hesse constant for the UNIT
// normal, i.e. the plane is { x : planeNormal . x = planeD }.
PlaneCylSection planeCylinderSection(const gp_Dir& planeNormal,
                                     double        planeD,
                                     const gp_Ax3& cylAx,
                                     double        radius,
                                     double        tol = 1.0e-9);

// The largest deviation of `sec.curve` from BOTH of its defining surfaces,
// sampled over the full period: max( | dist(C(t), axis) - r | , |n.C(t) - d| ).
// This is the section's own correctness check and the fitter runs it before any
// pcurve is built — a wrong 3-D curve with a perfect pcurve is still a wrong edge.
double sectionResidual(const PlaneCylSection& sec,
                       const gp_Dir&          planeNormal,
                       double                 planeD,
                       const gp_Ax3&          cylAx,
                       double                 radius,
                       int                    nSamples = 361);

// ---------------------------------------------------------------------------
// 3. THE PCURVE ITSELF, with its measured error bar.
struct PCurveFit {
    Handle(Geom2d_Curve) curve;            // Geom2d_Line when exact, else Geom2d_BSplineCurve
    bool        exact     = false;         // true only for the closed-form kinds
    double      maxDev3d  = -1.0;          // mm, over the dense OFFSET audit set
    double      maxDevU   = -1.0;          // parameter-space u deviation (must be ~0)
    int         degree    = 0;
    int         nPoles    = 0;
    int         nSpans    = 0;
    int         nAudit    = 0;
    std::string defer;                     // named guard when `curve` is null
};

// Fit the pcurve on the CYLINDER of the 3-D curve `c3` over [t0, t1].
// `uNear` selects the 2*pi branch: the fitted u is shifted by the multiple of
// 2*pi that puts u(t0) nearest to it, so the new pcurve lands on the same period
// as the face's existing ones. `tol3d` is the deviation the fit must achieve, in
// the model's own length unit.
PCurveFit cylinderPCurve(const Handle(Geom_Curve)& c3,
                         double                    t0,
                         double                    t1,
                         const gp_Ax3&             cylAx,
                         double                    radius,
                         double                    tol3d = 1.0e-7,
                         double                    uNear = 0.0);

// The pcurve of the SAME 3-D curve on the drafted PLANE — exact, and a concrete
// Geom2d_Circle / Geom2d_Ellipse, never a fit: a conic in its own plane is a
// conic in that plane's coordinates. `planeOrigin`, `planeX`, `planeY` are the
// plane's frame; the returned curve satisfies
// C3(t) = planeOrigin + C2(t).X * planeX + C2(t).Y * planeY for every t.
Handle(Geom2d_Curve) planePCurve(const Handle(Geom_Curve)& c3,
                                 const gp_Pnt&             planeOrigin,
                                 const gp_Dir&             planeX,
                                 const gp_Dir&             planeY);

}  // namespace pcurvefit
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_NATIVE_GEOM_NATIVEPCURVEFIT_HPP
