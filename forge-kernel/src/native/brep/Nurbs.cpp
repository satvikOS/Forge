// forge/native/brep/Nurbs.cpp
//
// Implementation of the in-house NURBS/Bezier evaluator (Nurbs.hpp).
// Pure C++20, no external dependencies. See header for honesty / scope, and
// for the T-153 INPUT CONTRACT this file implements.
//
// References (algorithms re-implemented from the standard mathematical
// definitions, not copied source): the Cox-de Boor recurrence and the
// FindSpan / BasisFuns formulation in Piegl & Tiller "The NURBS Book". The
// validation rules follow the ISO 10303-42 b_spline_curve_with_knots /
// rational_b_spline_* WHERE rules (weights > 0, knots non-decreasing, a knot
// run never longer than degree+1) restated from the public schema. (The
// schema also caps INTERIOR multiplicity at degree; that is not enforced here,
// because an interior run of degree+1 — a C^-1 join — still evaluates exactly.)
//
// BIT-IDENTITY: every arithmetic expression on the success path (the basis
// recurrence, the homogeneous accumulation order, the final division, the de
// Casteljau blends) is the pre-T-153 expression, unchanged. The checks only
// decide WHETHER to compute; they never alter WHAT is computed.

#include "forge/native/brep/Nurbs.hpp"

#include <atomic>
#include <cmath>
#include <cstdint>
#include <limits>

namespace forge {
namespace native {
namespace brep {

namespace {

std::atomic<std::uint64_t> g_refusals{0};

inline bool finite3(const Vec3& p) {
    return std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z);
}

// Build a refusal: typed code + its stable token as the reason, quiet-NaN value.
// Counted (the fallback-visibility rule).
inline PointEval refuse(NurbsInputError code) {
    g_refusals.fetch_add(1, std::memory_order_relaxed);
    PointEval r;
    r.ok = false;
    r.code = code;
    r.reason = nurbsInputErrorName(code);
    r.value = refusedPoint();
    return r;
}

inline NurbsInputError checkWeight(double w) {
    if (!std::isfinite(w)) return NurbsInputError::NonFiniteWeight;
    if (!(w > 0.0)) return NurbsInputError::NonPositiveWeight;
    return NurbsInputError::None;
}

// Shape of one parametric direction with `count` control points (n + 1) of
// degree `p`. Written so no expression can wrap: a corrupt file can carry a
// degree that llround()s to a negative number, i.e. SIZE_MAX as std::size_t,
// and `count < p + 1` / `count + p + 1` would then wrap to a check that passes.
// `p >= count` first makes count + p + 1 safe.
NurbsInputError validateDirectionShape(const std::vector<double>& knots,
                                       std::size_t count, std::size_t p) {
    if (p < 1) return NurbsInputError::DegreeBelowOne;
    if (p >= count) return NurbsInputError::TooFewControlPoints;
    if (knots.size() != count + p + 1) return NurbsInputError::KnotCountMismatch;
    return NurbsInputError::None;
}

// Whole-vector knot VALUE validation for one direction whose shape passed
// validateDirectionShape().
NurbsInputError validateKnotValues(const std::vector<double>& knots,
                                   std::size_t count, std::size_t p) {
    for (double k : knots)
        if (!std::isfinite(k)) return NurbsInputError::NonFiniteKnot;
    for (std::size_t i = 1; i < knots.size(); ++i)
        if (knots[i] < knots[i - 1]) return NurbsInputError::DecreasingKnots;
    // Domain [knots[p], knots[count]] (== [U_p, U_{n+1}]) must have length.
    if (!(knots[p] < knots[count])) return NurbsInputError::EmptyParameterDomain;
    // No run of more than p+1 equal knots. At a clamped end such a run makes
    // the end span(s) zero-width — every basis function there is 0, which is
    // exactly the division T-153 measured. ISO 10303-42 forbids it.
    std::size_t run = 1;
    for (std::size_t i = 1; i < knots.size(); ++i) {
        run = (knots[i] == knots[i - 1]) ? run + 1 : 1;
        if (run > p + 1) return NurbsInputError::KnotMultiplicityTooHigh;
    }
    return NurbsInputError::None;
}

// Locate the span for u, then check the knots the basis recurrence reads:
// knots[span+1-p .. span+p] (a window that contains the span's own two knots).
// Preconditions (checked by every caller): knots.size() == n + p + 2, n >= p,
// u finite, knots[p] < knots[n+1] both finite. findSpan() then returns a span in
// [p, n], so the window is in bounds; a NaN or a decrease inside it would make
// the recurrence compute a meaningless (possibly finite) basis, so it refuses.
NurbsInputError locateCheckedSpan(std::size_t n, std::size_t p, double u,
                                  const std::vector<double>& knots,
                                  std::size_t& span) {
    span = findSpan(n, p, u, knots);
    const std::size_t lo = span + 1 - p;   // span >= p, so no underflow
    const std::size_t hi = span + p;       // span <= n, so hi <= n + p < size
    for (std::size_t i = lo; i <= hi; ++i) {
        if (!std::isfinite(knots[i])) return NurbsInputError::NonFiniteKnot;
        if (i > lo && knots[i] < knots[i - 1]) return NurbsInputError::DecreasingKnots;
    }
    return NurbsInputError::None;
}

// O(1) checks shared by curve/surface evaluation for one direction: degree,
// count, knot count, domain ends. (validateDirectionShape + validateKnotValues
// are the O(size) whole-vector superset that validate() runs.)
NurbsInputError quickDirectionCheck(const std::vector<double>& knots,
                                    std::size_t count, std::size_t p) {
    const NurbsInputError s = validateDirectionShape(knots, count, p);
    if (s != NurbsInputError::None) return s;
    const double a = knots[p], b = knots[count];
    if (!std::isfinite(a) || !std::isfinite(b)) return NurbsInputError::NonFiniteKnot;
    if (b < a) return NurbsInputError::DecreasingKnots;
    if (!(a < b)) return NurbsInputError::EmptyParameterDomain;
    return NurbsInputError::None;
}

// Homogeneous accumulator used by both curve and surface rational evaluation.
struct Homog {
    double x = 0, y = 0, z = 0, w = 0;
    void add(const Vec3& p, double weight, double basis) {
        const double wb = weight * basis;
        x += p.x * wb;
        y += p.y * wb;
        z += p.z * wb;
        w += wb;
    }
    // w is the accumulated rational denominator; for a valid NURBS with
    // positive weights and a partition-of-unity basis it is strictly > 0
    // inside the domain. Outside it (extrapolation) it can reach 0 — the pole
    // of the rational parameterisation — so this is a CHECK, not an
    // assumption. Pre-T-153 it was an assert() on |w| > 0, compiled out under
    // -DNDEBUG, after which the division ran on w == 0. The refused set is
    // exactly what that assert stated (w == 0) plus a non-finite w; a NEGATIVE
    // w (extrapolation past the pole) still divides, as it always did, so no
    // FINITE answer the old evaluator gave for valid input changes. The division is
    // unchanged, so every accepted answer is bit-identical.
    NurbsInputError project(Vec3& out) const {
        if (!std::isfinite(w) || w == 0.0) return NurbsInputError::DegenerateDenominator;
        out = Vec3{x / w, y / w, z / w};
        if (!finite3(out)) return NurbsInputError::NonFiniteResult;
        return NurbsInputError::None;
    }
};

} // namespace

// ---------------------------------------------------------------------------
// Names, refusal value, counter.
// ---------------------------------------------------------------------------
const char* nurbsInputErrorName(NurbsInputError e) noexcept {
    switch (e) {
    case NurbsInputError::None:                    return "none";
    case NurbsInputError::EmptyControlNet:         return "empty_control_net";
    case NurbsInputError::RaggedControlNet:        return "ragged_control_net";
    case NurbsInputError::WeightShapeMismatch:     return "weight_shape_mismatch";
    case NurbsInputError::DegreeBelowOne:          return "degree_below_one";
    case NurbsInputError::TooFewControlPoints:     return "too_few_control_points";
    case NurbsInputError::KnotCountMismatch:       return "knot_count_mismatch";
    case NurbsInputError::NonFiniteKnot:           return "non_finite_knot";
    case NurbsInputError::DecreasingKnots:         return "decreasing_knots";
    case NurbsInputError::EmptyParameterDomain:    return "empty_parameter_domain";
    case NurbsInputError::KnotMultiplicityTooHigh: return "knot_multiplicity_too_high";
    case NurbsInputError::NonFiniteWeight:         return "non_finite_weight";
    case NurbsInputError::NonPositiveWeight:       return "non_positive_weight";
    case NurbsInputError::NonFiniteControlPoint:   return "non_finite_control_point";
    case NurbsInputError::NonFiniteParameter:      return "non_finite_parameter";
    case NurbsInputError::DegenerateDenominator:   return "degenerate_denominator";
    case NurbsInputError::NonFiniteResult:         return "non_finite_result";
    }
    return "unknown";
}

Vec3 refusedPoint() noexcept {
    const double qnan = std::numeric_limits<double>::quiet_NaN();
    return Vec3{qnan, qnan, qnan};
}

std::uint64_t nurbsEvaluationRefusals() noexcept {
    return g_refusals.load(std::memory_order_relaxed);
}

// ---------------------------------------------------------------------------
// findSpan — locate the knot span containing u.
// ---------------------------------------------------------------------------
std::size_t findSpan(std::size_t n, std::size_t degree,
                     double u, const std::vector<double>& knots) {
    // At (or past) the last knot of the domain: the LAST NON-EMPTY span <= n.
    // The NURBS-book form returns n unconditionally; for a clamped vector
    // knots[n] < knots[n+1], so the walk below does not move and the answer is
    // still n. When knots[n] == knots[n+1] span n has zero width (every basis
    // function on it is 0), and stepping left to the span that actually ends at
    // the domain end is the left limit the clamped case already computes.
    if (u >= knots[n + 1]) {
        std::size_t s = n;
        while (s > degree && !(knots[s] < knots[n + 1])) --s;
        return s;
    }
    // At (or before) the first knot of the domain: the FIRST NON-EMPTY span >= p
    // (the right limit), for the same reason. Clamped vectors: unchanged (p).
    if (u <= knots[degree]) {
        std::size_t s = degree;
        while (s < n && !(knots[degree] < knots[s + 1])) ++s;
        return s;
    }

    // Binary search over [degree, n+1] (unchanged). It terminates, in range,
    // on ANY knot vector — monotone or not: `low` only ever moves to a mid with
    // u >= knots[mid] and `high` to a mid with u < knots[mid], so
    // knots[low] <= u < knots[high] holds throughout (NaN aside); while
    // high - low >= 2 the mid is strictly inside and the bracket shrinks, and
    // at high == low + 1 the loop condition is false. So a non-monotone vector
    // yields a span that CONTAINS u but whose basis window may be decreasing —
    // evaluateChecked() checks that window.
    std::size_t low = degree;
    std::size_t high = n + 1;
    std::size_t mid = (low + high) / 2;
    while (u < knots[mid] || u >= knots[mid + 1]) {
        if (u < knots[mid]) high = mid;
        else                low = mid;
        mid = (low + high) / 2;
    }
    return mid;
}

// ---------------------------------------------------------------------------
// basisFunctions — the (degree+1) nonzero basis values at u via Cox-de Boor.
//
// This is the numerically-stable triangular form: it avoids 0/0 by carrying
// `left`/`right` differences, exactly as the recurrence
//   N_{i,0}(u) = 1 if knots[i] <= u < knots[i+1] else 0
//   N_{i,p}(u) = (u-knots[i])/(knots[i+p]-knots[i]) * N_{i,p-1}(u)
//              + (knots[i+p+1]-u)/(knots[i+p+1]-knots[i+1]) * N_{i+1,p-1}(u)
// demands, but computed forward to keep all the nonzero values together.
// ---------------------------------------------------------------------------
std::vector<double> basisFunctions(std::size_t span, double u,
                                   std::size_t degree,
                                   const std::vector<double>& knots) {
    std::vector<double> N(degree + 1, 0.0);
    std::vector<double> left(degree + 1, 0.0);
    std::vector<double> right(degree + 1, 0.0);

    N[0] = 1.0;
    for (std::size_t j = 1; j <= degree; ++j) {
        left[j]  = u - knots[span + 1 - j];
        right[j] = knots[span + j] - u;
        double saved = 0.0;
        for (std::size_t r = 0; r < j; ++r) {
            const double denom = right[r + 1] + left[j - r];
            // denom is a knot-difference; zero only at a repeated knot where
            // the corresponding N is already zero, so guard against 0/0.
            const double temp = (denom != 0.0) ? (N[r] / denom) : 0.0;
            N[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
    return N;
}

// ---------------------------------------------------------------------------
// NurbsCurve
// ---------------------------------------------------------------------------
NurbsInputError NurbsCurve::validate() const noexcept {
    if (controlPoints.empty()) return NurbsInputError::EmptyControlNet;
    if (weights.size() != controlPoints.size()) return NurbsInputError::WeightShapeMismatch;
    {
        const NurbsInputError e = validateDirectionShape(knots, controlPoints.size(), degree);
        if (e != NurbsInputError::None) return e;
    }
    {
        const NurbsInputError e = validateKnotValues(knots, controlPoints.size(), degree);
        if (e != NurbsInputError::None) return e;
    }
    for (double wi : weights) {
        const NurbsInputError e = checkWeight(wi);
        if (e != NurbsInputError::None) return e;
    }
    for (const Vec3& p : controlPoints)
        if (!finite3(p)) return NurbsInputError::NonFiniteControlPoint;
    return NurbsInputError::None;
}

bool NurbsCurve::valid() const {
    return validate() == NurbsInputError::None;
}

PointEval NurbsCurve::evaluateChecked(double u) const {
    if (controlPoints.empty()) return refuse(NurbsInputError::EmptyControlNet);
    if (weights.size() != controlPoints.size()) return refuse(NurbsInputError::WeightShapeMismatch);
    {
        const NurbsInputError e = quickDirectionCheck(knots, controlPoints.size(), degree);
        if (e != NurbsInputError::None) return refuse(e);
    }
    if (!std::isfinite(u)) return refuse(NurbsInputError::NonFiniteParameter);

    const std::size_t n = controlPoints.size() - 1;
    std::size_t span = 0;
    {
        const NurbsInputError e = locateCheckedSpan(n, degree, u, knots, span);
        if (e != NurbsInputError::None) return refuse(e);
    }
    // The (degree+1) weights and control points this evaluation combines.
    for (std::size_t i = 0; i <= degree; ++i) {
        const std::size_t idx = span - degree + i;
        const NurbsInputError e = checkWeight(weights[idx]);
        if (e != NurbsInputError::None) return refuse(e);
        if (!finite3(controlPoints[idx])) return refuse(NurbsInputError::NonFiniteControlPoint);
    }

    const std::vector<double> N = basisFunctions(span, u, degree, knots);
    Homog acc;
    for (std::size_t i = 0; i <= degree; ++i) {
        const std::size_t idx = span - degree + i;
        acc.add(controlPoints[idx], weights[idx], N[i]);
    }
    PointEval r;
    const NurbsInputError e = acc.project(r.value);
    if (e != NurbsInputError::None) return refuse(e);
    r.ok = true;
    return r;
}

Vec3 NurbsCurve::evaluate(double u) const {
    const PointEval r = evaluateChecked(u);
    return r.ok ? r.value : refusedPoint();
}

// ---------------------------------------------------------------------------
// NurbsSurface
// ---------------------------------------------------------------------------
NurbsInputError NurbsSurface::validate() const noexcept {
    if (control.empty()) return NurbsInputError::EmptyControlNet;
    const std::size_t nU = control.size();
    const std::size_t nV = control[0].size();
    if (nV == 0) return NurbsInputError::EmptyControlNet;
    for (std::size_t i = 0; i < nU; ++i) {
        if (control[i].empty()) return NurbsInputError::EmptyControlNet;
        if (control[i].size() != nV) return NurbsInputError::RaggedControlNet;
    }
    if (weights.size() != nU) return NurbsInputError::WeightShapeMismatch;
    for (std::size_t i = 0; i < nU; ++i)
        if (weights[i].size() != nV) return NurbsInputError::WeightShapeMismatch;
    // Shape of BOTH directions before the values of either, so the code order
    // is the one the header documents (shape, then knots, then values).
    {
        const NurbsInputError e = validateDirectionShape(knotsU, nU, degreeU);
        if (e != NurbsInputError::None) return e;
    }
    {
        const NurbsInputError e = validateDirectionShape(knotsV, nV, degreeV);
        if (e != NurbsInputError::None) return e;
    }
    {
        const NurbsInputError e = validateKnotValues(knotsU, nU, degreeU);
        if (e != NurbsInputError::None) return e;
    }
    {
        const NurbsInputError e = validateKnotValues(knotsV, nV, degreeV);
        if (e != NurbsInputError::None) return e;
    }
    for (std::size_t i = 0; i < nU; ++i)
        for (std::size_t j = 0; j < nV; ++j) {
            const NurbsInputError e = checkWeight(weights[i][j]);
            if (e != NurbsInputError::None) return e;
        }
    for (std::size_t i = 0; i < nU; ++i)
        for (std::size_t j = 0; j < nV; ++j)
            if (!finite3(control[i][j])) return NurbsInputError::NonFiniteControlPoint;
    return NurbsInputError::None;
}

bool NurbsSurface::valid() const {
    return validate() == NurbsInputError::None;
}

PointEval NurbsSurface::evaluateChecked(double u, double v) const {
    if (control.empty() || control[0].empty()) return refuse(NurbsInputError::EmptyControlNet);
    if (weights.size() != control.size()) return refuse(NurbsInputError::WeightShapeMismatch);
    const std::size_t nU = control.size();
    const std::size_t nV = control[0].size();
    {
        const NurbsInputError e = quickDirectionCheck(knotsU, nU, degreeU);
        if (e != NurbsInputError::None) return refuse(e);
    }
    {
        const NurbsInputError e = quickDirectionCheck(knotsV, nV, degreeV);
        if (e != NurbsInputError::None) return refuse(e);
    }
    if (!std::isfinite(u) || !std::isfinite(v)) return refuse(NurbsInputError::NonFiniteParameter);

    std::size_t spanU = 0, spanV = 0;
    {
        const NurbsInputError e = locateCheckedSpan(nU - 1, degreeU, u, knotsU, spanU);
        if (e != NurbsInputError::None) return refuse(e);
    }
    {
        const NurbsInputError e = locateCheckedSpan(nV - 1, degreeV, v, knotsV, spanV);
        if (e != NurbsInputError::None) return refuse(e);
    }
    // The (degreeU+1) rows this evaluation reads must have the net's width (a
    // ragged row could be shorter than spanV), and the (degreeU+1)*(degreeV+1)
    // weights and control points it combines must be finite / positive.
    for (std::size_t a = 0; a <= degreeU; ++a) {
        const std::size_t iu = spanU - degreeU + a;
        if (control[iu].size() != nV) return refuse(NurbsInputError::RaggedControlNet);
        if (weights[iu].size() != nV) return refuse(NurbsInputError::WeightShapeMismatch);
        for (std::size_t b = 0; b <= degreeV; ++b) {
            const std::size_t iv = spanV - degreeV + b;
            const NurbsInputError e = checkWeight(weights[iu][iv]);
            if (e != NurbsInputError::None) return refuse(e);
            if (!finite3(control[iu][iv])) return refuse(NurbsInputError::NonFiniteControlPoint);
        }
    }

    const std::vector<double> Nu = basisFunctions(spanU, u, degreeU, knotsU);
    const std::vector<double> Nv = basisFunctions(spanV, v, degreeV, knotsV);
    Homog acc;
    for (std::size_t a = 0; a <= degreeU; ++a) {
        const std::size_t iu = spanU - degreeU + a;
        for (std::size_t b = 0; b <= degreeV; ++b) {
            const std::size_t iv = spanV - degreeV + b;
            acc.add(control[iu][iv], weights[iu][iv], Nu[a] * Nv[b]);
        }
    }
    PointEval r;
    const NurbsInputError e = acc.project(r.value);
    if (e != NurbsInputError::None) return refuse(e);
    r.ok = true;
    return r;
}

Vec3 NurbsSurface::evaluate(double u, double v) const {
    const PointEval r = evaluateChecked(u, v);
    return r.ok ? r.value : refusedPoint();
}

// ---------------------------------------------------------------------------
// Bezier direct evaluators (de Casteljau on homogeneous coordinates).
// ---------------------------------------------------------------------------
PointEval bezierCurvePointChecked(const std::vector<Vec3>& controlPoints,
                                  const std::vector<double>& weights,
                                  double t) {
    if (controlPoints.empty()) return refuse(NurbsInputError::EmptyControlNet);
    if (weights.size() != controlPoints.size()) return refuse(NurbsInputError::WeightShapeMismatch);
    if (!std::isfinite(t)) return refuse(NurbsInputError::NonFiniteParameter);
    for (double w : weights) {
        const NurbsInputError e = checkWeight(w);
        if (e != NurbsInputError::None) return refuse(e);
    }
    for (const Vec3& p : controlPoints)
        if (!finite3(p)) return refuse(NurbsInputError::NonFiniteControlPoint);
    const std::size_t m = controlPoints.size();

    // Lift to homogeneous (x*w, y*w, z*w, w), de Casteljau, then project.
    std::vector<double> X(m), Y(m), Z(m), W(m);
    for (std::size_t i = 0; i < m; ++i) {
        W[i] = weights[i];
        X[i] = controlPoints[i].x * weights[i];
        Y[i] = controlPoints[i].y * weights[i];
        Z[i] = controlPoints[i].z * weights[i];
    }
    for (std::size_t r = 1; r < m; ++r) {
        for (std::size_t i = 0; i < m - r; ++i) {
            X[i] = (1.0 - t) * X[i] + t * X[i + 1];
            Y[i] = (1.0 - t) * Y[i] + t * Y[i + 1];
            Z[i] = (1.0 - t) * Z[i] + t * Z[i + 1];
            W[i] = (1.0 - t) * W[i] + t * W[i + 1];
        }
    }
    // Positive weights keep W[0] > 0 for t in [0,1]; outside it (or on
    // overflow) the denominator is checked, not assumed — refused iff it is 0
    // (the old assert) or not finite, exactly as in Homog::project.
    if (!std::isfinite(W[0]) || W[0] == 0.0) return refuse(NurbsInputError::DegenerateDenominator);
    PointEval r;
    r.value = Vec3{X[0] / W[0], Y[0] / W[0], Z[0] / W[0]};
    if (!finite3(r.value)) return refuse(NurbsInputError::NonFiniteResult);
    r.ok = true;
    return r;
}

Vec3 bezierCurvePoint(const std::vector<Vec3>& controlPoints,
                      const std::vector<double>& weights,
                      double t) {
    const PointEval r = bezierCurvePointChecked(controlPoints, weights, t);
    return r.ok ? r.value : refusedPoint();
}

PointEval bezierSurfacePointChecked(const std::vector<std::vector<Vec3>>& control,
                                    const std::vector<std::vector<double>>& weights,
                                    double u, double v) {
    if (control.empty()) return refuse(NurbsInputError::EmptyControlNet);
    const std::size_t nU = control.size();
    const std::size_t nV0 = control[0].size();
    if (nV0 == 0) return refuse(NurbsInputError::EmptyControlNet);
    for (std::size_t i = 0; i < nU; ++i) {
        if (control[i].empty()) return refuse(NurbsInputError::EmptyControlNet);
        if (control[i].size() != nV0) return refuse(NurbsInputError::RaggedControlNet);
    }
    if (weights.size() != nU) return refuse(NurbsInputError::WeightShapeMismatch);
    for (std::size_t i = 0; i < nU; ++i)
        if (weights[i].size() != nV0) return refuse(NurbsInputError::WeightShapeMismatch);
    if (!std::isfinite(u) || !std::isfinite(v)) return refuse(NurbsInputError::NonFiniteParameter);
    for (std::size_t i = 0; i < nU; ++i)
        for (std::size_t j = 0; j < nV0; ++j) {
            const double wij = weights[i][j];
            const NurbsInputError e = checkWeight(wij);
            if (e != NurbsInputError::None) return refuse(e);
        }
    for (std::size_t i = 0; i < nU; ++i)
        for (std::size_t j = 0; j < nV0; ++j)
            if (!finite3(control[i][j])) return refuse(NurbsInputError::NonFiniteControlPoint);

    // First de Casteljau along V for each U row, producing nU intermediate
    // points at parameter v, then de Casteljau those along U at parameter u.
    std::vector<Vec3> rowPts(nU);
    std::vector<double> rowW(nU);
    for (std::size_t i = 0; i < nU; ++i) {
        // Evaluate row i (rational Bezier in v) -> a single rational point.
        // Reuse the curve evaluator but keep its homogeneous weight so the
        // outer U pass stays rational.
        const std::size_t nV = control[i].size();
        std::vector<double> X(nV), Y(nV), Z(nV), W(nV);
        for (std::size_t j = 0; j < nV; ++j) {
            W[j] = weights[i][j];
            X[j] = control[i][j].x * weights[i][j];
            Y[j] = control[i][j].y * weights[i][j];
            Z[j] = control[i][j].z * weights[i][j];
        }
        for (std::size_t r = 1; r < nV; ++r) {
            for (std::size_t j = 0; j < nV - r; ++j) {
                X[j] = (1.0 - v) * X[j] + v * X[j + 1];
                Y[j] = (1.0 - v) * Y[j] + v * Y[j + 1];
                Z[j] = (1.0 - v) * Z[j] + v * Z[j + 1];
                W[j] = (1.0 - v) * W[j] + v * W[j + 1];
            }
        }
        // Keep this row's result in homogeneous form: store Euclidean point and
        // its homogeneous weight separately for the outer pass.
        rowW[i] = W[0];
        rowPts[i] = Vec3{X[0], Y[0], Z[0]}; // still *unprojected* (x*w etc.)
    }
    // Outer de Casteljau along U on the homogeneous row results.
    std::vector<double> X(nU), Y(nU), Z(nU), W(nU);
    for (std::size_t i = 0; i < nU; ++i) {
        X[i] = rowPts[i].x; // already x*w from the inner pass
        Y[i] = rowPts[i].y;
        Z[i] = rowPts[i].z;
        W[i] = rowW[i];
    }
    for (std::size_t r = 1; r < nU; ++r) {
        for (std::size_t i = 0; i < nU - r; ++i) {
            X[i] = (1.0 - u) * X[i] + u * X[i + 1];
            Y[i] = (1.0 - u) * Y[i] + u * Y[i + 1];
            Z[i] = (1.0 - u) * Z[i] + u * Z[i + 1];
            W[i] = (1.0 - u) * W[i] + u * W[i + 1];
        }
    }
    if (!std::isfinite(W[0]) || W[0] == 0.0) return refuse(NurbsInputError::DegenerateDenominator);
    PointEval r;
    r.value = Vec3{X[0] / W[0], Y[0] / W[0], Z[0] / W[0]};
    if (!finite3(r.value)) return refuse(NurbsInputError::NonFiniteResult);
    r.ok = true;
    return r;
}

Vec3 bezierSurfacePoint(const std::vector<std::vector<Vec3>>& control,
                        const std::vector<std::vector<double>>& weights,
                        double u, double v) {
    const PointEval r = bezierSurfacePointChecked(control, weights, u, v);
    return r.ok ? r.value : refusedPoint();
}

std::vector<double> bezierKnotVector(std::size_t degree) {
    // [0 repeated (degree+1) times, 1 repeated (degree+1) times].
    std::vector<double> k;
    k.reserve(2 * (degree + 1));
    for (std::size_t i = 0; i <= degree; ++i) k.push_back(0.0);
    for (std::size_t i = 0; i <= degree; ++i) k.push_back(1.0);
    return k;
}

} // namespace brep
} // namespace native
} // namespace forge
