// forge/native/brep/NurbsSurfaceIntersect.hpp
//
// K1.3 — NURBS-AWARE SURFACE–SURFACE INTERSECTION (SSI) for the Forge native
// kernel. This is the general, in-house IntPatch/GeomInt_IntSS analog that
// REMOVES the deferral the elementary analytic SSI (SurfaceIntersect.cpp) has
// for any high-degree pair or anything involving a NURBS face
// (docs/SCOPE_2026-06-24/kernel/brep-nurbs.md §1.4: "anything involving a NURBS
// face" was reported ok=false -> mesh fallback). It intersects two surfaces
// where AT LEAST ONE is a NURBS (the other a NURBS, or an analytic primitive
// promoted to a rational NURBS), tracing EVERY branch of the intersection set as
// an ordered 3D polyline plus the two parameter-space traces (the pcurves).
//
// ============================ HONESTY (Bible §0/§9) ========================
// This is the genuine three-stage P&T / Patrikalakis-Maekawa marching SSI:
//
//   1. LOCALIZE. Recursive surface subdivision into Bezier-like (knot-interval)
//      sub-patches with a CONTROL-POINT AABB convex-hull bound; a pair of
//      sub-patches whose boxes do not overlap CANNOT contain an intersection
//      (the convex-hull property of B-splines), so it is pruned. The surviving
//      overlapping leaf-pairs bracket every branch within the parameter domains
//      — no branch is missed (the brackets are a strict superset of the curve).
//
//   2. SEED + MARCH. From each bracket a SEED is found by a 4-variable Newton on
//      F(u1,v1,u2,v2)=S1(u1,v1)-S2(u2,v2)=0 (3 equations, 4 unknowns; the
//      minimum-norm move resolves the 1-D null space). The branch is then MARCHED
//      with a predictor (the curve tangent is n1 x n2, the cross of the two
//      surface normals) + a Newton corrector back onto both surfaces, with an
//      adaptive step bounded by a chord/turn tolerance, until the branch CLOSES
//      (returns to the seed = a loop) or EXITS the parameter domain of either
//      surface. Each branch yields an ORDERED 3D polyline AND the two (u,v)
//      parameter traces (the pcurves) for surface 1 and surface 2.
//
//   3. RETURN. Each branch is returned as a fitted 3D curve when the in-house
//      curve fitter (surfit / a least-squares B-spline interpolation) reproduces
//      the polyline within tol, ELSE the dense polyline itself, ALWAYS with both
//      pcurve polylines, a branch count, and a tangential/degenerate flag. A
//      tangential contact (the two normals parallel along the contact, so the
//      tangent n1 x n2 vanishes) is DETECTED and REPORTED honestly — never
//      silently skipped.
//
// The marched vertices each satisfy |S1-S2| <= tol (reported in maxResidual), so
// the caller can trust the geometry to that residual; `degenerate` is set when a
// tangential/singular branch was encountered so the boolean can fall back rather
// than imprint a numerically unstable seam.
//
// Pure C++20, ZERO external deps (stdlib + existing forge native brep headers).
// No OCCT, no WASM. ADDITIVE: a brand-new header + TU; the analytic SSI core
// (SurfaceIntersect.cpp) and its closed-form quadric fast-paths are UNTOUCHED and
// remain the default for the quadric pairs. CONVENTIONS: forge::native::brep.

#ifndef FORGE_NATIVE_BREP_NURBSSURFACEINTERSECT_HPP
#define FORGE_NATIVE_BREP_NURBSSURFACEINTERSECT_HPP

#include <vector>

#include "forge/native/brep/Curve.hpp"          // Curve (fitted 3D result), UVCoord
#include "forge/native/brep/Nurbs.hpp"           // Vec3, NurbsSurface
#include "forge/native/brep/Surface.hpp"         // Surface (analytic operands, promotable)

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// One traced intersection branch between two surfaces.
//
//   * `points` is the ordered 3D polyline of the branch (every vertex on both
//     surfaces to `maxResidual`).
//   * `pcurve1` / `pcurve2` are the matching (u,v) parameter traces on surface 1
//     and surface 2 respectively (same length as `points`) — the pcurves a
//     trimmed-face boolean needs to imprint the seam in each surface's domain.
//   * `closed` is true when the branch is a closed loop (returned to its seed).
//   * `fitted` carries a fitted analytic/B-spline 3D curve when the fit met
//     `fitTol`; `hasFit` says whether it is populated. When false, `points` is
//     the authoritative geometry.
//   * `degenerate` is true when the branch is tangential / singular somewhere
//     (the tangent n1 x n2 vanished); the polyline is still reported but the
//     caller should treat it as a tangency contact, not a transversal seam.
//   * `maxResidual` is the worst |S1-S2| over the branch vertices.
// ---------------------------------------------------------------------------
struct SSIBranch {
    std::vector<Vec3>    points;     // ordered 3D polyline
    std::vector<UVCoord> pcurve1;    // (u,v) trace on surface 1
    std::vector<UVCoord> pcurve2;    // (u,v) trace on surface 2
    bool   closed = false;
    bool   degenerate = false;
    bool   hasFit = false;
    Curve  fitted{};                 // valid iff hasFit
    double maxResidual = 0.0;
};

// ---------------------------------------------------------------------------
// Result of a general NURBS-aware SSI query.
//
//   * `ok` is true when the query ran (the surfaces were valid and the
//     localization/marching completed); the branch set may still be empty when
//     the surfaces genuinely do not meet.
//   * `branches` are the traced branches (one per connected component of the
//     intersection set).
//   * `branchCount` == branches.size() (kept explicit for the A/B oracle, which
//     compares the branch count against OCCT GeomInt_IntSS first).
//   * `anyDegenerate` is the OR over the branches' `degenerate` flags.
//   * `maxResidual` is the worst residual over all branches.
// ---------------------------------------------------------------------------
struct NurbsSSIResult {
    bool   ok = false;
    const char* reason = "not run";
    std::vector<SSIBranch> branches;
    std::size_t branchCount = 0;
    bool   anyDegenerate = false;
    double maxResidual = 0.0;
};

// Tuning for the general marcher.
struct NurbsSSIOptions {
    double tol      = 1e-9;   // Newton residual & coincidence tolerance (|S1-S2|)
    double chordTol = 1e-3;   // max chord deviation (relative to model scale) per step
    int    subdiv   = 24;     // localization grid: subdivisions per parameter direction
    double fitTol   = 1e-7;   // accept a fitted 3D curve only if it matches to this
    bool   doFit    = true;   // attempt the B-spline fit (else always return polylines)
    int    maxBranches = 64;  // safety cap on the number of branches traced
};

// ---------------------------------------------------------------------------
// General NURBS-aware SSI. Both operands are NurbsSurface (an analytic primitive
// is promoted to a rational NURBS by `promoteToNurbs` below before calling, or
// pass the NURBS directly). Returns every branch (3D polyline + the two pcurve
// traces), the branch count, and an honest tangential/degenerate flag.
// ---------------------------------------------------------------------------
NurbsSSIResult intersectNurbsSurfaces(const NurbsSurface& s1,
                                      const NurbsSurface& s2,
                                      const NurbsSSIOptions& opts = {});

// ---------------------------------------------------------------------------
// Promote an analytic brep::Surface to an EXACT rational NURBS over a finite
// parameter window, so the general marcher can intersect an analytic primitive
// against a NURBS face (or two analytics) through the same code path.
//
//   * Plane    -> a degree (1,1) bilinear patch over the rectangle
//                 [u0,u1] x [v0,v1] in the plane's own (refDir, binormal) frame.
//   * Cylinder -> a degree (2,1) patch: an EXACT rational full circle (3 spans /
//                 weighted control polygon) swept along the axis over [z0,z1].
//   * Sphere   -> a degree (2,2) patch: the rational surface of revolution of a
//                 weighted half-circle profile (EXACT |S|==R).
//   * Cone     -> a degree (2,1) patch: the exact rational circle scaled along
//                 the axis between the base and top radii.
//   * Nurbs    -> returned as-is.
//
// `ok` is false (and the surface left default) only for an unsupported kind
// (Torus is not promoted in this increment — honestly reported, not faked).
// The (uExt, vExt) extents bound the finite window for the unbounded primitives
// (the cylinder/cone axial span and, for the plane, the half-width of the patch).
// ---------------------------------------------------------------------------
struct PromotedSurface {
    bool ok = false;
    const char* reason = "";
    NurbsSurface surface;
};
PromotedSurface promoteToNurbs(const Surface& s, double uExt = 1.0,
                               double vExt = 1.0);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_NURBSSURFACEINTERSECT_HPP
