// forge/native/brep/Nurbs.cpp
//
// Implementation of the in-house NURBS/Bezier evaluator (Nurbs.hpp).
// Pure C++20, no external dependencies. See header for honesty / scope.
//
// References (algorithms re-implemented from the standard mathematical
// definitions, not copied source): the Cox-de Boor recurrence and the
// FindSpan / BasisFuns formulation in Piegl & Tiller "The NURBS Book".

#include "forge/native/brep/Nurbs.hpp"

#include <cassert>
#include <cmath>

namespace forge {
namespace native {
namespace brep {

namespace {
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
    Vec3 project() const {
        // w is the accumulated rational denominator; for a valid NURBS with
        // positive weights and a partition-of-unity basis it is strictly > 0.
        assert(std::fabs(w) > 0.0 && "degenerate rational weight (w == 0)");
        return Vec3{x / w, y / w, z / w};
    }
};
} // namespace

// ---------------------------------------------------------------------------
// findSpan — locate the knot span containing u.
// ---------------------------------------------------------------------------
std::size_t findSpan(std::size_t n, std::size_t degree,
                     double u, const std::vector<double>& knots) {
    // Special case: u at (or past) the last knot value maps to span n.
    if (u >= knots[n + 1]) return n;
    // Special case: u at (or before) the first valid parameter maps to span p.
    if (u <= knots[degree]) return degree;

    // Binary search over [degree, n+1].
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
bool NurbsCurve::valid() const {
    if (controlPoints.empty()) return false;
    if (weights.size() != controlPoints.size()) return false;
    if (degree < 1) return false;
    if (knots.size() != controlPoints.size() + degree + 1) return false;
    return true;
}

Vec3 NurbsCurve::evaluate(double u) const {
    assert(valid() && "NurbsCurve::evaluate on invalid curve");
    const std::size_t n = controlPoints.size() - 1;
    const std::size_t span = findSpan(n, degree, u, knots);
    const std::vector<double> N = basisFunctions(span, u, degree, knots);

    Homog acc;
    for (std::size_t i = 0; i <= degree; ++i) {
        const std::size_t idx = span - degree + i;
        acc.add(controlPoints[idx], weights[idx], N[i]);
    }
    return acc.project();
}

// ---------------------------------------------------------------------------
// NurbsSurface
// ---------------------------------------------------------------------------
bool NurbsSurface::valid() const {
    if (control.empty()) return false;
    const std::size_t nU = control.size();
    const std::size_t nV = control[0].size();
    if (nV == 0) return false;
    if (weights.size() != nU) return false;
    for (std::size_t i = 0; i < nU; ++i) {
        if (control[i].size() != nV) return false;
        if (weights[i].size() != nV) return false;
    }
    if (degreeU < 1 || degreeV < 1) return false;
    if (knotsU.size() != nU + degreeU + 1) return false;
    if (knotsV.size() != nV + degreeV + 1) return false;
    return true;
}

Vec3 NurbsSurface::evaluate(double u, double v) const {
    assert(valid() && "NurbsSurface::evaluate on invalid surface");
    const std::size_t nU = control.size();
    const std::size_t nV = control[0].size();
    const std::size_t spanU = findSpan(nU - 1, degreeU, u, knotsU);
    const std::size_t spanV = findSpan(nV - 1, degreeV, v, knotsV);
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
    return acc.project();
}

// ---------------------------------------------------------------------------
// Bezier direct evaluators (de Casteljau on homogeneous coordinates).
// ---------------------------------------------------------------------------
Vec3 bezierCurvePoint(const std::vector<Vec3>& controlPoints,
                      const std::vector<double>& weights,
                      double t) {
    assert(!controlPoints.empty());
    assert(weights.size() == controlPoints.size());
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
    assert(std::fabs(W[0]) > 0.0 && "degenerate Bezier weight");
    return Vec3{X[0] / W[0], Y[0] / W[0], Z[0] / W[0]};
}

Vec3 bezierSurfacePoint(const std::vector<std::vector<Vec3>>& control,
                        const std::vector<std::vector<double>>& weights,
                        double u, double v) {
    assert(!control.empty());
    const std::size_t nU = control.size();
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
    assert(std::fabs(W[0]) > 0.0 && "degenerate Bezier surface weight");
    return Vec3{X[0] / W[0], Y[0] / W[0], Z[0] / W[0]};
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
