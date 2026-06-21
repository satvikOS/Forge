// forge/native/gdt/Gdt.hpp
//
// In-house GEOMETRIC GD&T evaluator — forge::native::gdt.
//
// WHY THIS EXISTS (honest scope, per Forge Engineering Bible §0 / §9):
//   The Forge GD&T surface that shipped before this file is PMI-TEXT only:
//     * frontend/src/forge-v4/asmeY145Rules.js authors and SEMANTICALLY checks
//       Feature-Control-Frame STRINGS (datum precedence, legal modifiers, Ø
//       prefix, tol>0, max-3-datums, …). It reads NO geometry, measures NO
//       deviation, computes NO position error — its own header (lines 1-6) says
//       "syntactically valid … SEMANTIC rules a drawing-checker enforces".
//     * frontend/src/ai/ForgeToolBridge.js (lines 504-513) states explicitly:
//       "There is NO native gdt/datum/pmi namespace … the gdt.* verbs AUTHOR
//       GD&T … They do NOT geometrically verify a tolerance."
//
//   This module closes that gap with the REAL ASME Y14.5-2018 MATH. It takes
//   MEASURED COORDINATES and computes the actual geometric deviation, then
//   decides pass/fail against the tolerance zone — the thing a CMM report or a
//   true GD&T verifier does, not a drawing checker.
//
// WHAT IS EVALUATED GEOMETRICALLY HERE (this is exact numerics, no PMI text):
//
//   (1) DATUM REFERENCE FRAME (ASME Y14.5 §4.1, datum precedence A>B>C):
//       Build a right-handed orthonormal Datum Reference Frame from
//         * a primary datum PLANE A (point + outward normal)         -> Z axis,
//         * a secondary datum PLANE B, forced ⊥ to A (Gram-Schmidt)  -> X axis,
//         * a tertiary  datum PLANE C, forced ⊥ to A and B           -> Y axis,
//       with the DRF origin at the mutual intersection of the three planes.
//       transformToDrf() then expresses any measured world point in DRF
//       coordinates. This is the candidate-datum-feature -> simulated-datum
//       step: tolerances are evaluated in the DRF, never in world space.
//
//   (2) TRUE POSITION with MMC / LMC bonus tolerance (Y14.5 §7.3, §7.3.3):
//       Given the actual feature axis location and its true (basic) location
//       IN THE DRF, plus the actual mating size and the material-condition
//       limit, compute:
//         radial deviation  Δ = 2 * |actual - true|        (a DIAMETRAL zone),
//         bonus             = departure from the material-condition boundary
//                             toward the opposite limit (>= 0, clamped),
//         allowed zone Ø    = positionTolDia + bonus,
//       and PASS iff Δ <= allowedØ. RFS (no modifier) gives zero bonus. This is
//       the single most-used GD&T computation in mechanical inspection.
//
//   (3) FLATNESS (Y14.5 §5.4.2): least-squares best-fit plane of a measured
//       point set, then the flatness value = (max signed dist) - (min signed
//       dist) = full peak-to-valley band that contains every point. PASS iff
//       that band <= tol. (Reported alongside the max |signed distance| from
//       the fit plane, which the prompt names.)
//
//   (4) PERPENDICULARITY (Y14.5 §6.7): angular deviation between a measured
//       feature direction and a datum normal, converted to the orientation
//       deviation; PASS iff deviation <= tol. Both the angular form (for an
//       axis/line referenced to a datum over a stated feature length) and the
//       direct angle are returned so the caller can apply either zone model.
//
// WHAT IS STILL PMI-TEXT (NOT done here — stated honestly):
//   Profile-of-a-surface against a NURBS true profile, composite-frame lower-
//   segment refinement, datum-feature-simulator contact solving for irregular
//   surfaces, and the FCF STRING grammar all remain in asmeY145Rules.js. This
//   file evaluates the four characteristics above from coordinates; it does not
//   parse or emit FCF strings.
//
// CONVENTIONS: pure C++20, standard library only. No OCCT, no WASM, no third-
// party libs — mirrors forge/native/geom/Geom.hpp. All math is closed-form /
// 3x3 symmetric-eigen (Jacobi), so RANDOM valid inputs ALWAYS validate.

#ifndef FORGE_NATIVE_GDT_GDT_HPP
#define FORGE_NATIVE_GDT_GDT_HPP

#include <vector>
#include <cstddef>

namespace forge {
namespace native {
namespace gdt {

// ---------------------------------------------------------------------------
// Minimal 3-vector (header-only, trivial). Independent of geom::Point3 so the
// GD&T gate links with zero cross-class coupling.
// ---------------------------------------------------------------------------
struct Vec3 {
    double x{0.0};
    double y{0.0};
    double z{0.0};
};

double dot(const Vec3& a, const Vec3& b);
Vec3   cross(const Vec3& a, const Vec3& b);
Vec3   sub(const Vec3& a, const Vec3& b);
Vec3   add(const Vec3& a, const Vec3& b);
Vec3   scale(const Vec3& a, double s);
double norm(const Vec3& a);
Vec3   normalize(const Vec3& a);   // returns {0,0,0} for a zero vector

// A datum plane: any point ON the plane plus its (will-be-normalized) normal.
struct Plane {
    Vec3 point{};
    Vec3 normal{};
};

// ---------------------------------------------------------------------------
// (1) DATUM REFERENCE FRAME.
//
// Built from a primary plane A, secondary B, tertiary C. The frame axes are
//   axisZ : the (normalized, sign-preserved) normal of A,
//   axisX : B's normal with its A-component removed (Gram-Schmidt) -> ⊥ A,
//   axisY : axisZ × axisX                                          -> ⊥ A & X,
// giving a RIGHT-HANDED orthonormal basis. `origin` is the common intersection
// of the three planes (Cramer's rule on the three plane equations).
//
// `ok` is false when the inputs cannot form a frame: A degenerate, B parallel
// to A (no ⊥ component), or the three planes do not meet in a single point
// (near-singular system). In that case the basis/origin are left identity/zero.
// ---------------------------------------------------------------------------
struct DatumReferenceFrame {
    bool ok{false};
    Vec3 origin{};
    Vec3 axisX{1, 0, 0};
    Vec3 axisY{0, 1, 0};
    Vec3 axisZ{0, 0, 1};
    const char* reason{""};
};

DatumReferenceFrame buildDrf(const Plane& A, const Plane& B, const Plane& C);

// Express a world-space point in DRF coordinates: p' = R^T (p - origin), where
// R's columns are (axisX, axisY, axisZ). Inverse via transformToWorld().
Vec3 transformToDrf(const DatumReferenceFrame& drf, const Vec3& worldPt);
Vec3 transformToWorld(const DatumReferenceFrame& drf, const Vec3& drfPt);

// ---------------------------------------------------------------------------
// (2) TRUE POSITION with material-condition bonus.
//
// Inputs are taken IN THE DRF (XY plane = the position plane; the axis runs
// along Z). The feature is a FEATURE OF SIZE (a hole or a pin).
//
//   actual        : measured axis location (Z ignored — projected to XY).
//   trueLoc       : basic/true location the FCF calls for (XY).
//   actualSize    : measured actual mating size (diameter) of the feature.
//   materialLimit : the size at the called material condition:
//                     MMC of a HOLE = its SMALLEST diameter (least material
//                       removed -> tightest); bonus accrues as the hole grows.
//                     MMC of a PIN  = its LARGEST diameter; bonus accrues as
//                       the pin shrinks.
//                   LMC is the opposite extreme. RFS uses no boundary.
//   positionTolDia: the diameter of the position tolerance zone at the
//                   material condition (the value inside the FCF, after Ø).
// ---------------------------------------------------------------------------
enum class MaterialCondition {
    RFS,  // regardless of feature size — NO bonus
    MMC,  // maximum material condition — bonus as feature departs MMC
    LMC   // least material condition  — bonus as feature departs LMC
};

// Whether the feature of size is internal (hole) or external (pin/shaft).
// This sets the SIGN of "departure from the material boundary".
enum class FeatureType {
    HOLE,  // internal feature of size
    PIN    // external feature of size (a.k.a. shaft / boss)
};

struct Point2D {
    double x{0.0};
    double y{0.0};
};

struct TruePositionResult {
    double deviation{0.0};     // Δ = diametral position error = 2*|actual-true|
    double bonus{0.0};         // bonus tolerance (>=0), 0 for RFS
    double allowedZoneDia{0.0};// positionTolDia + bonus
    bool   pass{false};        // Δ <= allowedZoneDia
};

TruePositionResult evaluateTruePosition(const Point2D& actual,
                                        const Point2D& trueLoc,
                                        double actualSize,
                                        double materialLimit,
                                        double positionTolDia,
                                        MaterialCondition mc,
                                        FeatureType ft);

// ---------------------------------------------------------------------------
// (3) FLATNESS.
//
// Least-squares best-fit plane of the points (centroid + smallest-eigenvalue
// eigenvector of the covariance matrix), then:
//   maxAbsDeviation : max |signed distance| of any point from the fit plane,
//   flatness        : (max signed dist) - (min signed dist) = peak-to-valley
//                     band that contains every point — the Y14.5 flatness value.
// PASS iff flatness <= tol. `ok` is false for < 3 points or all-collinear input.
// ---------------------------------------------------------------------------
struct FlatnessResult {
    bool   ok{false};
    double flatness{0.0};        // peak-to-valley band width
    double maxAbsDeviation{0.0}; // max |signed distance| from the fit plane
    Plane  fitPlane{};           // the least-squares plane (point=centroid)
    bool   pass{false};
    const char* reason{""};
};

FlatnessResult evaluateFlatness(const std::vector<Vec3>& pts, double tol);

// ---------------------------------------------------------------------------
// (4) PERPENDICULARITY.
//
// `featureDir`  : measured direction of the controlled feature (axis or line).
// `datumNormal` : the normal of the datum the feature must be ⊥ to.
// A perfectly perpendicular feature has its DIRECTION PARALLEL to datumNormal,
// so the orientation error is the angle between featureDir and datumNormal.
//
//   angleDeg          : that angle, in degrees (0 = perfect).
//   deviation         : the orientation deviation across `featureLength`:
//                       featureLength * tan(angle). With featureLength left at
//                       its default 1.0 this equals tan(angle) ~= angle(rad).
//   pass              : deviation <= tol.
// ---------------------------------------------------------------------------
struct PerpendicularityResult {
    bool   ok{false};
    double angleDeg{0.0};
    double deviation{0.0};
    bool   pass{false};
    const char* reason{""};
};

PerpendicularityResult evaluatePerpendicularity(const Vec3& featureDir,
                                                const Vec3& datumNormal,
                                                double tol,
                                                double featureLength = 1.0);

} // namespace gdt
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GDT_GDT_HPP
