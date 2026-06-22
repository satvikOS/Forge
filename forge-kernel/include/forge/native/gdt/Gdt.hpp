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

// ===========================================================================
// (5) GEOMETRIC GD&T / FCF VALIDATOR (task #26).
//
// The four primitives above evaluate ONE feature's reduced parameters (an axis
// point, a fit-plane band, a direction). This section closes the rest of the
// inspection loop the Forge Engineering Bible calls for: it validates a SAMPLED
// POINT SET (CMM/QIF probe points, QIF MeasurementResults, or tessellation
// samples) against the actual 3D TOLERANCE ZONE of a characteristic, computes
// the MMC/LMC geometric BONUS from the feature's actual size, and checks the
// LEGALITY of a feature-control frame (datums exist + ordered, characteristic
// legal for the feature, material-condition modifier valid).
//
// All point-set validators take points already expressed IN THE DRF (the caller
// runs transformToDrf() first), matching the convention of (2)/(3)/(4) that
// tolerances are evaluated in the datum reference frame, never in world space.
//
// ASME Y14.5-2018 zone definitions encoded here (verbatim intent):
//   * POSITION (§7.3): Ø zone = positionTol + bonus, a CYLINDER on the basic
//     axis; a sample at radius r from that axis contributes diametral 2r.
//   * FLATNESS (§5.4.2): two parallel planes `tol` apart; value = peak-to-valley
//     of the LS-plane signed distances. No datum.
//   * PERPENDICULARITY/PARALLELISM/ANGULARITY (§6.7–6.9): two parallel planes
//     `tol` apart oriented at the basic angle (90°/0°/θ) to the datum; value =
//     the band of the points projected on the datum-relative direction.
//   * CIRCULARITY (§5.4.3): two coaxial circles radially `tol` apart (one cross
//     section); value = R_max − R_min of the LS circle. No datum, no modifier.
//   * CYLINDRICITY (§5.4.4): two coaxial cylinders radially `tol` apart over the
//     whole surface; value = R_max − R_min about the LS axis. No datum, no mod.
//   * PROFILE-OF-A-SURFACE (§11): a band of width `tol` about the true profile,
//     NORMAL to it; bilateral = ±tol/2 (default), unilateral = 0..tol; value =
//     max |signed normal deviation|.
//   * BONUS (§7.3.3): departure of the actual mating size from the material-
//     condition boundary toward the opposite limit, clamped >= 0 (mirrors the
//     branch already inside evaluateTruePosition).
// ===========================================================================

// The high-value geometric characteristic subset covered by task #26.
enum class Characteristic {
    POSITION,
    FLATNESS,
    PERPENDICULARITY,
    PARALLELISM,
    ANGULARITY,
    CIRCULARITY,
    CYLINDRICITY,
    PROFILE_SURFACE
};

// The geometry family of the tolerance zone.
enum class ZoneType {
    CYLINDRICAL,         // position of an axis: a Ø cylinder zone
    TWO_PARALLEL_PLANES, // flatness, orientation of a planar feature (total-wide)
    TWO_COAXIAL_CYL,     // circularity / cylindricity (radial band)
    BILATERAL_PROFILE,   // profile of a surface, ±tol/2 about the true profile
    UNILATERAL_PROFILE   // profile of a surface, 0..tol about the true profile
};

// The kind of feature a characteristic is applied to (for FCF legality).
enum class ControlledFeature {
    PLANAR_SURFACE,   // a nominally flat face
    CYLINDER_AXIS,    // the derived median line / axis of a cylinder
    CYLINDER_SURFACE, // the cylindrical surface itself
    FEATURE_OF_SIZE,  // a regular FoS (hole/pin/slot/tab) that has MMC/LMC
    LINE_ELEMENT      // a single 2D line element / cross-section
};

// ---------------------------------------------------------------------------
// (a) The verdict returned by every point-set validator.
//
//   allowedZone        : the FULL zone width or diameter AT the material
//                        condition = stated tol + bonus.
//   bonus              : MMC/LMC bonus added (0 for RFS or a non-FoS control).
//   worstDeviationMm   : the worst single value in the zone's own metric
//                        (diametral 2r for position, the p2v band for a plane
//                        zone, R_max−R_min for a radial zone, max |normal dev|
//                        for profile) — directly comparable to allowedZone.
//   conformingFraction : fraction of sampled points that lie inside the zone.
// ---------------------------------------------------------------------------
struct ToleranceZoneVerdict {
    bool           pass{false};
    Characteristic characteristic{Characteristic::POSITION};
    ZoneType       zoneType{ZoneType::CYLINDRICAL};
    double         allowedZone{0.0};
    double         bonus{0.0};
    double         worstDeviationMm{0.0};
    double         conformingFraction{1.0};
    bool           ok{true};
    const char*    reason{""};
};

// ---------------------------------------------------------------------------
// (c) MMC / LMC geometric bonus from the actual size vs the material limit.
//
// Mirrors evaluateTruePosition's bonus branch (Y14.5 §7.3.3) bit-for-bit:
//   HOLE@MMC bonus = actualSize − materialLimit;  PIN@MMC = materialLimit − actualSize;
//   HOLE@LMC bonus = materialLimit − actualSize;   PIN@LMC = actualSize − materialLimit;
//   RFS bonus = 0. All clamped >= 0 (a feature outside its size limit is a SIZE
//   reject and earns no position bonus). Numerically equal to
//   evaluateTruePosition(...).bonus for the same inputs.
// ---------------------------------------------------------------------------
double mmcBonus(double actualSize, double materialLimit,
                MaterialCondition mc, FeatureType ft);

// ---------------------------------------------------------------------------
// (a) Per-characteristic SAMPLED-POINT-SET validators (points in the DRF).
// ---------------------------------------------------------------------------

// POSITION of an axis: a cylindrical zone Ø = positionTolDia + bonus, centered
// on the basic axis (trueLoc in XY, axis along DRF Z). Each sample's radial
// distance r from the basic axis gives a diametral deviation 2r; the worst is
// the controlling value. Pass iff worst <= Ø. `actualSize`/`materialLimit`/`mc`/
// `ft` feed mmcBonus(); pass RFS for no bonus.
ToleranceZoneVerdict validatePositionPointSet(
    const std::vector<Vec3>& axisSamplesDrf, const Point2D& trueLoc,
    double actualSize, double materialLimit, double positionTolDia,
    MaterialCondition mc, FeatureType ft);

// FLATNESS: two parallel planes `tol` apart (LS plane via evaluateFlatness);
// worst = the peak-to-valley band.
ToleranceZoneVerdict validateFlatnessPointSet(
    const std::vector<Vec3>& pts, double tol);

// PERPENDICULARITY / PARALLELISM / ANGULARITY of a planar surface to a datum
// whose normal is `datumNormal`: two parallel planes `tol` apart oriented at the
// basic angle (0° parallel, 90° perp, θ angularity) to the datum. The band is
// measured along the NOMINAL DATUM-RELATIVE ZONE NORMAL — a FIXED direction the
// datum + basic angle define, NOT the points' own best-fit normal — so a flat
// feature MIS-ORIENTED to its datum FAILS (a flat-but-tilted plate has a large
// band along the fixed nominal normal), per ASME Y14.5-2018 §6.7–6.9.
//
// The nominal zone normal is recovered as:
//   parallelism  (0°)  : datumNormal               (feature ∥ datum).
//   perpendicularity(90°): the in-plane nominal feature normal — it lies IN the
//                          datum plane (⊥ datumNormal); the caller MUST supply a
//                          reference direction in `nominalFeatureNormal` (the
//                          drawing's nominal feature-surface normal). It is
//                          projected into the datum plane (Gram-Schmidt), never
//                          guessed.
//   angularity   (θ)   : datumNormal rotated by the basic angle θ toward the
//                          in-plane reference (0°→datumNormal, 90°→in-plane).
// `nominalFeatureNormal` is REQUIRED for perpendicularity & angularity (any
// non-zero direction not parallel to datumNormal); it is ignored for parallelism.
// worst = the peak-to-valley band of the points projected onto that zone normal.
ToleranceZoneVerdict validateOrientationPointSet(
    const std::vector<Vec3>& pts, const Vec3& datumNormal,
    Characteristic c, double basicAngleDeg, double tol,
    const Vec3& nominalFeatureNormal = Vec3{0, 0, 0});

// CIRCULARITY of ONE cross-section (points in the DRF XY plane): two coaxial
// circles radially `tol` apart; worst = R_max − R_min about the LS-fit center.
ToleranceZoneVerdict validateCircularityPointSet(
    const std::vector<Vec3>& sectionPtsDrf, double tol);

// CYLINDRICITY of a whole surface (points in the DRF, axis ~ Z): two coaxial
// cylinders radially `tol` apart; worst = R_max − R_min about the LS axis.
ToleranceZoneVerdict validateCylindricityPointSet(
    const std::vector<Vec3>& surfacePtsDrf, double tol);

// PROFILE-OF-A-SURFACE: a band about the true profile, normal to it. The true
// profile is sampled as (truePoint, outwardNormal) pairs aligned index-wise to
// the measured points. worst = max |signed normal deviation|. Bilateral pass iff
// worst <= tol/2; unilateral (outward 0..tol) pass iff every dev in [0, tol].
ToleranceZoneVerdict validateProfilePointSet(
    const std::vector<Vec3>& measuredPts,
    const std::vector<Vec3>& trueProfilePts,
    const std::vector<Vec3>& trueProfileNormals,
    double profileTol, bool unilateral);

// ---------------------------------------------------------------------------
// (a') Unified dispatcher.
//
// Routes to the correct per-characteristic validator above from a single entry
// point. `pts` are the sampled feature points IN THE DRF. For POSITION the basic
// axis location is taken from `featureCenter` (XY) and the bonus from
// `actualSize`/`mmcSize`/`mc`/`ft`. For orientation `featureAxis` is the datum
// normal, `basicAngleDeg` the basic angle, and `nominalFeatureNormal` the
// drawing's nominal feature-surface normal (REQUIRED for perpendicularity &
// angularity; ignored for parallelism). For profile, pass the true-profile
// points/normals; otherwise leave them empty.
ToleranceZoneVerdict validatePointSetAgainstZone(
    Characteristic c, const std::vector<Vec3>& pts,
    const Point2D& featureCenter, const Vec3& featureAxis,
    double tol, double basicAngleDeg,
    MaterialCondition mc, FeatureType ft, double actualSize, double mmcSize,
    const std::vector<Vec3>& trueProfilePts = {},
    const std::vector<Vec3>& trueProfileNormals = {},
    bool unilateralProfile = false,
    const Vec3& nominalFeatureNormal = Vec3{0, 0, 0});

// ---------------------------------------------------------------------------
// (b) FCF LEGALITY checker (geometric feasibility — datum existence/order, the
// characteristic-vs-feature pairing, and modifier validity — NOT string syntax).
// ---------------------------------------------------------------------------
struct FcfLegality {
    bool        legal{false};
    const char* reason{""};
};

// datumRefs       : ordered datum letters actually referenced (e.g. {'A','B','C'}).
// availableDatums : datum letters that EXIST on the part.
// Checks: every referenced datum exists; <= 3 refs, no duplicates; the
// characteristic is legal for `feat` (flatness/circularity take NO datum;
// position needs a FoS + at least one datum; etc.); the material-condition
// modifier is valid (MMC/LMC only on a feature-of-size characteristic, RFS
// otherwise; form/profile controls cannot carry MMC/LMC).
FcfLegality checkFcfLegality(
    Characteristic c, ControlledFeature feat, MaterialCondition mc,
    const std::vector<char>& datumRefs, const std::vector<char>& availableDatums);

} // namespace gdt
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GDT_GDT_HPP
