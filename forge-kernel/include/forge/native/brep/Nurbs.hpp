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
//
// What is explicitly TARGETED (NOT built here):
//   * No derivatives / tangents / normals / curvature (the gate only checks
//     point values). No knot insertion, degree elevation, refinement, fitting,
//     intersection, or trimming. No binding onto the Topology faces/edges yet.
//   * No NaN/degenerate-knot hardening beyond basic guards; malformed inputs
//     are the caller's responsibility this increment (asserts, not silent fake).
//
// Pure C++20, zero external dependencies (standard library only). No OCCT.
//
// CONVENTIONS: namespace forge::native::brep. Knot vector size must equal
// (controlPointCount + degree + 1). Weights default to 1 (polynomial B-spline).

#ifndef FORGE_NATIVE_BREP_NURBS_HPP
#define FORGE_NATIVE_BREP_NURBS_HPP

#include <cstddef>
#include <vector>

namespace forge {
namespace native {
namespace brep {

// Euclidean 3D point (re-declared standalone so Nurbs.hpp does not depend on
// Topology.hpp; the two share the same simple POD shape by intent).
struct Vec3 {
    double x = 0.0, y = 0.0, z = 0.0;
};

// ---------------------------------------------------------------------------
// Cox-de Boor basis machinery (free functions, header-light core lives in cpp).
// ---------------------------------------------------------------------------

// Find the knot span index i such that knots[i] <= u < knots[i+1], clamped to
// the valid range [degree, controlPointCount-1]. Standard NURBS-book FindSpan.
//   n            = controlPointCount - 1 (index of last control point)
//   degree (p)   = spline degree
//   knots        = full knot vector, size n + p + 2
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

    // Returns true iff sizes are internally consistent.
    bool valid() const;

    // Evaluate the curve point C(u). For a rational curve this divides the
    // homogeneous accumulation by the accumulated weight.
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

    bool valid() const;

    // Evaluate the surface point S(u,v).
    Vec3 evaluate(double u, double v) const;
};

// ---------------------------------------------------------------------------
// Bezier special cases (direct evaluators, independent of the B-spline path).
//   These exist as the "Bezier special case" required by the gate AND as an
//   independent cross-check of the general B-spline evaluator above (a clamped
//   knot vector [0,...,0,1,...,1] must reproduce these exactly).
// ---------------------------------------------------------------------------

// de Casteljau evaluation of a (rational) Bezier curve of degree
// controlPoints.size()-1 at parameter t in [0,1].
Vec3 bezierCurvePoint(const std::vector<Vec3>& controlPoints,
                      const std::vector<double>& weights,
                      double t);

// Tensor-product (rational) Bezier surface point at (u,v).
//   control[i][j], i over U (degreeU = nU-1), j over V (degreeV = nV-1).
Vec3 bezierSurfacePoint(const std::vector<std::vector<Vec3>>& control,
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
