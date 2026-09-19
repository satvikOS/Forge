// forge/PCurveFitOcctBridge.hpp — the OCCT face of the NATIVE pcurve fit.
//
// ===========================================================================
// WHAT THIS IS, AND WHY IT IS A SEPARATE FILE (T-154)
// ===========================================================================
// `forge/native/geom/NativePCurveFit.hpp` is a NATIVE algorithm — Piegl &
// Tiller ch. 9, endpoint interpolation, interior poles from the normal
// equations, an SPD Cholesky solve — and it used to RETURN OCCT TYPES:
// `Handle(Geom2d_BSplineCurve)`, `Handle(Geom_Curve)`, `gp_Ax3`, `gp_Dir`.
//
// A producer of OCCT types living inside `src/native`, the subtree whose whole
// purpose is to be OCCT-free. The symptom was six "compile the native tree
// OCCT-free" builders that could not build at all. The defect was the file.
//
// So the two halves were separated along the line that was already there:
//
//   * THE ARITHMETIC stayed in src/native/geom/NativePCurveFit.cpp, now with no
//     OCCT include and no `#ifdef FORGE_NATIVE_BREP` guard. It is compiled, for
//     real, by every OCCT-free pass over the native tree.
//   * THE TYPE CONVERSION is here, in the bridge layer beside
//     NativeOcctBridge.cpp and OcctPrimBuilder.cpp, where OCCT is expected and
//     where `#ifdef FORGE_NATIVE_BREP` is the normal state of affairs.
//
// The signatures below are the ones `NativePCurveFit.hpp` used to carry,
// unchanged, so a caller that genuinely needs a Handle — `NativeDraftLocal.cpp`
// needs one, because a BRep edge is built on a Geom_Curve — changes its include
// and its namespace and nothing else.
//
// ★ NOTHING IN THIS FILE COMPUTES GEOMETRY. Every entry point converts, calls
//   `forge::pcurvefit::`, and converts back. If a formula ever appears here,
//   the split has been undone: that is the thing to look for in review.
//
// ★ THE CONVERSIONS ARE EXACT, NOT APPROXIMATE, and two of them are easy to get
//   subtly wrong — both are called out at their definitions in the .cpp:
//     - gp_Ax3 may be LEFT-handed, so YDirection() is carried across rather than
//       recomputed as dir x xdir;
//     - an affine pcurve whose direction is not unit CANNOT be a Geom2d_Line,
//       and becomes the same degree-1 two-pole B-spline the original emitted.

#ifndef FORGE_PCURVEFITOCCTBRIDGE_HPP
#define FORGE_PCURVEFITOCCTBRIDGE_HPP

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

#include "forge/native/geom/NativePCurveFit.hpp"

namespace forge {
namespace pcurvefit {
namespace occt {

// The section KINDS are the native enum, not a parallel copy: two enumerations
// of the same five cases is how two engines start disagreeing about which case
// they are in.
using SectionKind = forge::pcurvefit::SectionKind;

// ---------------------------------------------------------------------------
// 0. THE CONVERSIONS, exposed because they are the entire content of this file.
// ---------------------------------------------------------------------------
forge::pcurvefit::Ax3 toNative(const gp_Ax3& ax);
forge::math::Vec3     toNative(const gp_Dir& d);
forge::math::Vec3     toNative(const gp_Pnt& p);

// Geom_Circle when `c.circle`, else Geom_Ellipse. Null when `c` is invalid.
Handle(Geom_Curve) toOcct(const forge::pcurvefit::Conic3& c);
// Geom2d_BSplineCurve. Null when the spline is structurally invalid.
Handle(Geom2d_BSplineCurve) toOcct(const forge::pcurvefit::BSpline2d& c);
// Geom2d_Line for a unit-direction affine map, a degree-1 two-pole
// Geom2d_BSplineCurve for a non-unit one, a Geom2d_BSplineCurve for a fit.
Handle(Geom2d_Curve) toOcct(const forge::pcurvefit::PCurve2d& c);

// ---------------------------------------------------------------------------
// 1. THE 2-D LEAST-SQUARES FIT — see NativePCurveFit.hpp for the contract.
// ---------------------------------------------------------------------------
Handle(Geom2d_BSplineCurve) pointsToBSpline2d(const TColgp_Array1OfPnt2d& pts,
                                              const std::vector<double>& params,
                                              int    degMin = 3,
                                              int    degMax = 8,
                                              double tol    = 1.0e-9);

Handle(Geom2d_BSplineCurve) fitBSpline2dAt(const TColgp_Array1OfPnt2d& pts,
                                           const std::vector<double>& params,
                                           int     degree,
                                           int     nCtrl,
                                           double& maxResidual);

// ---------------------------------------------------------------------------
// 2. THE EXACT PLANE / CYLINDER SECTION.
// ---------------------------------------------------------------------------
struct PlaneCylSection {
    SectionKind        kind = SectionKind::None;
    Handle(Geom_Curve) curve;        // Geom_Circle or Geom_Ellipse; null for the line kinds
    double             cosAxis = 0;  // n . a, the discriminant
    std::string        defer;        // why `curve` is null

    // The native result this was converted from. Kept so `sectionResidual`
    // below is a FORWARD and not a second implementation — the residual must
    // be measured on the same curve the caller was handed, and re-deriving it
    // from the Handle would be a second copy of the section formula.
    forge::pcurvefit::PlaneCylSection native;
};

// `planeNormal` need not be unit; `planeD` is the Hesse constant for the UNIT
// normal, i.e. the plane is { x : planeNormal . x = planeD }.
PlaneCylSection planeCylinderSection(const gp_Dir& planeNormal,
                                     double        planeD,
                                     const gp_Ax3& cylAx,
                                     double        radius,
                                     double        tol = 1.0e-9);

double sectionResidual(const PlaneCylSection& sec,
                       const gp_Dir&          planeNormal,
                       double                 planeD,
                       const gp_Ax3&          cylAx,
                       double                 radius,
                       int                    nSamples = 361);

// ---------------------------------------------------------------------------
// 3. THE PCURVE, with its measured error bar.
// ---------------------------------------------------------------------------
struct PCurveFit {
    Handle(Geom2d_Curve) curve;            // Geom2d_Line when exact, else Geom2d_BSplineCurve
    bool        exact     = false;
    double      maxDev3d  = -1.0;          // mm, over the dense OFFSET audit set
    double      maxDevU   = -1.0;
    int         degree    = 0;
    int         nPoles    = 0;
    int         nSpans    = 0;
    int         nAudit    = 0;
    std::string defer;                     // named guard when `curve` is null
};

// `c3` is sampled through Geom_Curve::Value, so a REVERSED or otherwise derived
// handle is honoured exactly as the caller built it.
PCurveFit cylinderPCurve(const Handle(Geom_Curve)& c3,
                         double                    t0,
                         double                    t1,
                         const gp_Ax3&             cylAx,
                         double                    radius,
                         double                    tol3d = 1.0e-7,
                         double                    uNear = 0.0);

// The pcurve of the SAME 3-D curve on the drafted PLANE — exact, and a concrete
// Geom2d_Circle / Geom2d_Ellipse, never a fit. Null is an honest defer: `c3` is
// not a conic this file emits.
Handle(Geom2d_Curve) planePCurve(const Handle(Geom_Curve)& c3,
                                 const gp_Pnt&             planeOrigin,
                                 const gp_Dir&             planeX,
                                 const gp_Dir&             planeY);

}  // namespace occt
}  // namespace pcurvefit
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
#endif  // FORGE_PCURVEFITOCCTBRIDGE_HPP
