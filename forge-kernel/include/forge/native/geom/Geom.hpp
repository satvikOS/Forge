// forge/native/geom/Geom.hpp
//
// In-house robust computational geometry — forge::native::geom.
//
// FIRST INCREMENT of a multi-year, CGAL-class class. What ships here is REAL
// and VALIDATED against the standalone gate in test/native/geom/geom_test.cpp:
//
//   (1) convexHull2D  — Andrew's monotone-chain convex hull in 2D, using the
//                       ROBUST orient2d predicate (forge::native). Returns the
//                       hull vertices in counter-clockwise order with NO
//                       collinear boundary vertices and NO duplicates. Interior
//                       points and collinear boundary points are dropped
//                       exactly (decided by the exact sign, never a tolerance).
//
//   (2) convexHull3D  — incremental convex hull for small point sets, using the
//                       ROBUST orient3d predicate. Returns outward-oriented
//                       triangular faces (CCW seen from outside). Coplanar /
//                       collinear / degenerate inputs are reported via a status
//                       flag rather than producing a garbage hull.
//
//   (3) segmentIntersect — robust segment–segment intersection in 2D, classified
//                       purely from orientation signs (orient2d) plus exact
//                       on-segment tests. Distinguishes proper crossing,
//                       collinear overlap, endpoint touching, and disjoint.
//                       The intersection POINT, when unique, is computed in
//                       double (the CLASSIFICATION is exact; the returned
//                       coordinate is a best-effort double — see note below).
//
// ROBUSTNESS POSTURE (honest, per KERNEL_INHOUSE_ROADMAP.md §0 / Bible §0):
//   The COMBINATORIAL decisions (which points are on the hull; how two segments
//   relate) are driven by the adaptive-exact predicates in
//   forge/native/Predicates.hpp, so they are correct on the validated fixtures
//   including the near-collinear case that breaks a naive float hull. This is
//   "robust-in-practice with exact predicates", NOT a proven-exact (rational /
//   EPECK) construction kernel. The returned intersection COORDINATE is an
//   ordinary double computed from the exact-classified configuration; it is not
//   claimed bit-exact. Anything beyond the three operations above is TARGETED
//   and intentionally absent from this increment.
//
// CONVENTIONS: pure C++20, standard library only. No OCCT, no WASM, no
// third-party libs. Builds on forge/native/Predicates.hpp (the parallel exact
// predicate build). If that header were ever absent, this file would fail to
// compile loudly rather than silently duplicating predicates — by design we do
// NOT re-implement orient2d/orient3d here.

#ifndef FORGE_NATIVE_GEOM_GEOM_HPP
#define FORGE_NATIVE_GEOM_GEOM_HPP

#include <vector>
#include <array>
#include <cstddef>

#include "forge/native/Predicates.hpp"

namespace forge {
namespace native {
namespace geom {

// ---------------------------------------------------------------------------
// Basic point types (header-only, trivial).
// ---------------------------------------------------------------------------
struct Point2 {
    double x{0.0};
    double y{0.0};
};

struct Point3 {
    double x{0.0};
    double y{0.0};
    double z{0.0};
};

// ---------------------------------------------------------------------------
// (1) 2D convex hull — Andrew's monotone chain.
//
// Returns the hull vertices in COUNTER-CLOCKWISE order, starting from the
// lexicographically smallest point. No three consecutive returned vertices are
// collinear (collinear boundary points are excluded), and no point is repeated
// (the first vertex is NOT duplicated at the end).
//
// Degenerate inputs:
//   * 0 points  -> empty
//   * 1 unique  -> single point
//   * all collinear (>=2 unique) -> the two extreme endpoints of the segment
// ---------------------------------------------------------------------------
std::vector<Point2> convexHull2D(const std::vector<Point2>& pts);

// ---------------------------------------------------------------------------
// (3) 2D segment–segment intersection classification.
//
// Classification is decided EXACTLY from orientation signs. The result's
// `point` is meaningful only for PROPER_CROSS and ENDPOINT_TOUCH (where the
// intersection is a single point); for COLLINEAR_OVERLAP the overlap is a
// sub-segment (`point` is set to one shared endpoint as a representative but
// `overlapA`/`overlapB` give the overlap span); for DISJOINT it is unused.
// ---------------------------------------------------------------------------
enum class SegRelation {
    DISJOINT,          // no common point
    PROPER_CROSS,      // segments cross at a single interior point of BOTH
    ENDPOINT_TOUCH,    // meet at exactly one point, which is an endpoint of >=1
    COLLINEAR_OVERLAP  // collinear and share a sub-segment (length > 0)
};

struct SegIntersection {
    SegRelation relation{SegRelation::DISJOINT};
    // Representative intersection point (see enum doc for when it is meaningful).
    Point2 point{};
    // For COLLINEAR_OVERLAP: the endpoints of the shared sub-segment.
    Point2 overlapA{};
    Point2 overlapB{};
};

// p1->p2 is the first segment, p3->p4 the second.
SegIntersection segmentIntersect(const Point2& p1, const Point2& p2,
                                 const Point2& p3, const Point2& p4);

// ---------------------------------------------------------------------------
// (2) 3D convex hull — incremental, for SMALL point sets.
//
// On success, `faces` holds index triples into the ORIGINAL `pts` array, each
// triangle wound counter-clockwise as seen from OUTSIDE the hull (its outward
// normal points away from the hull interior). Interior points produce no faces.
//
// `ok` is false (and `faces` empty) when the input is degenerate for a 3D hull:
//   * fewer than 4 points, OR
//   * all points coplanar (orient3d == 0 for every quadruple), OR
//   * all points collinear.
// In those degenerate cases the caller should fall back to the 2D hull (a
// coplanar set has a well-defined 2D hull, not handled by this 3D routine in
// this increment — that projection step is TARGETED, see header top comment).
// ---------------------------------------------------------------------------
struct Hull3D {
    bool ok{false};
    std::vector<std::array<int, 3>> faces;  // CCW-outward index triples
    const char* reason{""};                 // why ok==false, for diagnostics
};

Hull3D convexHull3D(const std::vector<Point3>& pts);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_GEOM_HPP
