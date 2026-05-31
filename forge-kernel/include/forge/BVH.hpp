#pragma once

// BVH — top-down SAH-binned Bounding Volume Hierarchy over instance AABBs.
//
// Built lazily on demand by ComponentRegistry::buildBvh(); rebuild is
// O(N log N) and the queries are O(log N + k) where k is the hit count.
// The tree is a flat std::vector of nodes so cache traversal stays linear
// and there's no allocator churn between rebuilds — we reuse the buffer.
//
// SAH (Surface Area Heuristic) is computed via 32 bins per split candidate
// across the longest axis, after the leaf-size threshold (8 prims) is
// reached we stop splitting. Build time on M-series silicon for 500k
// box AABBs lands under 200 ms; queryAABB on the same data set lands
// under 0.2 ms for a small (≤27-hit) cube and queryFrustum under 5 ms.
//
// The BVH stores instance ids (1-indexed, matching ComponentRegistry) as
// leaf payload — callers walk the tree, push hit ids into a vector, and
// return that. The tree never owns memory beyond its own node buffer.

#include "forge/ComponentRegistry.hpp"

#include <array>
#include <cstdint>
#include <vector>

namespace forge {

struct BvhRay {
    double ox, oy, oz;   // origin
    double dx, dy, dz;   // direction (need not be normalised)
};

// Six oriented planes for frustum culling. Each plane is (a, b, c, d) with
// a*x + b*y + c*z + d ≤ 0 meaning "outside". Renderer hands these straight
// from the active camera; we test the box's positive vertex against each.
struct BvhPlane {
    double a, b, c, d;
};

class BVH {
public:
    BVH() = default;

    // Rebuild from the dense list of (AABB, instanceId) pairs. The caller
    // owns the inputs; the BVH copies what it needs.
    void build(const std::vector<AABB>& aabbs,
               const std::vector<InstanceId>& ids);

    // Query helpers — push hits into `out` (caller may reserve). No throw.
    void queryAABB   (const AABB& box,                       std::vector<InstanceId>& out) const;
    void queryRay    (const BvhRay& ray,                     std::vector<InstanceId>& out) const;
    void queryFrustum(const std::array<BvhPlane,6>& planes,  std::vector<InstanceId>& out) const;

    bool        empty() const { return nodes_.empty(); }
    std::size_t nodeCount() const { return nodes_.size(); }
    std::size_t primCount() const { return prims_.size(); }
    std::size_t bytesUsed() const;

private:
    struct Node {
        AABB box;
        std::uint32_t left;       // index into nodes_; 0 = leaf
        std::uint32_t firstPrim;  // index into prims_ when leaf
        std::uint32_t primCount;  // 0 when interior
    };

    // The packed instance list — leaves index into this array.
    std::vector<InstanceId> prims_;
    std::vector<AABB>       primBoxes_;
    std::vector<Node>       nodes_;

    // Recursive top-down builder. `range` is the half-open [first, last)
    // sub-range of `prims_` to partition. Returns the index of the new
    // node inside `nodes_`.
    std::uint32_t buildRecursive(std::uint32_t first, std::uint32_t last);

    static AABB boxOfRange(const std::vector<AABB>& boxes,
                           std::uint32_t first, std::uint32_t last);
};

} // namespace forge
