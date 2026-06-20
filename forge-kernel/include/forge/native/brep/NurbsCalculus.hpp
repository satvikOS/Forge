// forge/native/brep/NurbsCalculus.hpp
//
// In-house NURBS/Bezier DIFFERENTIAL CALCULUS + Boehm knot insertion for the
// Forge native kernel (Stage 6 geom/ of KERNEL_INHOUSE_ROADMAP.md). This is the
// SECOND geometry increment: it sits ON TOP of the existing point evaluator in
// forge/native/brep/Nurbs.hpp and REUSES its Cox-de Boor basis machinery
// (findSpan / basisFunctions) — it does NOT re-declare Vec3, NurbsCurve,
// NurbsSurface, or re-implement the basis recurrence.
//
// ============================ HONESTY (Bible §0/§9) ========================
// What is REAL and VALIDATED here (see nurbs_calculus_test.cpp):
//
//   * Basis-function DERIVATIVES via the standard DersBasisFuns recurrence
//     (The NURBS Book Alg. A2.3) — the (degree+1) nonzero N_i and their
//     derivatives up to a requested order, computed from the SAME knot vector
//     the existing evaluator uses. No external basis duplication: this derives
//     the derivatives directly from the Cox-de Boor recurrence definition.
//   * Rational curve derivatives (1st + 2nd) via the quotient/Leibniz rule
//     applied to the homogeneous control points (The NURBS Book Alg. A4.2,
//     RatCurveDerivs) — exact for a standard NURBS, e.g. a weighted circle arc.
//   * Rational tensor-product surface derivatives (1st + 2nd, incl. the mixed
//     S_uv) via the same construction in 2D (Alg. A4.4 / A3.6).
//   * tangent / unit normal / curvature derived from those derivatives:
//       - curve unit tangent  T = C'/|C'|
//       - curve curvature      kappa = |C' x C''| / |C'|^3
//       - surface unit normal  n = (S_u x S_v)/|S_u x S_v|
//   * Boehm KNOT INSERTION (The NURBS Book Alg. A5.1, single knot, multiplicity
//     +1) on a rational curve, operating on homogeneous control points so the
//     curve geometry is provably unchanged (every evaluation identical) while
//     the control-point count rises by exactly one.
//
// What is explicitly TARGETED (NOT built in THIS increment):
//   * Derivatives only to 2nd order (enough for tangent/normal/curvature/the
//     gate). Arbitrary-order is a trivial extension of the same recurrence but
//     not exercised here, so it is not claimed.
//   * Surface principal/Gaussian/mean curvature (needs the 2nd fundamental form
//     beyond S_uu/S_uv/S_vv assembly) — TARGETED, not built.
//   * Knot insertion is single-knot, multiplicity +1; r-fold insertion, knot
//     removal, degree elevation, and refinement are TARGETED.
//   * No NaN/degenerate hardening beyond the evaluator's existing guards; a zero
//     first derivative (cusp) makes the unit tangent / curvature undefined and
//     is the caller's responsibility (asserted, not silently faked).
//
// Honest robustness level: ROBUST-IN-PRACTICE on well-conditioned rational
// splines (positive weights, non-degenerate parameterization), matching the
// analytic truth on the gate fixtures. NOT proven-exact for adversarial /
// near-cusp inputs.
//
// Pure C++20, standard library only. No OCCT, no new dependencies, no WASM.
//
// CONVENTIONS: namespace forge::native::brep (extends Nurbs.hpp; no new types
// that shadow it).

#ifndef FORGE_NATIVE_BREP_NURBS_CALCULUS_HPP
#define FORGE_NATIVE_BREP_NURBS_CALCULUS_HPP

#include "forge/native/brep/Nurbs.hpp"   // REUSE: Vec3, NurbsCurve, NurbsSurface,
                                         //        findSpan, basisFunctions

#include <cstddef>
#include <vector>

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// Basis-function derivatives.
//
// Returns a (maxDeriv+1) x (degree+1) table `ders`, where ders[k][r] is the
// k-th derivative of the r-th nonzero basis function N_{span-degree+r, degree}
// evaluated at u. ders[0] therefore equals basisFunctions(span,u,degree,knots).
// Standard DersBasisFuns (The NURBS Book Alg. A2.3), built from the same
// Cox-de Boor recurrence the existing evaluator uses.
// ---------------------------------------------------------------------------
std::vector<std::vector<double>> basisFunctionDerivatives(
    std::size_t span, double u, std::size_t degree, std::size_t maxDeriv,
    const std::vector<double>& knots);

// ---------------------------------------------------------------------------
// Curve derivatives.
//
// Returns C(u), C'(u), C''(u), ... up to `maxDeriv` (size maxDeriv+1). Index 0
// is the point itself (== curve.evaluate(u)). Handles the rational case
// correctly via the quotient rule on the homogeneous control points.
// ---------------------------------------------------------------------------
std::vector<Vec3> curveDerivatives(const NurbsCurve& curve, double u,
                                   std::size_t maxDeriv);

// Convenience: unit tangent T(u) = C'(u)/|C'(u)|. Asserts |C'| > 0.
Vec3 curveTangent(const NurbsCurve& curve, double u);

// Convenience: signed-magnitude curvature kappa(u) = |C' x C''| / |C'|^3.
// For a planar curve this is the usual (nonnegative) curvature; a unit circle
// returns ~1. Asserts |C'| > 0.
double curveCurvature(const NurbsCurve& curve, double u);

// ---------------------------------------------------------------------------
// Surface derivatives.
//
// Returns a (maxDeriv+1) x (maxDeriv+1) table `S`, where S[k][l] is the partial
// derivative d^(k+l) S / (du^k dv^l) at (u,v). S[0][0] == surface.evaluate(u,v).
// Only entries with k+l <= maxDeriv are filled (others are origin). Rational
// case handled via the 2D quotient/Leibniz construction.
// ---------------------------------------------------------------------------
std::vector<std::vector<Vec3>> surfaceDerivatives(
    const NurbsSurface& surf, double u, double v, std::size_t maxDeriv);

// Convenience: unit surface normal n = (S_u x S_v)/|S_u x S_v|.
// Asserts the cross product is nonzero (non-degenerate tangent plane).
Vec3 surfaceNormal(const NurbsSurface& surf, double u, double v);

// ---------------------------------------------------------------------------
// Boehm knot insertion (single knot, multiplicity +1).
//
// Inserts the parameter value `u` once into `curve`'s knot vector, returning a
// NEW NurbsCurve that represents the IDENTICAL geometry (every C(t) unchanged)
// but with exactly one additional control point and the new knot present. The
// rational case is handled by inserting on homogeneous control points.
//
// Precondition: knots[degree] <= u <= knots[n+1] (inside the valid domain).
// The existing knot multiplicity of u must be < degree (else the standard
// algorithm's denominators vanish); this increment does not auto-detect that —
// see the header TARGETED notes.
// ---------------------------------------------------------------------------
NurbsCurve insertKnot(const NurbsCurve& curve, double u);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_NURBS_CALCULUS_HPP
