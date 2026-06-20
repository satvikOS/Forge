// forge/native/mesh/TriTriIntersect.hpp
//
// EXACT triangle–triangle intersection for the in-house Forge native kernel —
// the core combinatorial primitive of the general mesh-boolean arrangement
// (Stage 2 of KERNEL_INHOUSE_ROADMAP.md, the manifold-3d / WASM replacement).
// Pure C++20, ZERO external dependencies, no OCCT, no WASM, no third-party libs.
//
// WHAT THIS INCREMENT SHIPS (REAL + VALIDATED — Bible §0/§9)
// ---------------------------------------------------------
//   Given two triangles A=(a0,a1,a2) and B=(b0,b1,b2) in R^3, classify their
//   intersection and, for the generic crossing case, return the intersection
//   SEGMENT. The combinatorial classification is driven ENTIRELY by the shared
//   re-derived exact predicate forge::native::orient3d (Predicates.hpp): every
//   "which side of a plane is this point" and "do these two coplanar segments
//   cross" decision is a sign of an orient3d / orient2d determinant, so the
//   *classification* (which of the categories below) can never be corrupted by
//   floating-point rounding. That is the property a naive double-determinant
//   sidedness test loses near coplanarity (demonstrated in the gate).
//
//   Categories (TriTriRelation):
//     DISJOINT          — the triangles do not meet at all.
//     COPLANAR_OVERLAP  — the two triangles lie in the SAME plane and their
//                         2D regions overlap in more than a single point
//                         (shared area, or an overlapping edge/segment).
//     EDGE_TOUCH        — non-coplanar, meeting in a non-degenerate segment.
//                         (A proper crossing always produces a segment; we tag
//                         it EDGE_TOUCH when that segment lies along a shared
//                         edge / face boundary rather than piercing interiors,
//                         and PROPER_CROSS when at least one endpoint is in the
//                         open interior of a face — see below.)
//     POINT_TOUCH       — the triangles meet in exactly one point (a vertex on
//                         the other triangle, or two edges crossing at a point,
//                         or a single coplanar touch point).
//     PROPER_CROSS      — non-coplanar triangles whose intersection is a
//                         non-degenerate segment with interior penetration
//                         (the case the arrangement must imprint).
//
//   For COPLANAR_OVERLAP / EDGE_TOUCH / PROPER_CROSS / POINT_TOUCH the result
//   carries the intersection geometry:
//     * segment endpoints p, q (p==q for POINT_TOUCH);
//     * a flag `degenerate` only set on malformed input (a zero-area triangle).
//
// ROBUSTNESS LEVEL (stated up front — do NOT overclaim):
//   robust-in-practice with an EXACT combinatorial core. The decision of WHICH
//   category, and the in/out sign of every endpoint, is exact (orient3d signs).
//   The numeric COORDINATES of the returned segment endpoints are computed by
//   plain-double line/plane intersection (the same plane-line solve Manifold
//   uses) — they are not arbitrary-precision rationals. So: the topology is
//   proven-exact within the orient3d domain; the coordinates are
//   robust-in-practice, NOT CGAL-exact. This is the honest Manifold-class
//   ceiling, identical to the rest of Stage 2.
//
// TARGETED (NOT in this increment — do not claim these work yet):
//   * The full A∪B / A∩B / A−B arrangement that consumes these pairwise results
//     (build the intersection graph over a whole mesh, snap-round coincident
//     hits, re-triangulate every cut face, then classify in/out per component).
//     This file is the PRIMITIVE that arrangement is built from; the arrangement
//     itself remains TARGETED.
//   * Exact rational coordinates for the segment endpoints (would lift the
//     coordinate guarantee from robust-in-practice to proven-exact).
//   * Coplanar classification distinguishing "shared sub-area" vs "shared
//     boundary only" beyond the OVERLAP / EDGE / POINT buckets returned here.
//
// No external dependencies. No WASM. Pure C++20.

#ifndef FORGE_NATIVE_MESH_TRITRIINTERSECT_HPP
#define FORGE_NATIVE_MESH_TRITRIINTERSECT_HPP

#include "forge/native/mesh/HalfEdgeMesh.hpp"  // reuse Vec3 (no re-declaration)

namespace forge {
namespace native {
namespace mesh {

// Classification of a triangle–triangle intersection.
enum class TriTriRelation {
    DISJOINT,           // no common point
    COPLANAR_OVERLAP,   // same plane, overlapping region (area or shared segment)
    EDGE_TOUCH,         // non-coplanar, intersection is a segment lying on a shared boundary
    POINT_TOUCH,        // intersection is a single point
    PROPER_CROSS        // non-coplanar, intersection segment penetrates an interior
};

// Result of triTriIntersect.
//   relation   : the category above.
//   p, q       : intersection segment endpoints. Valid for every relation
//                except DISJOINT. For POINT_TOUCH, p == q. For COPLANAR_OVERLAP
//                p,q are the endpoints of the overlap region's bounding segment
//                along the intersection of the two triangles (a representative
//                shared segment; the full 2D overlap polygon is TARGETED).
//   degenerate : true only if an input triangle had zero area (malformed). When
//                set, `relation` is best-effort and callers should treat the
//                pair as needing repair, not as a trustworthy classification.
struct TriTriResult {
    TriTriRelation relation = TriTriRelation::DISJOINT;
    Vec3 p{};
    Vec3 q{};
    bool degenerate = false;
};

// Classify and (where applicable) compute the intersection of triangles
// A=(a0,a1,a2) and B=(b0,b1,b2). Combinatorics are exact via orient3d; segment
// coordinates are double-precision (see ROBUSTNESS note above).
TriTriResult triTriIntersect(const Vec3& a0, const Vec3& a1, const Vec3& a2,
                             const Vec3& b0, const Vec3& b1, const Vec3& b2);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_TRITRIINTERSECT_HPP
