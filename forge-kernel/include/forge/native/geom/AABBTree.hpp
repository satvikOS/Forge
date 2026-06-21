// forge/native/geom/AABBTree.hpp
//
// In-house bounding-volume hierarchy over a triangle soup — forge::native::geom.
// Pure C++20, standard library only. NO OCCT, NO WASM, NO third-party libs.
// Builds ONLY on the existing forge native headers:
//   * forge/native/geom/Geom.hpp        (Point3)
//   * forge/native/mesh/HalfEdgeMesh.hpp (Vec3 — the triangle-soup vertex type)
//
// PURPOSE (CGAL AABB_tree / OCCT BVH class):
//   An axis-aligned bounding-volume hierarchy built over a static set of
//   triangles, supporting two acceleration queries that are the daily bread of
//   a CAD/mesh kernel:
//
//     (1) rayIntersect(origin, dir) -> the NEAREST forward hit along the ray:
//         the parametric distance t >= 0, the triangle index, and the hit point.
//         Misses are reported honestly via hit==false (we never fabricate a hit).
//
//     (2) closestPoint(q) -> the closest point on the whole triangle soup to a
//         query point q, the squared distance, and the owning triangle index.
//
//   Both are O(log n) in practice via hierarchical pruning, and are VALIDATED
//   bit-for-bit (within 1e-9) against an O(n) brute-force reference over >=30
//   random meshes and queries (see test/native/geom/aabbtree_test.cpp), with a
//   printed std::random_device seed so any failure is reproducible.
//
// SPLIT STRATEGY:
//   Each internal node splits its triangle range either by the MEDIAN of the
//   triangle-centroid coordinate along the longest box axis (default, O(n) per
//   level, no empty children), or by a binned Surface-Area-Heuristic (SAH) cost
//   that minimises expected traversal cost. The chosen strategy NEVER changes
//   the query ANSWER (it is a pure acceleration structure); both are validated
//   against the same brute force.
//
// ROBUSTNESS POSTURE (honest — Bible §0):
//   This is an ACCELERATION structure, not an exact-arithmetic construction.
//   The ray–triangle test (Moeller–Trumbore) and point–triangle distance are
//   plain IEEE-754 double. To guarantee we never miss a hit that brute force
//   finds, the BVH does NOT use a tightened tolerance to prune: a box is pruned
//   only when the ray provably cannot reach it (slab test) or the closest box
//   point is provably farther than the best found so far. The validated promise
//   is therefore "same answer as O(n) reference within 1e-9", which the gate
//   enforces on every random instance. Degenerate input (empty soup, zero-length
//   ray direction, non-finite coordinates, out-of-range / degenerate triangles)
//   is reported via ok=false / hit=false — never papered over.

#ifndef FORGE_NATIVE_GEOM_AABBTREE_HPP
#define FORGE_NATIVE_GEOM_AABBTREE_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/geom/Geom.hpp"          // Point3
#include "forge/native/mesh/HalfEdgeMesh.hpp"   // Vec3

namespace forge {
namespace native {
namespace geom {

// An axis-aligned bounding box. `valid()` is false for the canonical "empty"
// box (min > max on every axis), which absorbs nothing and is pruned trivially.
struct Aabb {
    double minx{0}, miny{0}, minz{0};
    double maxx{0}, maxy{0}, maxz{0};

    static Aabb empty();
    bool valid() const { return minx <= maxx && miny <= maxy && minz <= maxz; }
    void expand(const mesh::Vec3& p);
    void expand(const Aabb& b);
    double surfaceArea() const;          // 0 for an empty box
    int longestAxis() const;             // 0=x,1=y,2=z
};

// Result of rayIntersect. `hit==false` means the ray (restricted to t in
// [0, tMax]) does not meet any triangle — point/tri/t are then meaningless.
struct RayHit {
    bool   hit{false};
    double t{0.0};                 // parametric distance along the (un-normalised) dir
    std::size_t tri{0};            // index of the triangle that was hit
    mesh::Vec3 point{};            // origin + t*dir
};

// Result of closestPoint. `ok==false` only for an empty / unbuilt tree.
struct ClosestResult {
    bool   ok{false};
    mesh::Vec3 point{};            // the closest point ON the soup
    double dist2{0.0};             // squared distance from the query
    std::size_t tri{0};            // owning triangle index
};

// How an internal node partitions its triangle range.
enum class SplitMethod {
    Median,   // median of centroids along the longest axis (default)
    SAH       // binned surface-area-heuristic
};

// ---------------------------------------------------------------------------
// AABBTree — a static BVH over an indexed triangle soup.
//
// Lifetime: build() copies the triangle data it needs (vertex positions of
// every triangle), so the caller's arrays need not outlive the tree.
// ---------------------------------------------------------------------------
class AABBTree {
public:
    AABBTree() = default;

    // Build from a flat triangle soup.
    //   positions : flat xyz triples, length == 3*numVertices
    //   indices   : flat triangle indices, length == 3*numTriangles
    //   method    : split strategy (does not affect query answers)
    //
    // Returns false (and leaves the tree EMPTY) on dishonest-to-accept input:
    //   * positions.size() not a multiple of 3, or indices.size() not a multiple of 3
    //   * zero triangles
    //   * any index out of range
    //   * any non-finite coordinate
    //   * any triangle with a repeated vertex index OR zero area (degenerate):
    //     such a triangle has no well-defined ray hit / surface, so we refuse
    //     the whole build rather than silently dropping it.
    bool build(const std::vector<double>& positions,
               const std::vector<std::uint32_t>& indices,
               SplitMethod method = SplitMethod::Median);

    bool empty() const { return nodes_.empty(); }
    std::size_t triangleCount() const { return tris_.size(); }
    std::size_t nodeCount() const { return nodes_.size(); }

    // The root bounding box (Aabb::empty() if the tree is empty).
    Aabb bounds() const;

    // (1) Nearest forward ray hit. `dir` need not be normalised; `t` is in units
    //     of |dir|. Searches t in [0, tMax]. A zero-length `dir` or non-finite
    //     input yields hit==false. By default tMax is +inf (any forward hit).
    RayHit rayIntersect(const mesh::Vec3& origin, const mesh::Vec3& dir,
                        double tMax) const;
    RayHit rayIntersect(const mesh::Vec3& origin, const mesh::Vec3& dir) const;

    // (2) Closest point on the soup to `q`. ok==false only when empty.
    ClosestResult closestPoint(const mesh::Vec3& q) const;

    // Point3 conveniences (Geom.hpp interop).
    RayHit rayIntersect(const Point3& origin, const Point3& dir) const;
    ClosestResult closestPoint(const Point3& q) const;

private:
    // A flattened triangle: the three world-space vertices + originating index.
    struct Tri {
        mesh::Vec3 a, b, c;
        mesh::Vec3 centroid;
        std::size_t srcIndex;   // triangle index in the caller's `indices`
    };

    // A BVH node. A node is a LEAF when count>0 (it owns tris_[start..start+count));
    // otherwise it is internal and left/right index into nodes_.
    struct Node {
        Aabb box{};
        std::uint32_t start{0};
        std::uint32_t count{0};      // >0 => leaf
        std::uint32_t left{0};
        std::uint32_t right{0};
    };

    // Recursive builder over the [first,last) slice of `order_` (centroid order).
    std::uint32_t buildRange(std::uint32_t first, std::uint32_t last,
                             SplitMethod method);

    std::vector<Tri>          tris_;     // permuted into leaf-contiguous order
    std::vector<Node>         nodes_;    // node 0 is the root (if non-empty)
    std::vector<std::uint32_t> order_;   // working permutation during build
};

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_AABBTREE_HPP
