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
//   faces, with each setback small enough that both setback lines stay strictly
//   inside their faces (no overflow). The canonical gate is the 90-degree box edge.
//   Both the SYMMETRIC setback d (chamferBoxEdgeAnalytic) AND the ASYMMETRIC
//   TWO-DISTANCE setbacks dA != dB (chamferBoxEdgeAsymmetric) are built here: the
//   asymmetric bevel is still a SINGLE PLANE, but tilted (not the 45-degree
//   bisector) — it cuts face A back by dA and face B back by dB, so it meets face A
//   at atan(dB/dA) and face B at atan(dA/dB), and removes the right-triangle prism
//   with legs dA, dB (cross-section area (1/2) dA dB over length L).
//   EXPLICIT FOLLOW-UPS (NOT built here, surfaced in `reason`, never faked):
//     * the DISTANCE+ANGLE chamfer variant (setback + explicit bevel angle),
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

#include <cstdint>                             // std::uint32_t

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
    double setback = 0.0;       // d (symmetric setback) — equals setbackA in the symmetric path
    double setbackA = 0.0;      // dA: setback on face A (== d for the symmetric path)
    double setbackB = 0.0;      // dB: setback on face B (== d for the symmetric path)
    double edgeLength = 0.0;    // L
    double dihedralDeg = 0.0;   // interior dihedral angle of the two faces at the edge
    double chamferAngleDeg = 0.0; // bevel angle vs face A (45 for the symmetric 90-degree edge;
                                  // atan(dB/dA) for the asymmetric two-distance bevel)
    double chamferAngleADeg = 0.0; // bevel angle vs face A = atan(dB/dA)
    double chamferAngleBDeg = 0.0; // bevel angle vs face B = atan(dA/dB)
    Vec3   bevelNormal{};       // unit OUTWARD normal of the bevel plane (bisects nA,nB when dA==dB)
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

// ---------------------------------------------------------------------------
// chamferBoxEdgeAsymmetric — the ASYMMETRIC TWO-DISTANCE flat-bevel chamfer of ONE
// convex straight edge of an axis-aligned box [0,L]^3, on the analytic B-rep. Same
// edge enumeration and same closed-2-manifold/exact-mass discipline as the
// symmetric path, but face A is cut back by `dA` and face B by `dB` (dA may differ
// from dB). The bevel is STILL A SINGLE PLANE — tilted off the 45-degree bisector
// — through the setback line on A (at dA along -nB) and the setback line on B (at
// dB along -nA). Each setback must be > 0 and < L. The bevel meets face A at
// atan(dB/dA) and face B at atan(dA/dB); it removes the right-triangle prism with
// legs dA, dB, so the chamfered volume is V_box - (1/2) dA dB L, measured EXACTLY
// by the analytic MassProps integrator (every face is planar). Passing dA == dB
// reproduces chamferBoxEdgeAnalytic's symmetric 45-degree bevel exactly. Returns
// the closed chamfered Solid + the contact diagnostics; `ok` is false (with a
// `reason`) for any out-of-scope input — never a faked/broken solid.
// ---------------------------------------------------------------------------
AnalyticChamferResult chamferBoxEdgeAsymmetric(TopologyBuilder& tb,
                                               double L, double dA, double dB,
                                               int edgeIndex = 4);

// ---------------------------------------------------------------------------
// chamferSolidStraightConvexEdgeAnalytic — the TOPOLOGY-SOURCED flat-bevel
// chamfer: the symmetric setback-`d` flat bevel of ONE straight CONVEX edge of an
// ARBITRARY native analytic Solid, resolved by WALKING the real B-rep of `src`
// (NOT box-hardcoded like chamferBoxEdgeAnalytic). It is the flat-bevel SIBLING of
// filletSolidStraightConvexEdgeAnalytic (FilletAnalytic.hpp) and shares that path's
// topology walk, re-trim, faithful-copy and watertight-sew machinery; only the
// blend differs — a single PLANAR bevel patch + convex-pentagon end caps instead of
// the rolling-ball cylinder patch + sector-disk caps. So a prism / wedge /
// rectangular-box / boolean / STEP-imported convex straight planar-planar edge (at
// ANY genuine dihedral) that previously deferred to OCCT BRepFilletAPI_MakeChamfer
// or the mesh bridge is now chamfered OCCT-free, shrinking the TKFillet
// include-surface. `edgeId` indexes enumerateSolidStraightEdges(src) (the same
// enumeration the fillet path and part.filletEdges honor).
//
// HONEST SCOPE (each REFUSED with `reason`, never faked): straight CONVEX edge shared
// by two PLANAR faces at a genuine dihedral (faces neither coplanar nor flat/anti-
// parallel), ending against two PLANAR faces PERPENDICULAR to the edge, with the
// setback `d` staying strictly inside both adjacent faces. A curved / concave /
// coplanar / holed / oblique-end input, or a setback that overflows a face, is
// refused (not fabricated). Faces touching NEITHER endpoint are copied faithfully.
// Every emitted face is PLANAR, so the polygon-moment mass is bit-exact: the removed
// material is the right-triangle prism  (1/2) d^2 sin(delta) * L  (delta = interior
// dihedral), == (1/2) d^2 L at the 90-degree edge — the closed-form A/B ground truth.
// `ok` is true only when the sew is a watertight closed 2-manifold.
// ---------------------------------------------------------------------------
AnalyticChamferResult chamferSolidStraightConvexEdgeAnalytic(TopologyBuilder& tb,
                                                             const Solid& src,
                                                             std::uint32_t edgeId,
                                                             double d);

// ---------------------------------------------------------------------------
// CANONICAL-CUBE RECOGNITION (pure geometry, no side effects) — the eligibility
// predicates the part.chamferEdges / part.draftFaces NATIVE routing uses to decide
// whether an input NativeSolid can be built by the box-hardcoded analytic chamfer/
// draft above. (The analytic chamfer/draft REBUILD the canonical box [0,L]^3 from
// scratch, so they are correct ONLY when the input solid IS exactly that cube; any
// other solid falls back to the existing mesh-bridge / OCCT path unchanged.)
// ---------------------------------------------------------------------------

// If `src` is EXACTLY the canonical axis-aligned cube [0,L]^3 — min corner at the
// origin, equal side L>0, 8 corner vertices, 6 planar QUAD faces whose corner set
// matches boxCorners(L) — return L; otherwise return 0.0. Matches by the SET of
// corner positions (topology-order independent), so a boolean/rebuilt cube of the
// same geometry still qualifies. `tol` is an absolute position tolerance.
double canonicalBoxSide(const Solid& src, double tol = 1e-7);

// Map the straight edge with endpoints (a,b) of the canonical cube [0,L]^3 to its
// canonical edgeIndex 0..11 (the same enumeration chamferBoxEdgeAnalytic /
// FilletAnalytic use), or -1 if (a,b) is not one of the 12 canonical box edges to
// `tol`. Order-independent (a,b may be given either way round).
int canonicalBoxEdgeIndex(double L, const Point3& a, const Point3& b,
                          double tol = 1e-7);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_CHAMFERANALYTIC_HPP
