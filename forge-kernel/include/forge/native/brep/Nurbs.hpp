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
//   * No NaN/degenerate-knot hardening beyond basic guards BEYOND the input
//     validation added by T-153 (below). The original text here said malformed
//     input was "the caller's responsibility (asserts, not silent fake)" — that
//     was false in the shipped build: the product compiles with -DNDEBUG, where
//     every assert() is removed and the code then divided by a zero rational
//     denominator (NaN into the B-Rep) or read past the end of a vector
//     (SIGSEGV). MEASURED, not assumed: readForeignStep() on a STEP file whose
//     RATIONAL_B_SPLINE_SURFACE weight grid is 0.0 returned ok=true with 25 of
//     25 sampled surface points NaN. The *Checked entry points below are the
//     typed refusal; the raw ones now refuse instead of performing that UB.
//
// Pure C++20, zero external dependencies (standard library only). No OCCT.
//
// CONVENTIONS: namespace forge::native::brep. Knot vector size must equal
// (controlPointCount + degree + 1). Weights default to 1 (polynomial B-spline).

#ifndef FORGE_NATIVE_BREP_NURBS_HPP
#define FORGE_NATIVE_BREP_NURBS_HPP

#include "forge/math/Vec3.hpp"

#include <cstddef>
#include <vector>

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
// PointEval — the TYPED REFUSAL for the evaluators (T-153).
//
// This is the kernel's established decline convention, not a new error channel:
// an ok flag plus a reason the caller can read and report. The same shape is
// already used by brep::SurfaceSample (NurbsSurface.hpp), occtfillet::Result +
// defer(why) (NativeFilletChamfer.hpp), ForeignReadResult (StepRead.hpp) and
// LoftResult (Loft.hpp). `reason` is static string data and is empty iff ok.
//
// `value` is meaningful ONLY when ok. On a refusal it is a quiet NaN, so a
// caller that ignores `ok` is no worse off than before this type existed — but
// it can no longer be said that the kernel had no way to tell it.
// ---------------------------------------------------------------------------
struct PointEval {
    bool        ok = false;
    const char* reason = "";
    Vec3        value{};
};

// The value a refusing evaluator hands back on the raw (unchecked) entry points.
// Quiet NaN in all three components: a defined, inspectable refusal rather than
// the out-of-bounds read / divide-by-zero those paths performed under NDEBUG.
Vec3 refusedPoint();

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

    // Evaluate the curve point C(u), REFUSING on input this evaluator cannot
    // answer for: an internally inconsistent curve (valid() == false) or a zero
    // rational denominator. This is the entry point to prefer.
    PointEval evaluateChecked(double u) const;

    // Evaluate the curve point C(u). For a rational curve this divides the
    // homogeneous accumulation by the accumulated weight.
    //
    // Raw (unchecked) form, kept so the ~220 existing call sites are untouched:
    // it delegates to evaluateChecked() and returns refusedPoint() when that
    // refuses. For every input evaluateChecked() accepts, the returned Vec3 is
    // bit-identical to what this function returned before T-153.
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

    // Evaluate the surface point S(u,v), REFUSING on an internally inconsistent
    // surface (valid() == false) or a zero rational denominator. Prefer this.
    PointEval evaluateChecked(double u, double v) const;

    // Evaluate the surface point S(u,v). Raw (unchecked) form — delegates to
    // evaluateChecked() and returns refusedPoint() on a refusal.
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

// Checked form. Refuses an empty control-point list, a weights list of a
// different length, and a zero de-Casteljau denominator. The raw form above
// performed an out-of-bounds read on the first two (MEASURED: SIGSEGV on the
// empty list, and 4.31078e-314 — uninitialised heap — on the short list).
PointEval bezierCurvePointChecked(const std::vector<Vec3>& controlPoints,
                                  const std::vector<double>& weights,
                                  double t);

// Tensor-product (rational) Bezier surface point at (u,v).
//   control[i][j], i over U (degreeU = nU-1), j over V (degreeV = nV-1).
Vec3 bezierSurfacePoint(const std::vector<std::vector<Vec3>>& control,
                        const std::vector<std::vector<double>>& weights,
                        double u, double v);

// Checked form. Refuses an empty/ragged control grid, a weights grid that does
// not match it, and a zero de-Casteljau denominator. NOTE: the raw form never
// had an assert for the weights grid at all and read past its end (MEASURED:
// SIGSEGV on a grid missing a row); the shape check is therefore part of this
// validation even though no assert stated it.
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
