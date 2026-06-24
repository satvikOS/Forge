// forge/native/brep/FilletAnalytic.hpp
//
// K-series ANALYTIC ROLLING-BALL EDGE FILLET (constant radius) on the Forge
// native ANALYTIC B-rep (Topology/Surface/MassProps/Sew) — the REAL blend, NOT
// the mesh-bridge rounded-edge strip that Fillet.cpp/Chamfer.cpp build on the
// triangle HalfEdgeMesh. This is the first slice of the "analytic blend family …
// constant-radius rolling-ball fillet surface on the B-rep" called MISSING in
// docs/SCOPE_2026-06-24/kernel/brep-nurbs.md §2.3 (roadmap W3.10 / Phase E2).
//
// WHAT IT DOES (the genuine analytic rolling-ball contact):
//   For a CONSTANT radius R rolling-ball fillet on ONE CONVEX, STRAIGHT edge
//   shared by TWO PLANAR faces of a closed solid, it computes the rolling-ball
//   contact analytically:
//     * The ball of radius R rolls in the convex valley tangent to BOTH planes
//       from the material (inner) side. Its CENTRE sweeps a line parallel to the
//       edge, a distance R inside each face plane — this line is the AXIS of the
//       fillet surface, which is a CYLINDER of radius R.
//     * The two TANGENT LINES (where the cylinder touches each face plane) are
//       the new trim boundaries: each adjacent planar face is RE-TRIMMED back
//       from the sharp edge to its tangent line.
//     * The cylindrical fillet PATCH is a TrimmedFace-style quarter-cylinder
//       (here carried as an analytic SurfaceKind::Cylinder face with a parameter-
//       rectangle [angle]×[along-edge] trim) spanning the quarter arc between the
//       two tangent lines, over the full edge length.
//   The two re-trimmed planar faces + the new cylindrical patch + the solid's
//   remaining faces are assembled (K1.4 sew semantics — every edge mated by two
//   opposite-sense coedges) into an updated closed 2-manifold Solid whose mass
//   the analytic MassProps integrator measures EXACTLY (planar faces exact polygon
//   moments; the cylinder face exact-to-rounding Gauss-Legendre over the quadric).
//
// HONEST SCOPE (Bible §0/§9 — REAL, no MVP/stub/fake; explicit boundary):
//   THIS INCREMENT: a single CONVEX, AXIS-ALIGNED-FREE but STRAIGHT edge shared by
//   exactly two PLANAR faces, constant radius R, with R small enough that both
//   tangent lines stay strictly inside their faces (no overflow). The two faces
//   may meet at ANY convex dihedral; the canonical gate is the 90° box edge.
//   EXPLICIT FOLLOW-UPS (NOT built here, surfaced in `reason`, never faked):
//     * concave (reflex) edges,
//     * curved adjacent faces (cylinder/cone/sphere/NURBS — the contact becomes a
//       torus/pipe surface, not a cylinder),
//     * edge CHAINS and the corner SETBACK / vertex-blend where three fillets meet,
//     * variable / law-controlled radius.
//
// Pure C++20, ZERO external dependencies (stdlib + existing forge native brep
// headers only). No OCCT, no WASM. ADDITIVE: a brand-new header + TU; Topology /
// Surface / MassProps / Sew are NOT edited. CONVENTIONS: namespace
// forge::native::brep.

#ifndef FORGE_NATIVE_BREP_FILLETANALYTIC_HPP
#define FORGE_NATIVE_BREP_FILLETANALYTIC_HPP

#include "forge/native/brep/Topology.hpp"   // Point3, Solid, TopologyBuilder, Surface
#include "forge/native/brep/Surface.hpp"    // Vec3 helpers, SurfaceKind

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// AnalyticFilletResult — the rolling-ball blend output + the analytic contact
// diagnostics a caller / A/B harness inspects.
// ---------------------------------------------------------------------------
struct AnalyticFilletResult {
    bool   ok = false;
    Solid* solid = nullptr;     // the filleted closed 2-manifold solid (owned by tb)

    // The new cylindrical fillet patch face (SurfaceKind::Cylinder, radius R).
    Face*  filletFace = nullptr;
    // The two adjacent planar faces, re-trimmed back to their tangent lines.
    Face*  trimmedFaceA = nullptr;  // the face on side 0 of the edge
    Face*  trimmedFaceB = nullptr;  // the face on side 1 of the edge

    // The rolling-ball contact, reported for verification.
    double radius = 0.0;        // R
    double edgeLength = 0.0;    // L
    double dihedralDeg = 0.0;   // interior dihedral angle of the two faces at the edge
    Vec3   axisPoint{};         // a point on the cylinder axis (at the edge's start)
    Vec3   axisDir{};           // unit cylinder-axis direction (== edge direction)
    Vec3   tangentA{};          // tangent point on face A at the axis-start cross-section
    Vec3   tangentB{};          // tangent point on face B at the axis-start cross-section

    const char* reason = "";
};

// ---------------------------------------------------------------------------
// filletBoxEdgeAnalytic — build the analytic constant-radius rolling-ball fillet
// of ONE convex straight edge of an axis-aligned box [0,L]^3, on the analytic
// B-rep. `tb` owns the resulting topology/geometry. `edgeIndex` selects which of
// the box's 12 edges to fillet (0..11, the standard cube-edge enumeration below).
// `R` is the constant fillet radius; it must be > 0 and < L (so the tangent lines
// stay inside both faces). Returns the closed filleted Solid + the contact
// diagnostics. `ok` is false (with a `reason`) for any out-of-scope input — never
// a faked/broken solid.
//
// Box-edge enumeration (matches the box vertex layout in Topology::buildBox):
//   bottom face z=0 ring  v0(0,0,0) v1(L,0,0) v2(L,L,0) v3(0,L,0)
//   top    face z=L ring  v4(0,0,L) v5(L,0,L) v6(L,L,L) v7(0,L,L)
//   edges 0..3 : bottom ring  (v0-v1, v1-v2, v2-v3, v3-v0)
//   edges 4..7 : top ring     (v4-v5, v5-v6, v6-v7, v7-v4)
//   edges 8..11: verticals    (v0-v4, v1-v5, v2-v6, v3-v7)
// The canonical gate fillets edge 4 (top-front, v4->v5, along +X at y=0,z=L),
// shared by the TOP face (z=L) and the FRONT face (y=0) — both planar, convex.
// ---------------------------------------------------------------------------
AnalyticFilletResult filletBoxEdgeAnalytic(TopologyBuilder& tb,
                                           double L, double R,
                                           int edgeIndex = 4);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_FILLETANALYTIC_HPP
