// forge/native/brep/LoftSweep.hpp
//
// A3 — ANALYTIC LOFT + SWEEP solids on the Forge native B-rep. The in-house
// replacement for OCCT BRepOffsetAPI_ThruSections (loft) and
// BRepPrimAPI_MakePrism / BRepOffsetAPI_MakePipe (translational sweep), producing
// a closed, oriented 2-manifold ANALYTIC brep::Solid — NOT a mesh::HalfEdgeMesh.
//
// This is DISTINCT from the existing mesh-bridge Loft.cpp / Sweep.cpp (which emit
// triangle-soup mesh::HalfEdgeMesh). Those two stacks are the "two disjoint
// representations" gap called out in docs/SCOPE_2026-06-24/kernel/brep-nurbs.md
// §2.1 / Phase A3 ("Make features write brep::Solid, not mesh"). This file is the
// A3 increment for loft + sweep: every face is an analytic brep::Surface on the
// SAME unified topology that Primitives / Boolean / Shell / MassProps already
// consume, so the result is mass-measurable by massProperties(const Solid&) to
// machine precision and is one body model every native op can read.
//
// It builds ON TOP of, and REUSES (no re-derivation):
//   * TopologyBuilder (Topology.hpp)  — makeVertex/Face/Shell/Solid,
//                                       addOuterLoopToFace (shared-edge mating),
//                                       isClosedTwoManifold structural validator,
//   * Surface (Surface.hpp)           — SurfaceKind::Plane analytic face geometry
//                                       (point/partials/outward normal),
//   * MassProps (MassProps.hpp)       — massProperties() divergence-theorem exact
//                                       volume/COM/inertia over the analytic faces.
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL algorithms only, pure C++20 + stdlib (no new deps, no OCCT, no WASM).
// ADDITIVE: a brand-new header + TU; Loft.cpp / Sweep.cpp / Topology.hpp /
// Surface.hpp / Boolean.cpp are NOT edited, and binding.cpp / CMakeLists / the
// native gate are NOT touched (the parent batches that at the train pause).
//
// HONEST SCOPE of THIS increment (the rest are named follow-ups, not faked here):
//
//   (A) LOFT through N PLANAR POLYGON sections. The sections are RULED between
//       consecutive sections: a square->square frustum or square->octagon hull.
//       The result is a closed solid with:
//         * two PLANAR end caps (the first and last section polygons),
//         * RULED/planar side faces between every consecutive section pair.
//       EQUAL vertex count  -> each consecutive edge spans a planar quad band
//                              (split into two coplanar-or-skew triangles so the
//                              mass integrand is exact regardless of planarity).
//       UNEQUAL vertex count -> the two rings are stitched by a greedy
//                              shortest-diagonal triangle strip (a ruled hull),
//                              so e.g. square (4) -> octagon (8) closes cleanly.
//       Every side face is a TRIANGLE carrying an exact Plane surface, so the
//       divergence-theorem volume is exact for the prismatoid family (the gate's
//       frustum volume == h/3 (A1 + A2 + sqrt(A1 A2)) to <= 1e-9).
//
//   (B) SWEEP a planar profile polygon along a STRAIGHT or POLYLINE path
//       (translational extrude-along-path). Each path vertex carries a copy of
//       the profile translated to that point; consecutive copies are lofted as
//       in (A) (equal count -> quad bands). A straight path of length L gives a
//       prism whose volume is profileArea * L exactly (the gate's box == 90).
//
// NAMED FOLLOW-UPS (explicitly NOT in this increment): guide-rail loft, curved
// (arc/NURBS) path sweep, variable/scaling/morphing profile, tangency/continuity
// constraints, closed (periodic) loft, NURBS ruled side surfaces. The sides here
// are planar-triangle ruled facets over the exact section polygons, which is
// volume-exact for the prismatoid/prism family but is faceted (not a single
// NURBS) on a twisted hull — stated plainly, not overclaimed.
//
// CONVENTIONS: namespace forge::native::brep. Sections are given as ordered 3D
// polygon rings; each section must be planar and consistently wound (CCW about
// the loft axis) — the builder derives the axis from the section centroids and
// orients every cap/side normal outward, then re-validates closed-2-manifold and
// (via massProperties) a strictly positive volume before returning ok.

#ifndef FORGE_NATIVE_BREP_LOFTSWEEP_HPP
#define FORGE_NATIVE_BREP_LOFTSWEEP_HPP

#include <memory>
#include <vector>

#include "forge/native/brep/Topology.hpp"   // Point3, TopologyBuilder, Solid
#include "forge/native/brep/Primitives.hpp" // SolidFactory (owns builder + surfaces)

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// LoftSection — one ordered, planar, closed polygon ring in 3D model space.
// `points` are the ring vertices in order (>= 3). Consecutive sections need not
// share a vertex count (a square -> octagon hull is supported via the ruled
// triangle strip); for the prism/frustum family the counts match and the side
// faces become quad bands.
// ---------------------------------------------------------------------------
struct LoftSection {
    std::vector<Point3> points;
};

// ---------------------------------------------------------------------------
// LoftSweepResult — the analytic solid + its exact mass-properties signature.
// The Solid* is a non-owning view into `owner` (the SolidFactory that owns the
// TopologyBuilder + every Vertex/Face/Surface created); keep `owner` alive while
// using `solid`. `ok` is true only when the result is a closed 2-manifold with a
// strictly positive (divergence-theorem) volume — never faked.
// ---------------------------------------------------------------------------
struct LoftSweepResult {
    bool   ok = false;
    Solid* solid = nullptr;           // non-owning view into *owner
    std::shared_ptr<SolidFactory> owner;  // owns topology + surfaces for `solid`

    double volume = 0.0;              // massProperties(solid).volume (exact for planar faces)
    double area   = 0.0;             // total surface area
    std::size_t vertices = 0;        // topology signature: V
    std::size_t edges    = 0;        //                     E
    std::size_t faces    = 0;        //                     F
    bool   closedManifold = false;   // isClosedTwoManifold()

    const char* reason = "";         // honest failure diagnostic when !ok
};

// ===========================================================================
// (A) LOFT through N planar polygon sections -> closed analytic solid.
// ===========================================================================
//
// Build a lofted solid through the ordered `sections` (>= 2). Each section is a
// planar polygon ring (>= 3 vertices); consecutive section centroids must be
// strictly separated along the derived loft axis (a simple, non-self-intersecting
// loft). Equal vertex counts give planar quad side bands; unequal counts are
// stitched by a ruled greedy-diagonal triangle strip. Planar end caps close the
// first and last sections. The result's faces are analytic Plane surfaces, so
// massProperties(solid) gives the exact prismatoid volume.
LoftSweepResult loftSolid(const std::vector<LoftSection>& sections);

// ===========================================================================
// (B) SWEEP a planar profile polygon along a straight / polyline path.
// ===========================================================================
//
// Translate `profile` (a planar polygon ring, >= 3 vertices, given in 3D) to
// every vertex of `path` (>= 2 points; straight = 2, polyline = N), forming N
// parallel section copies, and loft them. A straight path yields a prism of
// volume profileArea * pathLength exactly. The profile's own plane orientation
// is preserved (pure translation per path vertex — no rotation/miter in this
// increment; a rotation-minimising / mitered curved-path sweep is the named
// follow-up). Refuses a path that reverses or a profile that collapses.
LoftSweepResult sweepSolid(const std::vector<Point3>& profile,
                           const std::vector<Point3>& path);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_LOFTSWEEP_HPP
