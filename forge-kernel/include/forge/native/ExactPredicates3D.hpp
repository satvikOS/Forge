// forge/native/ExactPredicates3D.hpp
//
// K2 / Phase-B2+B3 — EXACT 3D predicates AND exact CONSTRUCTIONS built on the
// ExactReal lazy-exact number (ExactReal.hpp). This is the layer that makes the
// mesh-arrangement boolean's combinatorial decisions exact AND its intersection
// COORDINATES exact, which is what lifts the boolean off the documented ~0.12%
// double-coordinate ceiling (predicates-geom.md §4, booleans.md §C1.1).
//
// Two kinds of routine live here:
//
//  (1) EXACT PREDICATES (sign only). `exactOrient3D` evaluates the SAME 3x3
//      orientation determinant the fast Shewchuk `orient3d` (Predicates.hpp)
//      does, but through ExactReal — so it agrees with `orient3d` by construction
//      (both are exact) and is the reference the classifier uses on the rare
//      ExactReal-constructed points (whose coordinates are not exact doubles, so
//      the fast filter would not certify them, while ExactReal still answers
//      exactly). `exactInSphere` likewise.
//
//  (2) EXACT CONSTRUCTIONS (a point with EXACT rational coordinates).
//      `exactEdgeTriangleIntersection` returns the point where segment P0P1 meets
//      the supporting plane of triangle (Q0,Q1,Q2) as an `ExactPoint3` whose x/y/z
//      are ExactReal — so the SAME segment×plane query always yields the bit-
//      identical exact point (idempotent), and a CANONICAL-id registry keyed by
//      that exact point collapses three near-coincident double hits into ONE
//      vertex. `exactSegmentSegmentIntersection` does the analogous 2D/coplanar
//      construction. The classifier `segmentTriangleClassify` makes a sign
//      decision for every endpoint/crossing through ExactReal so it can NEVER make
//      an inconsistent sign decision (the root cause of cracks / non-manifold
//      output called out in the task).
//
// Pure C++20, ZERO external dependencies (builds only on ExactReal.hpp +
// HalfEdgeMesh.hpp's Vec3). No OCCT, no WASM.

#ifndef FORGE_NATIVE_EXACTPREDICATES3D_HPP
#define FORGE_NATIVE_EXACTPREDICATES3D_HPP

#include "forge/native/ExactReal.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"   // forge::native::mesh::Vec3

namespace forge {
namespace native {

using mesh::Vec3;

// A point with EXACT rational coordinates (the EPECK construction result).
struct ExactPoint3 {
    ExactReal x, y, z;
    ExactPoint3() {}
    ExactPoint3(const ExactReal& X, const ExactReal& Y, const ExactReal& Z) : x(X), y(Y), z(Z) {}
    explicit ExactPoint3(const Vec3& p) : x(p.x), y(p.y), z(p.z) {}
    // Faithfully-rounded double coordinate (for the emitted half-edge mesh).
    Vec3 toVec3() const { return Vec3{ x.toDouble(), y.toDouble(), z.toDouble() }; }
    // EXACT equality (all three coordinates exactly equal). This is the test the
    // canonical registry uses, so two constructions that are the SAME geometric
    // point are recognised as one, regardless of how their doubles rounded.
    bool equals(const ExactPoint3& o) const {
        return x.cmp(o.x) == 0 && y.cmp(o.y) == 0 && z.cmp(o.z) == 0;
    }
};

// ── (1) EXACT PREDICATES ─────────────────────────────────────────────────────

// Exact sign of orient3d(a,b,c,d): +1 if d below plane(a,b,c) (CCW from above),
// -1 above, 0 coplanar — IDENTICAL convention to forge::native::orient3d, but
// evaluated through ExactReal so it is exact even for ExactReal-constructed
// (non-exact-double) coordinates.
int exactOrient3D(const ExactPoint3& a, const ExactPoint3& b,
                  const ExactPoint3& c, const ExactPoint3& d);
int exactOrient3D(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d);

// Exact sign of insphere(a,b,c,d,e) — same convention as forge::native::insphere.
int exactInSphere(const ExactPoint3& a, const ExactPoint3& b, const ExactPoint3& c,
                  const ExactPoint3& d, const ExactPoint3& e);

// Exact sign of the triple product ((b-a) x (c-a)) . n — the 2D orientation of
// (a,b,c) inside the plane whose (not necessarily unit) normal is n. This is the
// hot leaf of the mesh boolean's exact retriangulation; like exactOrient3D it is
// interval-filtered (double fast path, exact ExactReal fallback), so it is exact
// but does not pay big-integer cost in the far-from-degenerate common case.
int exactPlanarOrient3D(const ExactPoint3& a, const ExactPoint3& b,
                        const ExactPoint3& c, const ExactPoint3& n);

// ── (2) EXACT CONSTRUCTIONS ──────────────────────────────────────────────────

// Intersection of the line through (P0,P1) with the supporting PLANE of triangle
// (Q0,Q1,Q2), returned with EXACT rational coordinates. `ok` is false iff the
// line is parallel to the plane (no unique point). The construction is exact and
// IDEMPOTENT: feeding the result back as P0 (or re-querying the same operands)
// reproduces the bit-identical ExactPoint3. THIS is the routine that replaces the
// double `edgePlanePoint` in the mesh boolean's cut step and removes the sliver.
ExactPoint3 exactEdgePlaneIntersection(const ExactPoint3& P0, const ExactPoint3& P1,
                                       const ExactPoint3& Q0, const ExactPoint3& Q1,
                                       const ExactPoint3& Q2, bool& ok);

// Exact intersection of two COPLANAR segments (A0A1) and (B0B1) — the construction
// behind a 2D edge×edge cut. `ok` false if parallel/degenerate. Exact + idempotent.
ExactPoint3 exactSegmentSegmentIntersection(const ExactPoint3& A0, const ExactPoint3& A1,
                                            const ExactPoint3& B0, const ExactPoint3& B1,
                                            bool& ok);

// ── (3) CONSISTENT CLASSIFIER ────────────────────────────────────────────────

// Where a single point lies w.r.t. a triangle's three edges (in the triangle's
// own plane), decided entirely by ExactReal signs so the classification is
// internally CONSISTENT and never contradicts itself across queries.
enum class PointTriPos { OUTSIDE, INSIDE, ON_EDGE, ON_VERTEX };

// Is point p (assumed in the plane of the triangle) inside / on / outside the
// triangle (Q0,Q1,Q2)? Exact, sign-consistent.
PointTriPos exactPointInTriangle(const ExactPoint3& p,
                                 const ExactPoint3& Q0, const ExactPoint3& Q1,
                                 const ExactPoint3& Q2);

// Result of classifying segment (P0,P1) against triangle (Q0,Q1,Q2).
struct SegTriResult {
    bool        intersects = false;   // the segment meets the triangle at all
    bool        coplanar   = false;   // segment lies in the triangle's plane
    bool        crosses    = false;   // it pierces the triangle interior in ONE point
    ExactPoint3 point;                // the pierce point (valid iff crosses)
};

// Classify segment (P0,P1) vs triangle (Q0,Q1,Q2) with EXACT signs throughout.
// The endpoint-side decision (orient3d of each endpoint vs the triangle plane) and
// the in-triangle decision are all ExactReal, so the same segment/triangle pair
// ALWAYS classifies the same way — the property the task requires ("never makes an
// inconsistent sign decision"). When `crosses`, `point` is the EXACT pierce point.
SegTriResult segmentTriangleClassify(const ExactPoint3& P0, const ExactPoint3& P1,
                                     const ExactPoint3& Q0, const ExactPoint3& Q1,
                                     const ExactPoint3& Q2);

} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_EXACTPREDICATES3D_HPP
