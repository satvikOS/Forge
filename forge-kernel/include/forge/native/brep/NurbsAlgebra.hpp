// forge/native/brep/NurbsAlgebra.hpp
//
// K1.1 — NURBS ALGEBRA COMPLETION for the Forge native kernel. This is the
// THIRD geometry increment on the in-house NURBS substrate. It sits ON TOP of
// the existing point evaluator (Nurbs.hpp), the calculus/Boehm-single-insertion
// layer (NurbsCalculus.hpp), and the bivariate surface wrapper
// (NurbsSurface.hpp), and REUSES their Cox-de Boor basis machinery
// (findSpan / basisFunctions / basisFunctionDerivatives / curveDerivatives /
// surfaceDerivatives). It does NOT re-declare Vec3/NurbsCurve/NurbsSurface or
// re-implement the basis recurrence.
//
// It completes the standard P&T (Piegl & Tiller, "The NURBS Book") NURBS
// algebra that was previously TARGETED-but-not-built:
//
//   * KNOT INSERTION, r-fold       (CurveKnotIns, Alg. A5.1, multiplicity +r)
//   * KNOT REFINEMENT              (RefineKnotVectCurve, Alg. A5.4)
//   * KNOT REMOVAL                 (RemoveCurveKnot, Alg. A5.8)
//   * DEGREE ELEVATION (curve)     (DegreeElevateCurve, Alg. A5.9, t levels)
//   * DEGREE ELEVATION (surface)   (DegreeElevateSurface, A5.10 — direction-wise)
//   * SURFACE knot insertion       (SurfaceKnotIns, Alg. A5.3, U or V direction)
//   * 2nd-FUNDAMENTAL-FORM CURVATURE on a surface: Gaussian K, mean H, and the
//     two principal curvatures k1,k2 from the first (E,F,G) and second
//     (L,M,N) fundamental forms (The NURBS Book §3, classical differential
//     geometry — exact for the analytic rational surface via surfaceDerivatives).
//   * ISOCURVE extraction          (the v=const / u=const curve as a NurbsCurve;
//     The NURBS Book §4.5 — exact, geometry-preserving)
//   * CURVE point PROJECTION       (closest point: Newton on the foot-point,
//     The NURBS Book Alg. 6.1 — minimise |C(u)-P|, i.e. (C(u)-P).C'(u)=0)
//   * SURFACE point PROJECTION     (closest point: 2D Newton on (u,v),
//     The NURBS Book §6.1 surface case — (S-P).S_u=0 and (S-P).S_v=0)
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL implementation only — correct standard algorithms, NO stub/MVP/
// placeholder. Pure C++20 + stdlib (no new deps, no OCCT, no WASM). ADDITIVE:
// a brand-new TU + header; the existing native path is untouched.
//
// What is REAL and VALIDATED here (see test/native/brep/nurbs_algebra_test.cpp):
//   * degree-elevate and knot-insert/refine are GEOMETRY-PRESERVING — every
//     C(u) / S(u,v) at sampled parameters is identical before==after to ~1e-12
//     (the test asserts this directly). Knot removal that is exactly removable
//     (the knot was previously inserted / the curve admits the lower
//     multiplicity) also preserves the curve to ~1e-10; an inexact removal is
//     reported (removed-count < requested) rather than silently corrupting.
//   * Surface curvature matches CLOSED FORM: a sphere patch has Gaussian
//     curvature 1/R^2 and mean curvature 1/R everywhere; a cylinder patch has
//     Gaussian 0 and principal curvatures {0, 1/R}; a plane has K=H=0.
//   * Projection matches a KNOWN point: projecting a point that lies on the
//     curve/surface returns that parameter and ~0 distance; projecting an
//     off-curve point returns the analytically-correct foot (e.g. the radial
//     foot on a circle / sphere).
//
// Honest robustness level: ROBUST-IN-PRACTICE on well-conditioned rational
// splines (positive weights, non-degenerate parameterisation, clamped knots).
// Newton projection converges from the best of a coarse parameter sweep; it is
// NOT proven-globally-optimal for pathological multi-foot inputs (the seed
// sweep makes this rare but is honestly not a guarantee). Knot removal uses the
// standard distance test with a caller-supplied tolerance.
//
// CONVENTIONS: namespace forge::native::brep. Knot vectors clamped, sized
// (count + degree + 1) per direction. Weights default to 1 (polynomial).

#ifndef FORGE_NATIVE_BREP_NURBS_ALGEBRA_HPP
#define FORGE_NATIVE_BREP_NURBS_ALGEBRA_HPP

#include "forge/native/brep/Nurbs.hpp"          // Vec3, NurbsCurve, NurbsSurface
#include "forge/native/brep/NurbsCalculus.hpp"  // curveDerivatives/surfaceDerivatives

#include <cstddef>
#include <vector>

namespace forge {
namespace native {
namespace brep {

// ===========================================================================
// KNOT INSERTION (r-fold) — CurveKnotIns, Alg. A5.1, multiplicity +r.
//
// Inserts the parameter value `u` exactly `r` times into the curve's knot
// vector, returning a NEW NurbsCurve representing the IDENTICAL geometry with
// `r` additional control points. Operates on homogeneous control points so the
// rational case is exact.
//
// Precondition: knots[degree] <= u <= knots[n+1]; and (existing multiplicity of
// u) + r <= degree. Returns the original curve unchanged if r == 0.
// ===========================================================================
NurbsCurve insertKnotR(const NurbsCurve& curve, double u, std::size_t r);

// ===========================================================================
// KNOT REFINEMENT — RefineKnotVectCurve, Alg. A5.4.
//
// Inserts an ENTIRE vector `X` of new knot values (each must lie in the valid
// domain) in one pass, in O((n+r)*p) rather than r separate insertions. `X`
// need not be sorted; it is sorted internally. Returns a NEW geometry-identical
// curve with X.size() extra control points. Empty X returns the original.
// ===========================================================================
NurbsCurve refineKnotVector(const NurbsCurve& curve,
                            const std::vector<double>& X);

// ===========================================================================
// KNOT REMOVAL — RemoveCurveKnot, Alg. A5.8.
//
// Attempts to remove the knot value `u` up to `num` times. A removal is only
// performed when it is geometrically exact to within `tol` (the standard
// P&T distance test on the candidate control points). `removed` (out) is set to
// the number of times actually removed (0..num); the returned curve has that
// many fewer control points/knots and represents the SAME geometry to within
// the tolerance. If the knot is not removable, `removed`==0 and the original
// curve is returned. This is the honest inverse of insertion: it never claims a
// removal it could not make exactly.
// ===========================================================================
NurbsCurve removeKnot(const NurbsCurve& curve, double u, std::size_t num,
                      double tol, std::size_t& removed);

// ===========================================================================
// DEGREE ELEVATION (curve) — DegreeElevateCurve, Alg. A5.9.
//
// Raises the curve degree by `t` (>=1), returning a NEW NurbsCurve of degree
// p+t representing the IDENTICAL geometry. Works on homogeneous control points
// (rational-exact). t==0 returns the original.
// ===========================================================================
NurbsCurve elevateDegree(const NurbsCurve& curve, std::size_t t);

// ===========================================================================
// SURFACE knot insertion (single, U or V direction) — SurfaceKnotIns, A5.3.
//
// dirU==true inserts `u` once into knotsU (a new control-point ROW); dirU==false
// inserts into knotsV (a new COLUMN). Geometry-preserving. Implemented by
// inserting in the chosen direction on each isoline of homogeneous control
// points (the tensor-product structure makes this exact).
// ===========================================================================
NurbsSurface insertSurfaceKnot(const NurbsSurface& surf, bool dirU, double val);

// ===========================================================================
// DEGREE ELEVATION (surface, direction-wise) — DegreeElevateSurface, A5.10.
//
// Raises degreeU by `t` if dirU==true (else degreeV), geometry-preserving, by
// elevating each isoline curve in that direction and reassembling the tensor
// grid. t==0 returns the original.
// ===========================================================================
NurbsSurface elevateSurfaceDegree(const NurbsSurface& surf, bool dirU,
                                  std::size_t t);

// ===========================================================================
// ISOCURVE EXTRACTION.
//
// isoCurveU(surf, u) returns the curve V -> S(u, V) as a NurbsCurve of degree
// surf.degreeV over knotsV; isoCurveV(surf, v) returns U -> S(U, v) of degree
// degreeU over knotsU. Geometry-preserving: evaluating the returned curve at t
// equals surf.evaluate(u, t) (resp. surf.evaluate(t, v)) to ~1e-12. Rational
// (the iso control-point weights are the contracted surface weights).
// ===========================================================================
NurbsCurve isoCurveU(const NurbsSurface& surf, double u);  // fixed u, free v
NurbsCurve isoCurveV(const NurbsSurface& surf, double v);  // fixed v, free u

// ===========================================================================
// SURFACE 2nd-FUNDAMENTAL-FORM CURVATURE.
//
// Fills the Gaussian (K), mean (H) and the two principal curvatures (k1<=k2)
// at (u,v) from the first fundamental form (E,F,G = S_u.S_u, S_u.S_v, S_v.S_v)
// and the second fundamental form (L,M,N = S_uu.n, S_uv.n, S_vv.n) with
// n = (S_u x S_v)/|.|. Sign convention: n points along +(S_u x S_v), so a
// sphere of radius R evaluated with an outward-ish patch returns K=+1/R^2,
// H = +1/R (magnitude is what the test checks). ok==false on a degenerate
// tangent plane (|S_u x S_v| ~ 0), with all fields left zero.
// ===========================================================================
struct SurfaceCurvature {
    bool ok = false;
    double gaussian = 0.0;     // K = (LN - M^2)/(EG - F^2)
    double mean = 0.0;         // H = (EN - 2FM + GL)/(2(EG - F^2))
    double k1 = 0.0;           // principal curvatures, k1 <= k2
    double k2 = 0.0;           // (H -/+ sqrt(H^2 - K))
};
SurfaceCurvature surfaceCurvature(const NurbsSurface& surf, double u, double v);

// ===========================================================================
// CURVE point PROJECTION (closest point) — Newton on the foot-point.
//
// Finds the parameter u* minimising |C(u)-P|, i.e. solving the scalar root
// f(u) = (C(u)-P).C'(u) = 0 by Newton with a robust coarse-sweep seed and
// domain clamping. Returns the foot. Standard NURBS-book point-inversion
// (Alg. 6.1 spirit).
// ===========================================================================
struct CurveProjection {
    bool ok = false;
    double u = 0.0;         // foot parameter
    Vec3 point;             // C(u*) — the closest point on the curve
    double distance = 0.0;  // |C(u*) - P|
    std::size_t iterations = 0;
};
CurveProjection projectPointToCurve(const NurbsCurve& curve, const Vec3& P,
                                    double tol = 1e-12,
                                    std::size_t maxIter = 64);

// ===========================================================================
// SURFACE point PROJECTION (closest point) — 2D Newton on (u,v).
//
// Solves the 2x2 system f(u,v) = (S-P).S_u = 0, g(u,v) = (S-P).S_v = 0 by
// Newton (Hessian from 2nd derivatives), seeded by a coarse (u,v) sweep, with
// domain clamping. Returns the foot. Standard NURBS-book surface point
// inversion (§6.1).
// ===========================================================================
struct SurfaceProjection {
    bool ok = false;
    double u = 0.0, v = 0.0;  // foot parameters
    Vec3 point;               // S(u*,v*) — closest point on the surface
    double distance = 0.0;    // |S(u*,v*) - P|
    std::size_t iterations = 0;
};
SurfaceProjection projectPointToSurface(const NurbsSurface& surf, const Vec3& P,
                                        double tol = 1e-12,
                                        std::size_t maxIter = 64);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_NURBS_ALGEBRA_HPP
