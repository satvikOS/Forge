// forge/native/geom/KdTree3D.hpp
//
// In-house 3D kd-tree for spatial neighbor search — forge::native::geom.
// Pure C++20, standard library only. NO OCCT, NO WASM, NO third-party libs.
//
// SCOPE OF THIS INCREMENT (honest — Bible §0/§9):
//   A CGAL Spatial_searching-class static kd-tree over a set of 3D points,
//   supporting the two canonical proximity queries:
//
//     (1) build(points)        — construct a balanced axis-aligned binary
//                                 space-partition tree over the points by
//                                 recursively splitting at the MEDIAN along the
//                                 axis of largest spread. O(n log n) build.
//
//     (2) kNearest(q, k)       — the k points nearest to q in non-decreasing
//                                 Euclidean distance (ties broken by ascending
//                                 stored index, deterministically). Branch-and-
//                                 bound traversal pruned by the squared distance
//                                 to each splitting plane; visits far fewer than
//                                 n nodes in the average case but is guaranteed
//                                 to return the EXACT k-nearest set (it is a
//                                 complete search with a sound pruning bound, not
//                                 an approximate/ANN search).
//
//     (3) radiusSearch(q, r)   — every point within Euclidean distance r of q
//                                 (inclusive boundary, |p-q| <= r), returned in
//                                 the SAME order kNearest would yield: ascending
//                                 distance, then ascending index.
//
// CORRECTNESS POSTURE (read honestly):
//   Distances are compared as SQUARED Euclidean distances in IEEE-754 binary64,
//   the identical scalar a brute-force scan computes, so the kd-tree's neighbor
//   SET and its order-by-distance match a brute-force oracle EXACTLY (bit-for-bit
//   on the comparison keys, hence the validation tolerance of 1e-9 is never
//   actually exercised — agreement is exact). The tree only changes WHICH nodes
//   are visited, never how a candidate is ranked, so pruning cannot alter the
//   answer. This is "exact-result acceleration", NOT an approximate kNN.
//
//   Tie handling is total and deterministic: among points at equal distance the
//   one with the smaller original index sorts first, so the result order is fully
//   determined and reproducible (no dependence on tree shape or traversal order).
//
// HONEST EDGE CASES (return ok=false / empty rather than fabricate):
//   * empty point set                 -> ok=true on build (an empty tree);
//                                        all queries return empty, ok=true.
//   * non-finite coordinate (NaN/Inf) -> build ok=false; the tree is left empty
//                                        and every query returns ok=false. We do
//                                        NOT silently drop or sanitize bad input.
//   * k <= 0                           -> kNearest returns ok=true, empty result.
//   * k > n                            -> kNearest returns ALL n points (ok=true);
//                                        we never pad with fabricated neighbors.
//   * querying an unbuilt/failed tree  -> ok=false, empty result.
//   * r < 0                            -> radiusSearch returns ok=true, empty
//                                        (an empty ball is honestly empty); r==0
//                                        returns only points exactly coincident
//                                        with q.
//   Duplicate / coincident input points are fully supported (each is a distinct
//   entry with its own index; all are returned when within range).
//
// This header reuses forge::native::geom::Point3 from Geom.hpp (header-only POD)
// and does NOT re-implement a point type. It depends on no predicate symbols at
// link time (kNN ranking is scalar, not a determinant sign), so it links with
// only its own translation unit; Geom.cpp's predicate dependency is unrelated.

#ifndef FORGE_NATIVE_GEOM_KDTREE3D_HPP
#define FORGE_NATIVE_GEOM_KDTREE3D_HPP

#include <vector>
#include <cstddef>
#include <cstdint>

#include "forge/native/geom/Geom.hpp"  // forge::native::geom::Point3

namespace forge {
namespace native {
namespace geom {

// A single neighbor result: the index into the ORIGINAL points array passed to
// build(), and the (true, non-squared) Euclidean distance from the query point.
struct Neighbor {
    std::size_t index{0};     // index into the build() points vector
    double      distance{0};  // Euclidean distance |p - q|
};

// Result envelope for a query. `ok` is false ONLY for a genuinely unanswerable
// query (unbuilt/failed tree). A well-formed query that happens to have no
// neighbors (e.g. empty tree, k<=0, empty ball) returns ok=true with empty
// `neighbors` — that is an honest answer, not a failure.
struct KnnResult {
    bool                  ok{false};
    std::vector<Neighbor> neighbors;
};

class KdTree3D {
public:
    KdTree3D() = default;

    // Build the tree over `points`. The points are COPIED (the tree owns its
    // data and is independent of the caller's buffer afterwards). Returns true on
    // success. Returns false WITHOUT building if any coordinate is non-finite
    // (NaN/Inf) — the tree is then empty and `built()` is false. An empty input
    // is a successful build of an empty tree (returns true).
    bool build(const std::vector<Point3>& points);

    // True once a build has succeeded (including the empty-tree case).
    bool built() const { return built_; }

    // Number of points stored (0 if not built or empty).
    std::size_t size() const { return points_.size(); }

    // k nearest neighbors of `q`, ascending distance then ascending index.
    //   k <= 0  -> ok=true, empty.
    //   k >= n  -> ok=true, all n points (no fabricated padding).
    //   unbuilt -> ok=false, empty.
    // Distance ties are broken by ascending original index (total, deterministic).
    KnnResult kNearest(const Point3& q, int k) const;

    // All points within Euclidean distance `r` of `q` (inclusive, |p-q| <= r),
    // ordered exactly as kNearest would order them (ascending distance, then
    // ascending index).
    //   r < 0   -> ok=true, empty (an empty ball).
    //   unbuilt -> ok=false, empty.
    KnnResult radiusSearch(const Point3& q, double r) const;

private:
    // Flat node array; a leaf has no children (kNoChild). Each node owns the
    // single point at `point` (an index into points_) used as its splitter.
    static constexpr std::uint32_t kNoChild = 0xFFFFFFFFu;
    struct Node {
        std::uint32_t point{0};            // index into points_ (the splitter)
        std::uint8_t  axis{0};             // 0=x,1=y,2=z split axis
        std::uint32_t left{kNoChild};
        std::uint32_t right{kNoChild};
    };

    std::vector<Point3>   points_;  // owned copy of the input points
    std::vector<Node>     nodes_;
    std::uint32_t         root_{kNoChild};
    bool                  built_{false};

    // Recursively build over points_ indices [lo,hi) of `order`; returns the node
    // index (or kNoChild for an empty range).
    std::uint32_t buildRange(std::vector<std::uint32_t>& order,
                             std::size_t lo, std::size_t hi);
};

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_KDTREE3D_HPP
