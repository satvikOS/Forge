// forge/native/brep/Nurbs.hpp
//
// In-house NURBS curve + surface EVALUATOR for the Forge native kernel
// (Stage 6 geom/ of KERNEL_INHOUSE_ROADMAP.md).
//
// ============================ HONESTY (Bible §0/§9) ========================
// FIRST increment of the geometry layer. What is REAL and VALIDATED here:
//
//   * Cox-de Boor B-spline basis function evaluation over an arbitrary clamped
//     or unclamped knot vector (the recurrence N_{i,0}, N_{i,p}).
//   * Rational (NURBS) curve point evaluation: weighted control points in
//     homogeneous form, projected back to Euclidean — exact for the standard
//     NURBS construction (e.g. a weighted quarter circle).
//   * Rational (NURBS) surface point evaluation over a tensor-product
//     (u,v) knot/control-point grid.
//   * Bezier special case for curve and surface: degree-p Bezier == B-spline
//     with the clamped knot vector [0..0, 1..1]; provided both as that
//     B-spline reduction AND as a direct de-Casteljau / Bernstein evaluator so
//     the two paths cross-check.
//   * INPUT VALIDATION (T-153) that holds in EVERY build, -DNDEBUG included:
//     a typed refusal (NurbsInputError) instead of an assert(). See the
//     contract block below.
//
// What is explicitly TARGETED (NOT built here):
//   * No derivatives / tangents / normals / curvature (the gate only checks
//     point values). No knot insertion, degree elevation, refinement, fitting,
//     intersection, or trimming. No binding onto the Topology faces/edges yet.
//
// Pure C++20, zero external dependencies (standard library only). No OCCT.
//
// CONVENTIONS: namespace forge::native::brep. Knot vector size must equal
// (controlPointCount + degree + 1). Weights default to 1 (polynomial B-spline).
//
// ======================= INPUT CONTRACT (T-153) =============================
// This file used to say malformed input was "the caller's responsibility
// (asserts, not silent fake)". That was false where it matters: the product is
// built with -DNDEBUG, every assert() vanished, and the evaluator divided by a
// zero rational denominator. T-149 counted 22 such files in its 72,573-file
// STEP corpus; MEASURED again here, the 6,771 files under
// archdisc-Models/data/external/mmcad_b_raw hold exactly 22 (all 10 that
// T-149 named among them). The debug build aborted on them; the Release build
// returned ok=true from readForeignStep with the NaN silently dropped. Their
// cause is NOT a zero weight (the smallest weight among the 111 entities they
// now refuse is 0.43) — it is an EMPTY KNOT SPAN: degree-3 knot vectors whose
// first value repeats 6-9 times (> degree+1), that are a single value, or that
// decrease by 1e-23, so the span the evaluator lands on has zero width and
// every basis function on it is 0. Weights and knots are both untrusted file
// content, so both are validated here.
//
// Three levels, each honest about what it checks:
//
//   1. validate()  — WHOLE-OBJECT check, O(size). THE gate for any curve or
//      surface built from external data (STEP/IGES importers call it). It
//      returns the FIRST defect found, in this order:
//        shape    : EmptyControlNet, RaggedControlNet, WeightShapeMismatch,
//                   DegreeBelowOne, TooFewControlPoints, KnotCountMismatch
//        knots    : NonFiniteKnot, DecreasingKnots, EmptyParameterDomain,
//                   KnotMultiplicityTooHigh (a run of more than degree+1 equal
//                   knots: ISO 10303-42 forbids it, and at a clamped end it is
//                   exactly the empty span that reached the division)
//        values   : NonFiniteWeight, NonPositiveWeight (0 or < 0 — ISO 10303-42
//                   and IGES both require every weight > 0), NonFiniteControlPoint
//      valid() == (validate() == NurbsInputError::None).
//
//   2. evaluateChecked() — validates EVERY DATUM THE EVALUATION READS: the
//      shapes it indexes, the parameter (NonFiniteParameter), the domain ends,
//      the located span, the 2*degree knots of the basis window, and the
//      (degree+1) [or (degreeU+1)*(degreeV+1)] weights and control points it
//      combines; then the accumulated denominator (DegenerateDenominator:
//      exactly 0 — the pole of the rational form, reachable by extrapolating
//      outside the domain — or not finite) and the
//      result (NonFiniteResult: overflow). The extra cost is the same order as
//      the evaluation itself — it does NOT rescan the whole object per call, so
//      a defect OUTSIDE the data an evaluation reads is caught by validate(),
//      not by this. It never asserts, never throws, never reads out of bounds,
//      never loops forever, and never returns ok == true with a non-finite
//      value.
//
//   3. evaluate() / bezier*Point() — the raw Vec3 forms every existing caller
//      uses. They delegate to the checked form and return refusedPoint() (a
//      quiet NaN in all three components) iff it refuses. For every input the
//      checked form accepts, the result is bit-identical to the pre-T-153
//      evaluator. A raw caller that must distinguish a refusal tests
//      std::isnan(p.x) — or, better, calls the checked form.
//
// No function here throws or aborts on bad input. The asserts that used to
// stand in for these checks are gone: a check that runs first and returns
// makes the assert beneath it unreachable, i.e. dead code.

#ifndef FORGE_NATIVE_BREP_NURBS_HPP
#define FORGE_NATIVE_BREP_NURBS_HPP

#include "forge/math/Vec3.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

// Feature macro: lets a gate compiled against BOTH this tree and a pre-T-153
// tree (to prove it fails first) know whether the typed API exists.
#define FORGE_NURBS_INPUT_VALIDATION 1

namespace forge {
namespace native {
namespace brep {

// Euclidean 3D point (re-declared standalone so Nurbs.hpp does not depend on
// Topology.hpp; the two share the same simple POD shape by intent).
// Vec3 is THE canonical forge::math::Vec3, not a local re-declaration.
//
// This subsystem declared its own layout-identical {double x,y,z}; so did nine
// others -- ten layout-identical types with ten names, which cannot interoperate
// without a conversion at every module seam. MEASURED before this patch: nine
// declarations under native/, and the canonical forge/math/Vec3.hpp included by
// no file under native/ at all. forge::math::Vec3 is a superset of every copy
// (it adds the arithmetic/dot/cross/norm each declared separately), so this is
// an alias, not a rewrite -- every existing use keeps compiling unchanged.
using Vec3 = forge::math::Vec3;

// ---------------------------------------------------------------------------
// NurbsInputError — the TYPED reason a curve/surface/evaluation is refused.
// Values are stable (a gate and a census key on them); append, never renumber.
// ---------------------------------------------------------------------------
enum class NurbsInputError : std::uint8_t {
    None = 0,
    // shape
    EmptyControlNet = 1,        // no control points, or an empty control row
    RaggedControlNet = 2,       // surface rows of different lengths
    WeightShapeMismatch = 3,    // weights do not have the control net's shape
    DegreeBelowOne = 4,         // degree < 1
    TooFewControlPoints = 5,    // fewer than degree+1 control points
    KnotCountMismatch = 6,      // knots.size() != controlPointCount + degree + 1
    // knots
    NonFiniteKnot = 7,          // NaN / +-inf knot
    DecreasingKnots = 8,        // knots[i+1] < knots[i] (non-monotone)
    EmptyParameterDomain = 9,   // knots[degree] == knots[count] — zero-length domain
    KnotMultiplicityTooHigh = 10, // a run of > degree+1 equal knots (empty spans)
    // values
    NonFiniteWeight = 11,       // NaN / +-inf weight
    NonPositiveWeight = 12,     // weight == 0 or < 0
    NonFiniteControlPoint = 13, // NaN / +-inf coordinate
    // evaluation
    NonFiniteParameter = 14,    // u / v / t is NaN or +-inf
    DegenerateDenominator = 15, // accumulated rational weight == 0 or not finite
    NonFiniteResult = 16,       // finite inputs overflowed to a non-finite point
};

// Stable snake_case token for a code, e.g. "empty_parameter_domain". Never
// null; "unknown" for an out-of-range value. Static storage.
const char* nurbsInputErrorName(NurbsInputError e) noexcept;

// ---------------------------------------------------------------------------
// PointEval — the evaluators' typed refusal. Same ok + reason shape as the
// kernel's other decline types (brep::SurfaceSample, ForeignReadResult,
// occtfillet::Result). `reason` is static text, empty iff ok; `code` is the
// typed reason when the refusal came from NURBS input validation (it stays
// NurbsInputError::None for ok, and for a refusal a caller composes from some
// other condition). `value` is meaningful only when ok; on a refusal it is a
// quiet NaN (refusedPoint()).
// ---------------------------------------------------------------------------
struct PointEval {
    bool            ok = false;
    const char*     reason = "";
    Vec3            value{};
    NurbsInputError code = NurbsInputError::None;
};

// The value a raw evaluator returns on a refusal: quiet NaN in all three
// components — deterministic and inspectable, never a fabricated coordinate.
Vec3 refusedPoint() noexcept;

// Diagnostic counter (the fallback-visibility rule: every refusal is counted,
// never silent). Number of evaluator calls in this process that REFUSED —
// checked or raw, curve, surface or Bezier. Relaxed atomic; touched only on
// the refusal path, never on a successful evaluation.
std::uint64_t nurbsEvaluationRefusals() noexcept;

// ---------------------------------------------------------------------------
// Cox-de Boor basis machinery (free functions, header-light core lives in cpp).
// ---------------------------------------------------------------------------

// Find the knot span index i such that knots[i] <= u < knots[i+1], clamped to
// the valid range [degree, controlPointCount-1]. Standard NURBS-book FindSpan.
//   n            = controlPointCount - 1 (index of last control point)
//   degree (p)   = spline degree
//   knots        = full knot vector, size n + p + 2
// PRECONDITION knots.size() == n + degree + 2 and n >= degree (validate()
// checks both). Under that precondition the result is always in [degree, n],
// even for a malformed knot vector:
//   * at or beyond a domain end it returns the nearest NON-EMPTY span. The
//     NURBS-book form returned `degree` / `n` even when that span had zero
//     width (an unclamped vector with a repeated knot at the domain end, or a
//     clamped end repeated more than degree+1 times), which put every basis
//     function at 0 — the T-153 division;
//   * the interior bisection terminates on any vector (its bracket invariant
//     holds without monotonicity), but on a non-monotone vector the basis
//     window around the span can be decreasing; evaluateChecked() refuses
//     that (DecreasingKnots).
// For every vector whose end spans are non-empty — every clamped vector with
// end multiplicity <= degree+1 — the result is identical to the NURBS-book
// FindSpan.
std::size_t findSpan(std::size_t n, std::size_t degree,
                     double u, const std::vector<double>& knots);

// Evaluate the (degree+1) non-zero basis functions N_{span-p..span, p}(u) at u,
// using the Cox-de Boor recurrence. Returns a vector of length degree+1.
std::vector<double> basisFunctions(std::size_t span, double u,
                                   std::size_t degree,
                                   const std::vector<double>& knots);

// ---------------------------------------------------------------------------
// NurbsCurve — rational B-spline curve.
//   controlPoints[i] is a Euclidean point; weights[i] its weight (>0).
//   knots.size() == controlPoints.size() + degree + 1.
// ---------------------------------------------------------------------------
struct NurbsCurve {
    std::size_t degree = 0;
    std::vector<Vec3> controlPoints;
    std::vector<double> weights;   // same length as controlPoints (default 1)
    std::vector<double> knots;     // size = controlPoints.size() + degree + 1

    // Whole-object input validation (contract level 1). O(size). The first
    // defect found, or NurbsInputError::None.
    NurbsInputError validate() const noexcept;

    // validate() == NurbsInputError::None. (Before T-153 this tested sizes
    // only, so a zero weight or an empty knot span passed it.)
    bool valid() const;

    // Evaluate C(u), REFUSING with a typed code on any datum it cannot answer
    // for (contract level 2). The entry point to prefer.
    PointEval evaluateChecked(double u) const;

    // Evaluate the curve point C(u). For a rational curve this divides the
    // homogeneous accumulation by the accumulated weight. Raw form (contract
    // level 3): refusedPoint() iff evaluateChecked() refuses, else bit-identical
    // to the pre-T-153 result.
    Vec3 evaluate(double u) const;
};

// ---------------------------------------------------------------------------
// NurbsSurface — rational tensor-product B-spline surface.
//   control[i][j] over a (nU x nV) grid; weights[i][j] the matching weights.
//   knotsU.size() == nU + degreeU + 1,  knotsV.size() == nV + degreeV + 1.
// ---------------------------------------------------------------------------
struct NurbsSurface {
    std::size_t degreeU = 0;
    std::size_t degreeV = 0;
    // control[i][j]: i indexes U direction (0..nU-1), j indexes V (0..nV-1).
    std::vector<std::vector<Vec3>> control;
    std::vector<std::vector<double>> weights;
    std::vector<double> knotsU;
    std::vector<double> knotsV;

    // Whole-object input validation (contract level 1). O(nU * nV).
    NurbsInputError validate() const noexcept;

    // validate() == NurbsInputError::None.
    bool valid() const;

    // Evaluate S(u,v), REFUSING with a typed code (contract level 2).
    PointEval evaluateChecked(double u, double v) const;

    // Evaluate the surface point S(u,v). Raw form (contract level 3).
    Vec3 evaluate(double u, double v) const;
};

// ---------------------------------------------------------------------------
// Bezier special cases (direct evaluators, independent of the B-spline path).
//   These exist as the "Bezier special case" required by the gate AND as an
//   independent cross-check of the general B-spline evaluator above (a clamped
//   knot vector [0,...,0,1,...,1] must reproduce these exactly).
// ---------------------------------------------------------------------------

// de Casteljau evaluation of a (rational) Bezier curve of degree
// controlPoints.size()-1 at parameter t in [0,1]. Raw form: refusedPoint() iff
// bezierCurvePointChecked() refuses.
Vec3 bezierCurvePoint(const std::vector<Vec3>& controlPoints,
                      const std::vector<double>& weights,
                      double t);

// Checked form. A de Casteljau pass reads every input, so this validates all
// of it: EmptyControlNet, WeightShapeMismatch, NonFiniteParameter,
// NonFiniteWeight, NonPositiveWeight, NonFiniteControlPoint, then
// DegenerateDenominator / NonFiniteResult. (Pre-T-153 the empty list read out
// of bounds and a short weights list returned uninitialised heap.)
PointEval bezierCurvePointChecked(const std::vector<Vec3>& controlPoints,
                                  const std::vector<double>& weights,
                                  double t);

// Tensor-product (rational) Bezier surface point at (u,v).
//   control[i][j], i over U (degreeU = nU-1), j over V (degreeV = nV-1).
// Raw form: refusedPoint() iff bezierSurfacePointChecked() refuses.
Vec3 bezierSurfacePoint(const std::vector<std::vector<Vec3>>& control,
                        const std::vector<std::vector<double>>& weights,
                        double u, double v);

// Checked form. Refuses an empty grid or row, a ragged grid (a tensor product
// is rectangular), a weights grid of another shape (pre-T-153 that was read
// past its end with no guard at all), and the value defects listed for the
// curve form.
PointEval bezierSurfacePointChecked(const std::vector<std::vector<Vec3>>& control,
                                    const std::vector<std::vector<double>>& weights,
                                    double u, double v);

// Build the clamped Bezier knot vector [0 (p+1 times), 1 (p+1 times)] for a
// degree-p Bezier so a NurbsCurve/Surface can represent the same Bezier and be
// cross-checked against the direct evaluators above.
std::vector<double> bezierKnotVector(std::size_t degree);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_NURBS_HPP
