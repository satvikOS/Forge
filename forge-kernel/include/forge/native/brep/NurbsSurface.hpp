// forge/native/brep/NurbsSurface.hpp
//
// In-house bivariate NURBS / B-spline SURFACE evaluator + tessellator for the
// Forge native kernel (Stage 6 brep/ of KERNEL_INHOUSE_ROADMAP.md). This EXTENDS
// the existing curve+surface point evaluator in brep/Nurbs.hpp with:
//   * a self-validating surface wrapper (clamped/consistent knot vectors, weights,
//     degree < count) that reports ok=false HONESTLY on malformed input rather
//     than asserting or fabricating geometry,
//   * partial derivatives dS/du and dS/dv of the RATIONAL surface (quotient rule
//     on the homogeneous numerator/denominator), hence the analytic surface
//     normal n = (dS/du x dS/dv)/|.|,
//   * tessellation of a (u,v) parameter grid into a mesh::HalfEdgeMesh.
//
// ============================ HONESTY (Bible §0/§9) ========================
// What is REAL and VALIDATED here (see test/native/brep/nurbssurface_test.cpp):
//   * Rational tensor-product Cox-de Boor evaluation REUSES brep::findSpan /
//     brep::basisFunctions / brep::NurbsSurface::evaluate from Nurbs.cpp — this
//     file does NOT re-derive the basis recurrence (zero duplication).
//   * First partial derivatives via the analytic basis-function derivative
//     (the standard ders-table recurrence) combined with the quotient rule for
//     the rational (weighted) case. The validation gate cross-checks every
//     analytic partial against a central finite difference (< 1e-5) and checks
//     a flat net (constant normal), a bilinear net (exact bilinear interp), and
//     a sphere-patch net (eval points within tol of the radius).
//   * tessellate(resU,resV) samples the clamped parameter domain on a regular
//     grid and emits a triangulated HalfEdgeMesh (an OPEN patch: it has a
//     boundary, so it is intentionally not watertight).
//
// What is explicitly TARGETED (NOT built here):
//   * No higher-order derivatives, curvature tensor, isocurve extraction,
//     trimming, knot insertion/refinement (the curve increment NurbsCalculus.hpp
//     owns knot insertion), surface–surface intersection, or fitting.
//   * No adaptive / curvature-driven tessellation — the grid is uniform in the
//     parameter domain this increment.
//
// Pure C++20, ZERO external dependencies (standard library + existing forge
// native headers only). No OCCT, no WASM, no third-party libs. Reuses by
// #include only: brep/Nurbs.hpp (basis + point eval) and mesh/HalfEdgeMesh.hpp
// (tessellation target).
//
// CONVENTIONS: namespace forge::native::brep. Knot vectors must be
// non-decreasing, clamped (first/last value repeated degree+1 times), and sized
// exactly (count + degree + 1) per direction; degree must be >= 1 and strictly
// less than the control-point count in that direction. Weights default to 1.

#ifndef FORGE_NATIVE_BREP_NURBSSURFACE_HPP
#define FORGE_NATIVE_BREP_NURBSSURFACE_HPP

#include <cstddef>
#include <vector>

#include "forge/native/brep/Nurbs.hpp"            // findSpan / basisFunctions / NurbsSurface / Vec3
#include "forge/native/mesh/HalfEdgeMesh.hpp"     // mesh::HalfEdgeMesh tessellation target

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// Validation. Returns true iff `s` is a well-formed bivariate NURBS surface:
//   * non-empty rectangular control net (every row the same width),
//   * matching weights grid, all weights > 0,
//   * degreeU>=1 and degreeV>=1 and each degree strictly < the count in that
//     direction (degree >= count is rejected — there is no valid spline),
//   * each knot vector non-decreasing, sized (count+degree+1), and CLAMPED
//     (first knot repeated degreeU/V+1 times, last likewise).
// On any failure `reason` (if non-null) is set to a short diagnostic and the
// function returns false. This is the HONEST gate the SPEC demands: invalid or
// non-clamped knot vectors / degree>=count -> ok=false, never a fabricated
// evaluation.
// ---------------------------------------------------------------------------
bool validateSurface(const NurbsSurface& s, const char** reason = nullptr);

// ---------------------------------------------------------------------------
// Evaluation result carrying ok-status so callers never silently consume a
// degenerate point. `point` is S(u,v); `ok` mirrors validateSurface plus the
// in-domain check on (u,v) and a strictly-positive rational denominator.
// ---------------------------------------------------------------------------
struct SurfaceSample {
    bool ok = false;
    Vec3 point;     // S(u,v)
    Vec3 du;        // dS/du
    Vec3 dv;        // dS/dv
    Vec3 normal;    // unit (du x dv); zero vector if degenerate (ok stays true
                    // only when the cross product had non-zero length)
};

// Evaluate the surface point only (thin honest wrapper over NurbsSurface::evaluate
// guarded by validateSurface + the in-domain check). On failure ok=false and
// point is left default-constructed.
SurfaceSample evaluatePoint(const NurbsSurface& s, double u, double v);

// Evaluate point + first partials + unit normal analytically (rational quotient
// rule). On invalid input ok=false and the vectors are default-constructed. If
// the two partials are parallel (a degenerate / singular parameter point) the
// normal is the zero vector and ok is set false for THAT sample (honest).
SurfaceSample evaluateWithDerivatives(const NurbsSurface& s, double u, double v);

// ---------------------------------------------------------------------------
// Tessellation. Samples the clamped (u,v) domain on a regular (resU+1)x(resV+1)
// grid (resU,resV = number of cells per direction, each >= 1) and emits a
// triangulated mesh::HalfEdgeMesh. The result is an OPEN patch (it has a
// boundary loop and is therefore intentionally not watertight). `ok` is false
// (and the mesh empty) if the surface is invalid or resU/resV < 1.
// ---------------------------------------------------------------------------
mesh::HalfEdgeMesh tessellate(const NurbsSurface& s,
                              std::size_t resU, std::size_t resV, bool& ok);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_NURBSSURFACE_HPP
