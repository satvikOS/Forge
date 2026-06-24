// forge/native/brep/ChamferAnalytic.hpp
//
// K-series ANALYTIC EDGE CHAMFER (symmetric flat bevel) on the Forge native
// ANALYTIC B-rep (Topology/Surface/MassProps/Sew) — the REAL analytic blend, the
// flat-bevel SIBLING of the rolling-ball fillet in FilletAnalytic.hpp, NOT the
// mesh-bridge vertex-split chamfer that Chamfer.cpp builds on the triangle
// HalfEdgeMesh. Same analytic B-rep family, same honest scope discipline.
//
// WHAT IT DOES (the genuine analytic flat-bevel cut):
//   For a symmetric setback `d` chamfer on ONE CONVEX, STRAIGHT edge shared by
//   TWO PLANAR faces of a closed solid, it computes the bevel analytically:
//     * Each adjacent planar face is cut back from the sharp edge by `d` measured
//       ALONG the face (perpendicular to the edge, into the material). The locus
//       of the cut on face A is the SETBACK LINE  TA(t) = edge(t) + d*(into A);
//       on face B it is  TB(t) = edge(t) + d*(into B). "Into A" is the in-plane
//       direction of face A pointing away from the edge (== -nB for the box), and
//       symmetrically "into B" == -nA.
//     * The flat chamfer face is the PLANE through the two setback lines TA and
//       TB — a planar quad (a band, length = edge length, width = the bevel chord
//       d*sqrt(2) for the 90-degree edge). Its outward normal bisects nA and nB.
//     * The two adjacent planar faces are RE-TRIMMED back from the sharp edge to
//       their setback lines, and the two perpendicular END faces are each
//       re-trimmed by clipping the right-triangle corner (the d x d corner) off.
//   The two re-trimmed adjacent faces + the new bevel PLANE + the two clipped end
//   faces + the solid's remaining faces are assembled (K1.4 sew semantics — every
//   edge mated by two opposite-sense coedges) into an updated closed 2-manifold
//   Solid whose mass the analytic MassProps integrator measures EXACTLY (every
//   face here is PLANAR, so the polygon-moment path is bit-exact to rounding).
//
//   REMOVED VOLUME: the bevel removes the right-triangle prism whose cross-section
//   is the right triangle with legs d (on A) and d (on B): area = (1/2) d^2, over
//   the edge length L. So the chamfered solid volume is  V_box - (1/2) d^2 L,
//   measured here EXACTLY by the analytic MassProps integrator. (Contrast the
//   fillet's curved (1 - pi/4) R^2 L: the chamfer's straight bevel removes MORE
//   material than the same-setback rolling-ball round.)
//
// HONEST SCOPE (Bible §0/§9 — REAL, no MVP/stub/fake; explicit boundary):
//   THIS INCREMENT: a single CONVEX, STRAIGHT edge shared by exactly two PLANAR
//   faces, SYMMETRIC setback d, with d small enough that both setback lines stay
//   strictly inside their faces (no overflow). The canonical gate is the 90-degree
//   box edge.
//   EXPLICIT FOLLOW-UPS (NOT built here, surfaced in `reason`, never faked):
//     * ASYMMETRIC chamfer (two different setbacks dA != dB, or distance+angle),
//     * concave (reflex) edges,
//     * curved adjacent faces (cylinder/cone/sphere/NURBS — the bevel becomes a
//       developable/ruled strip, not a single plane),
//     * edge CHAINS and the corner where three chamfers meet.
//
// Pure C++20, ZERO external dependencies (stdlib + existing forge native brep
// headers only). No OCCT, no WASM. ADDITIVE: a brand-new header + TU; Topology /
// Surface / MassProps / Sew are NOT edited. CONVENTIONS: namespace
// forge::native::brep.

#ifndef FORGE_NATIVE_BREP_CHAMFERANALYTIC_HPP
#define FORGE_NATIVE_BREP_CHAMFERANALYTIC_HPP

#include "forge/native/brep/Topology.hpp"   // Point3, Solid, TopologyBuilder, Surface
#include "forge/native/brep/Surface.hpp"    // Vec3 helpers, SurfaceKind

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// AnalyticChamferResult — the flat-bevel output + the analytic contact
// diagnostics a caller / A/B harness inspects (mirrors AnalyticFilletResult).
// ---------------------------------------------------------------------------
struct AnalyticChamferResult {
    bool   ok = false;
    Solid* solid = nullptr;     // the chamfered closed 2-manifold solid (owned by tb)

    // The new flat bevel face (SurfaceKind::Plane — a planar quad band).
    Face*  bevelFace = nullptr;
    // The two adjacent planar faces, re-trimmed back to their setback lines.
    Face*  trimmedFaceA = nullptr;  // the face on side 0 of the edge
    Face*  trimmedFaceB = nullptr;  // the face on side 1 of the edge

    // The analytic bevel geometry, reported for verification.
    double setback = 0.0;       // d (symmetric setback on each face)
    double edgeLength = 0.0;    // L
    double dihedralDeg = 0.0;   // interior dihedral angle of the two faces at the edge
    double chamferAngleDeg = 0.0; // bevel angle vs each face (45 for the 90-degree edge)
    Vec3   bevelNormal{};       // unit OUTWARD normal of the bevel plane (bisects nA,nB)
    Vec3   tangentA{};          // setback point on face A at the edge's start
    Vec3   tangentB{};          // setback point on face B at the edge's start

    const char* reason = "";
};

// ---------------------------------------------------------------------------
// chamferBoxEdgeAnalytic — build the analytic symmetric flat-bevel chamfer of ONE
// convex straight edge of an axis-aligned box [0,L]^3, on the analytic B-rep. `tb`
// owns the resulting topology/geometry. `edgeIndex` selects which of the box's 12
// edges to chamfer (0..11, the standard cube-edge enumeration — same as
// FilletAnalytic.hpp). `d` is the symmetric setback; it must be > 0 and < L (so
// the setback lines stay inside both faces). Returns the closed chamfered Solid +
// the contact diagnostics. `ok` is false (with a `reason`) for any out-of-scope
// input — never a faked/broken solid.
//
// Box-edge enumeration (matches FilletAnalytic.hpp / Topology::buildBox):
//   bottom face z=0 ring  v0(0,0,0) v1(L,0,0) v2(L,L,0) v3(0,L,0)
//   top    face z=L ring  v4(0,0,L) v5(L,0,L) v6(L,L,L) v7(0,L,L)
//   edges 0..3 : bottom ring  (v0-v1, v1-v2, v2-v3, v3-v0)
//   edges 4..7 : top ring     (v4-v5, v5-v6, v6-v7, v7-v4)
//   edges 8..11: verticals    (v0-v4, v1-v5, v2-v6, v3-v7)
// The canonical gate chamfers edge 4 (top-front, v4->v5, along +X at y=0,z=L),
// shared by the TOP face (z=L) and the FRONT face (y=0) — both planar, convex.
// ---------------------------------------------------------------------------
AnalyticChamferResult chamferBoxEdgeAnalytic(TopologyBuilder& tb,
                                             double L, double d,
                                             int edgeIndex = 4);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_CHAMFERANALYTIC_HPP
