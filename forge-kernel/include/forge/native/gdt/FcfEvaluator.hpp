// forge/native/gdt/FcfEvaluator.hpp
//
// In-house GEOMETRIC GD&T / FCF EVALUATOR that measures on a BUILT NATIVE B-REP
// SOLID — forge::native::gdt::fcf  (task #26 follow-on: the kernel-side, geometry-
// reading half of the GD&T program).
//
// ============================ WHY THIS EXISTS (Bible §0/§9) =================
// Two GD&T surfaces already existed in this repo and are deliberately NOT
// duplicated here:
//
//   (A) frontend/src/forge-v4/asmeY145Rules.js  — authors / SEMANTICALLY checks
//       Feature-Control-Frame STRINGS (datum order, legal modifiers, Ø prefix,
//       max-3-datums). Reads NO geometry.
//   (B) forge/native/gdt/Gdt.hpp                — the GEOMETRIC math core that
//       evaluates flatness / true-position / perpendicularity / circularity /
//       cylindricity / profile from a CALLER-SUPPLIED POINT SET already expressed
//       in a datum reference frame. It is the validated numerics layer.
//
// What was MISSING and is built here: the bridge from a *built native Solid* to
// those measurements. A real GD&T verifier does not receive a tidy point set — it
// receives a PART (the B-rep) and a feature selector (this face / this edge / the
// derived axis of this bore), SAMPLES the actual analytic surface or curve the
// kernel built, fits the substitute geometry, and reports the deviation against
// the tolerance zone. This module does exactly that on forge::native::brep types:
//
//   * It SAMPLES the kernel's own analytic geometry — brep::Surface::evaluate(u,v)
//     over a Face's trim window, brep::Curve::evaluate(t) over an Edge — so the
//     measured points ARE the exact native surface/curve, not a re-derived
//     primitive (Bible: "reuse the native B-rep topology + surfaces, don't
//     re-derive geometry primitives"). For an analytic cylinder/cone/plane the
//     axis/normal/radius are read straight off the Surface tag (exact), not fit.
//   * It fits the SUBSTITUTE feature (least-squares plane / line / circle /
//     cylinder axis) for the CMM-style raw-point path (probe clouds, tessellation
//     samples) with the same 3×3 symmetric-Jacobi / algebraic-circle math the
//     validated Gdt.cpp uses.
//   * It evaluates EVERY characteristic the prompt enumerates, each returning the
//     uniform verdict {measured, toleranceZone, pass}:
//
//       Flatness (§5.4.2)        — LS plane, peak-to-valley residual band.
//       Straightness (§5.4.1)    — LS line; planar band OR Ø derived-median-line.
//       Circularity (§5.4.3)     — one section: R_max − R_min about the LS centre.
//       Cylindricity (§5.4.4)    — whole surface: R_max − R_min about the LS axis.
//       Position (§7.3)          — feature axis vs basic location in the DRF;
//                                  diametral 2r, with MMC/LMC bonus.
//       Perpendicularity/Parallelism/Angularity (§6.7–6.9) — angular error of the
//                                  feature direction from the basic angle to the
//                                  datum, projected over the feature length.
//       Concentricity (§5.12)    — 2× radial offset of the feature axis from the
//                                  datum axis.
//       Circular Runout (§9.4)   — FIM of the surface about the datum axis, one
//                                  section.
//       Total Runout (§9.5)      — FIM of the surface about the datum axis, whole
//                                  surface.
//       Profile of a surface (§11) — signed normal deviation from a true profile
//                                  within a bilateral ±tol/2 or unilateral 0..tol
//                                  band.
//
//   * It builds a DATUM REFERENCE FRAME (primary>secondary>tertiary precedence)
//     from datum PLANES (Gram-Schmidt orthonormal frame, origin at the mutual
//     plane intersection) OR from a primary datum AXIS (for runout/concentricity),
//     and transforms world geometry into the DRF before the position/orientation
//     evaluation, exactly as a CMM does the candidate-datum→simulated-datum step.
//
// HONESTY: this is exact closed-form / least-squares numerics in double precision.
// All eigen work is 3×3 cyclic-Jacobi (always converges for symmetric input), all
// circle fits are the algebraic Kåsa normal-equation fit; no iterative envelope
// (Chebyshev/min-zone) optimiser is claimed — the LS substitute feature is the
// reported reference, which is the CMM default and is what the known-answer gate
// (test/native/gdt/fcf_evaluator_test.cpp) checks against analytic expectations.
//
// CONVENTIONS: pure C++20 + the standard library + the forge::native::brep public
// headers it measures on. No OCCT, no WASM, no third-party deps. Self-contained in
// the nested namespace forge::native::gdt::fcf so it never collides with the free
// types in the sibling Gdt.hpp (which lives in forge::native::gdt).

#ifndef FORGE_NATIVE_GDT_FCFEVALUATOR_HPP
#define FORGE_NATIVE_GDT_FCFEVALUATOR_HPP

#include <vector>
#include <cstddef>

#include "forge/native/brep/Topology.hpp"   // brep::{Solid,Shell,Face,Edge,Vertex}
#include "forge/native/brep/Surface.hpp"    // brep::{Surface,SurfaceKind,Vec3,vadd…}

namespace forge {
namespace native {
namespace gdt {
namespace fcf {

// Reuse the kernel's 3-vector and its algebra (vadd/vsub/vscale/vdot/vcross/vlen/
// vnorm live in brep, declared by Surface.hpp). No new vector type is minted.
using brep::Vec3;

// ---------------------------------------------------------------------------
// The geometric characteristics this evaluator measures (for result tagging and
// the unified dispatcher). Mirrors the ASME Y14.5-2018 symbol set the JS bridge
// (ForgeToolBridge.js gdtCharSymbol) already speaks.
// ---------------------------------------------------------------------------
enum class Characteristic {
    Flatness,
    Straightness,
    Circularity,
    Cylindricity,
    Position,
    Perpendicularity,
    Parallelism,
    Angularity,
    Concentricity,
    CircularRunout,
    TotalRunout,
    ProfileSurface
};

// Material-condition modifier (§7.3.3) and feature-of-size kind — own copies so
// this module is self-contained (numerically identical semantics to Gdt.hpp).
enum class MatCond { RFS, MMC, LMC };
enum class FoSType { Hole, Pin };

// ---------------------------------------------------------------------------
// The uniform verdict every evaluator returns: {measured, toleranceZone, pass}.
//   measured      : the geometric deviation in the characteristic's OWN metric
//                   (the peak-to-valley band for flatness/straightness/circularity/
//                   cylindricity, the FIM for runout, the diametral 2r for
//                   position/concentricity, featureLength·sin(err) for orientation,
//                   max|signed normal dev| for profile) — directly comparable to
//                   `toleranceZone`.
//   toleranceZone : the allowed zone = stated tolerance + bonus (bonus is 0 for
//                   every form/orientation/runout control; non-zero only for an
//                   MMC/LMC position on a feature of size).
//   pass          : measured <= toleranceZone (inclusive boundary).
// ---------------------------------------------------------------------------
struct FcfResult {
    bool           ok = false;
    Characteristic characteristic = Characteristic::Flatness;
    double         measured = 0.0;
    double         toleranceZone = 0.0;
    double         bonus = 0.0;
    bool           pass = false;
    int            nSamples = 0;
    const char*    reason = "";
};

// ===========================================================================
// DATUM REFERENCE FRAME (ASME Y14.5 §4) — built either from three datum PLANES
// (precedence A>B>C) or from a single primary datum AXIS (runout/concentricity).
// ===========================================================================
struct Drf {
    bool ok = false;
    Vec3 origin{};
    Vec3 ex{1, 0, 0};   // +X of the frame
    Vec3 ey{0, 1, 0};   // +Y of the frame
    Vec3 ez{0, 0, 1};   // +Z of the frame = primary datum normal / datum axis
    const char* reason = "";
};

// Three datum planes (point + normal each). ez = normalized normal of A (primary);
// ex = B's normal with its A-component removed (Gram-Schmidt) -> ⊥ A; ey = ez×ex.
// origin = the mutual intersection of the three planes (Cramer's rule). ok=false
// when A is degenerate, B is parallel to A, or the three planes do not meet.
Drf buildDrfPlanes(const Vec3& aPoint, const Vec3& aNormal,
                   const Vec3& bPoint, const Vec3& bNormal,
                   const Vec3& cPoint, const Vec3& cNormal);

// A single primary datum axis: ez = normalized axisDir, origin = axisPoint, and
// ex/ey an arbitrary right-handed ⊥ completion. Used for coaxial controls where
// only the axis matters (runout, concentricity).
Drf buildDrfAxis(const Vec3& axisPoint, const Vec3& axisDir);

// Express a world point in DRF coordinates: p' = Rᵀ(p − origin), R=[ex ey ez].
Vec3 toDrf(const Drf& d, const Vec3& world);
// Inverse: world = origin + R·p'.
Vec3 toWorld(const Drf& d, const Vec3& drfPt);

// ===========================================================================
// SUBSTITUTE-FEATURE FITS (the CMM least-squares geometry).
// ===========================================================================
struct FitPlane  { bool ok = false; Vec3 point{}; Vec3 normal{}; };
struct FitLine   { bool ok = false; Vec3 point{}; Vec3 dir{}; };
struct FitAxis   { bool ok = false; Vec3 point{}; Vec3 dir{}; double radius = 0.0; };

// LS best-fit plane: centroid + smallest-eigenvalue eigenvector of the covariance.
FitPlane fitPlane(const std::vector<Vec3>& pts);
// LS best-fit line: centroid + LARGEST-eigenvalue eigenvector (the line direction).
FitLine  fitLine(const std::vector<Vec3>& pts);
// LS best-fit cylinder axis: the covariance principal direction whose ⊥ projection
// gives the tightest radial band; `point` is the fitted axis location (the LS
// circle centre lifted to 3D), `radius` the mean radius. Robust for full-
// revolution samples; documents its assumption for partial sectors.
FitAxis  fitCylinderAxis(const std::vector<Vec3>& pts);

// ===========================================================================
// NATIVE-GEOMETRY SAMPLING — turn a built Face/Edge into measurement points by
// evaluating the kernel's own analytic Surface/Curve. Falls back to the topology
// (loop vertices / edge endpoints) when a face/edge carries no analytic geometry.
// ===========================================================================

// Grid-sample a Face. If face.surface != null: nu×nv points of surface.evaluate
// over the face trim window [u0,u1]×[v0,v1]. Else: the outer-loop vertex polygon
// (a planar quad's four corners are exactly coplanar, so a bare box face flatness
// is 0). Returns the world-space points.
std::vector<Vec3> sampleFace(const brep::Face& f, int nu = 24, int nv = 24);

// Sample an Edge into n points. If edge.curve != null: curve.evaluate over its
// [t0,t1] trim (e.g. a circular edge yields a true circle of points). Else: the
// straight chord start→end interpolated into n points.
std::vector<Vec3> sampleEdge(const brep::Edge& e, int n = 96);

// Read the EXACT analytic axis of a cylindrical (or conical) face straight off its
// Surface tag — origin point on the axis, unit direction, base radius. Returns
// false if the face is not an analytic cylinder/cone. This is the "don't re-derive
// the primitive" path: the kernel already knows the axis.
bool faceCylinderAxis(const brep::Face& f, Vec3& axisPoint, Vec3& axisDir,
                      double& radius);

// ===========================================================================
// CHARACTERISTIC EVALUATORS — each comes as a POINT-SET core (the math, directly
// testable against analytic known answers and reusable for CMM clouds) plus a
// thin B-REP WRAPPER that samples a Face/Edge then calls the core.
// ===========================================================================

// ---- (1) FLATNESS (§5.4.2) -------------------------------------------------
// measured = peak-to-valley band of signed distances from the LS plane.
FcfResult measureFlatness(const std::vector<Vec3>& pts, double tol);
FcfResult flatness(const brep::Face& f, double tol, int nu = 24, int nv = 24);

// ---- (2) STRAIGHTNESS (§5.4.1) --------------------------------------------
// LS line through the points.
//   diametral=false : planar line-element zone (two parallel lines). measured =
//                     the range (max−min) of the SIGNED perpendicular deviation
//                     along the in-plane direction of maximum spread.
//   diametral=true  : Ø derived-median-line zone (a cylinder). measured =
//                     2 × max perpendicular distance from the LS line.
FcfResult measureStraightness(const std::vector<Vec3>& pts, double tol,
                              bool diametral);
// Edge line element (planar zone).
FcfResult straightnessEdge(const brep::Edge& e, double tol, int n = 96);
// Derived median line of a cylindrical face (Ø zone): samples the surface, fits
// the axis, then measures the axis-point straightness of the per-ring centres.
FcfResult straightnessAxis(const brep::Face& cyl, double tol, int nu = 36,
                           int nv = 16);

// ---- (3) CIRCULARITY (§5.4.3) ---------------------------------------------
// One cross-section: measured = R_max − R_min about the LS-fit centre.
FcfResult measureCircularity(const std::vector<Vec3>& sectionPts, double tol);
FcfResult circularity(const brep::Edge& circEdge, double tol, int n = 180);

// ---- (4) CYLINDRICITY (§5.4.4) --------------------------------------------
// Whole surface: measured = R_max − R_min about the LS axis (tightest principal).
FcfResult measureCylindricity(const std::vector<Vec3>& surfPts, double tol);
FcfResult cylindricity(const brep::Face& cyl, double tol, int nu = 48, int nv = 16);

// ---- (5) POSITION (§7.3) ---------------------------------------------------
// MMC/LMC geometric bonus (§7.3.3); numerically identical to Gdt::mmcBonus.
double mmcBonus(double actualSize, double matLimit, MatCond mc, FoSType ft);
// Feature axis point & true location are given IN THE DRF (axis ~ DRF z, position
// in DRF XY). measured = 2·radialOffset; toleranceZone = posTol + bonus.
FcfResult measurePosition(const Vec3& featAxisPtDrf, const Vec3& trueLocDrf,
                          double posTol, double actualSize, double matLimit,
                          MatCond mc, FoSType ft);
// B-rep wrapper: read the bore/pin axis off `holeCyl`, transform its axis point to
// the DRF, and measure position vs `trueLocDrf` (the basic location in the DRF).
// `actualSize` defaults to the face's analytic diameter when <= 0.
FcfResult position(const brep::Face& holeCyl, const Drf& drf,
                   const Vec3& trueLocDrf, double posTol, double actualSize,
                   double matLimit, MatCond mc, FoSType ft);

// ---- (6) ORIENTATION: Perpendicularity / Parallelism / Angularity (§6.7–6.9)
// β = angle(featureDir, datumDir) folded to [0,90]; angularError = |β − basicAngle|;
// measured = featureLength · sin(angularError). pass = measured <= tol.
// Conventions for `basicAngleDeg` (the nominal angle between the two supplied
// directions): perpendicularity of an AXIS to a datum PLANE → datumDir = plane
// normal, basicAngle 0 (axis ∥ normal); parallelism of an axis to a datum axis →
// basicAngle 0; perpendicularity of a FACE to a datum plane → featureDir = face
// normal, datumDir = datum normal, basicAngle 90; angularity → basicAngle = θ.
FcfResult measureOrientation(Characteristic c, const Vec3& featureDir,
                             const Vec3& datumDir, double basicAngleDeg,
                             double tol, double featureLength);
// Axis-of-a-cylindrical-face orientation (featureLength = the axial extent).
FcfResult orientationAxis(const brep::Face& cyl, const Vec3& datumDir,
                          Characteristic c, double basicAngleDeg, double tol);
// Planar-face orientation (featureDir = fitted face normal; featureLength = the
// sample set's bounding diagonal, i.e. the in-plane feature extent).
FcfResult orientationFace(const brep::Face& f, const Vec3& datumDir,
                          Characteristic c, double basicAngleDeg, double tol,
                          int nu = 24, int nv = 24);

// ---- (7) CONCENTRICITY (§5.12) --------------------------------------------
// measured = 2 × radial distance of the feature axis point from the datum axis.
FcfResult measureConcentricity(const Vec3& featAxisPt, const Vec3& datumAxisPt,
                               const Vec3& datumAxisDir, double tol);
FcfResult concentricity(const brep::Face& cyl, const Vec3& datumAxisPt,
                        const Vec3& datumAxisDir, double tol);

// ---- (8) RUNOUT (§9) -------------------------------------------------------
// Circular runout (§9.4): FIM = (R_max − R_min) of the radial distance of one
// cross-section's points FROM THE DATUM AXIS (not the feature's own axis).
FcfResult measureCircularRunout(const std::vector<Vec3>& sectionPts,
                                const Vec3& datumAxisPt, const Vec3& datumAxisDir,
                                double tol);
FcfResult circularRunout(const brep::Face& cyl, const Vec3& datumAxisPt,
                         const Vec3& datumAxisDir, double tol, int nSection = 180);
// Total runout (§9.5): FIM of the radial distance over the WHOLE surface about the
// datum axis (captures eccentricity, taper and form together).
FcfResult measureTotalRunout(const std::vector<Vec3>& surfPts,
                             const Vec3& datumAxisPt, const Vec3& datumAxisDir,
                             double tol);
FcfResult totalRunout(const brep::Face& cyl, const Vec3& datumAxisPt,
                      const Vec3& datumAxisDir, double tol, int nu = 48,
                      int nv = 16);

// ---- (9) PROFILE OF A SURFACE (§11) ---------------------------------------
// measured = max |signed normal deviation| of each measured point from its
// index-paired true-profile point along the true outward normal. Bilateral pass
// iff measured <= tol/2; unilateral (outward 0..tol) pass iff every signed
// deviation lies in [0, tol].
FcfResult measureProfile(const std::vector<Vec3>& measuredPts,
                         const std::vector<Vec3>& trueProfilePts,
                         const std::vector<Vec3>& trueProfileNormals,
                         double tol, bool unilateral);

} // namespace fcf
} // namespace gdt
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GDT_FCFEVALUATOR_HPP
