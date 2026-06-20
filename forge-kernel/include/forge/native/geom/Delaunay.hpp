// forge/native/geom/Delaunay.hpp
//
// In-house 2D Delaunay triangulation — forge::native::geom.
//
// CGAL-class increment (one slice of a multi-year program; the remainder is
// TARGETED — see "TARGETED REMAINDER" below). What ships here is REAL and
// VALIDATED against the standalone gate in test/native/geom/delaunay_test.cpp:
//
//   delaunay2D — Bowyer-Watson incremental Delaunay triangulation of a 2D point
//                set. Every decision that determines the COMBINATORIAL structure
//                of the triangulation (point-in-circumcircle, point orientation
//                / left-of-edge) is taken from the ROBUST adaptive-exact
//                predicates in forge/native/Predicates.hpp — never from a
//                floating-point tolerance. The result is a set of triangles, as
//                index triples into the input point array, each wound
//                counter-clockwise (orient2d > 0), satisfying the empty-circle
//                Delaunay property: no input point lies STRICTLY inside the
//                circumcircle of any output triangle (incircle <= 0 for every
//                triangle / point pair).
//
// ALGORITHM
// ---------
// Classic Bowyer-Watson:
//   1. Build a "super-triangle" large enough to contain every input point in
//      its interior. Its three vertices are kept as virtual indices.
//   2. Insert input points one at a time. For each point p:
//        a. Find every existing triangle whose circumcircle STRICTLY contains p
//           (incircle(tri, p) == POSITIVE). These are the "bad" triangles; their
//           union is a star-shaped cavity around p.
//        b. The boundary of that cavity (edges shared by exactly one bad
//           triangle) forms a polygon. Delete the bad triangles and re-triangulate
//           the cavity by connecting p to every boundary edge.
//   3. After all points are inserted, drop every triangle that still references a
//      super-triangle vertex. The remainder is the Delaunay triangulation of the
//      input.
//
// Insertion order is randomized (deterministic LCG seed) so the cavity stays
// expected-O(1) and the structure does not degrade to O(n) on sorted input.
//
// ROBUSTNESS POSTURE (honest, per KERNEL_INHOUSE_ROADMAP.md §0 / Bible §0):
//   "robust-in-practice with exact predicates", NOT proven-exact (rational /
//   EPECK). The cavity / bad-triangle decisions are EXACT (driven by the exact
//   incircle / orient2d signs), which is precisely what makes Bowyer-Watson
//   robust on cocircular and near-degenerate sets: with a perturbation-free
//   exact incircle, the set of bad triangles is always a single connected
//   star-shaped region, so no overlapping or flipped triangle can be produced.
//   The ONE place a double is still load-bearing is the construction of the
//   super-triangle coordinates from the input bounding box; this only has to be
//   "large enough", and is checked by the gate (the final triangulation contains
//   no super vertex and tiles the convex hull). Duplicate input points are
//   removed up front (exact equality) because a duplicate has an undefined
//   circumcircle membership; the returned index triples reference the ORIGINAL
//   input indices of the surviving unique points.
//
// COCIRCULAR / DEGENERATE HANDLING (the load-bearing case for robust incircle):
//   On a cocircular set (e.g. the 4 corners of a square, or points on a common
//   circle) a NAIVE float incircle would flip sign unpredictably and can carve a
//   non-star-shaped or disconnected cavity, yielding overlapping / inverted
//   triangles. Because incircle here returns the EXACT sign, a point exactly ON a
//   circumcircle is ZERO (not "bad"), the cavity stays exactly the connected set
//   of triangles that strictly contain p, and the output is a valid triangulation
//   (some valid diagonal choice of each cocircular polygon). The gate asserts the
//   empty-circle property and the no-overlap / no-inversion property on exactly
//   such sets.
//
// TARGETED REMAINDER (intentionally absent from this increment):
//   * Constrained / conforming Delaunay (forced edges).
//   * Delaunay refinement / quality meshing (Ruppert / Chew).
//   * Voronoi dual extraction.
//   * 3D Delaunay / regular (weighted) triangulations.
//   * A simulation-of-simulparity tie-break to make the diagonal choice on
//     cocircular sets canonical (currently any VALID diagonal is accepted).
//   These are later slices of the CGAL-class program.
//
// CONVENTIONS: pure C++20, standard library only. No OCCT, no WASM, no
// third-party libs. Reuses forge/native/geom/Geom.hpp (Point2) and the exact
// predicates in forge/native/Predicates.hpp. It does NOT re-declare Point2 nor
// re-implement any predicate.

#ifndef FORGE_NATIVE_GEOM_DELAUNAY_HPP
#define FORGE_NATIVE_GEOM_DELAUNAY_HPP

#include <vector>
#include <array>
#include <cstddef>
#include <cstdint>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"  // reuse Point2 (no duplicate type)

namespace forge {
namespace native {
namespace geom {

// Result of a 2D Delaunay triangulation.
//
//   triangles — index triples into `points` (see DelaunayResult::points). Each
//               triangle is wound COUNTER-CLOCKWISE (orient2d(a,b,c) > 0).
//   points    — the surviving UNIQUE input points, in their original input
//               order with exact duplicates removed. Triangle indices reference
//               THIS array (so a self-contained mesh travels in the result).
//   inputIndex[i] — the index in the ORIGINAL caller array that point i came
//               from (the first occurrence, for duplicates).
//   ok        — false when the input cannot be triangulated into 2D triangles:
//               fewer than 3 unique points, or all unique points collinear
//               (a degenerate "triangulation" is a single segment chain — we
//               report it rather than emit zero-area triangles).
struct DelaunayResult {
    bool ok{false};
    std::vector<Point2>            points;       // unique points, mesh-local
    std::vector<int>               inputIndex;   // points[i] -> original index
    std::vector<std::array<int,3>> triangles;    // CCW index triples into points
    const char* reason{""};                      // why ok==false, for diagnostics
};

// Compute the Delaunay triangulation of `pts`.
//
// Deterministic for a given input (the internal randomized insertion order uses
// a fixed seed), so the gate is reproducible. Passing a custom `seed` only
// changes the (still valid) diagonal choice on cocircular sets; the empty-circle
// property holds for every seed.
DelaunayResult delaunay2D(const std::vector<Point2>& pts,
                          std::uint64_t seed = 0x9E3779B97F4A7C15ull);

// ---------------------------------------------------------------------------
// Verification helpers (used by the gate; also useful to downstream callers
// that want to assert the invariant on a triangulation they were handed).
// These re-use the EXACT predicates, so they are themselves robust.
// ---------------------------------------------------------------------------

// True iff every triangle is CCW and NO point of `result.points` lies strictly
// inside any triangle's circumcircle (the empty-circumcircle Delaunay property).
bool isDelaunay(const DelaunayResult& result);

// True iff no two triangles in the result overlap on a positive area and no
// triangle is inverted (all CCW). Implemented combinatorially: a valid planar
// triangulation has every interior edge shared by exactly two triangles and
// every boundary edge by exactly one, and all triangles CCW. This is the
// "no overlapping or flipped triangles" property the robust incircle guarantees.
bool isValidTriangulation(const DelaunayResult& result);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_DELAUNAY_HPP
