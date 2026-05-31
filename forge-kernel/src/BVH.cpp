#include "forge/BVH.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace forge {

namespace {

constexpr std::uint32_t kLeafThreshold = 8;   // max prims in a leaf
constexpr std::uint32_t kSahBins       = 32;  // bins along the chosen axis

inline double surfaceArea(const AABB& b) {
    const double dx = b.maxX - b.minX;
    const double dy = b.maxY - b.minY;
    const double dz = b.maxZ - b.minZ;
    if (dx <= 0 || dy <= 0 || dz <= 0) return 0.0;
    return 2.0 * (dx*dy + dy*dz + dz*dx);
}

inline void expand(AABB& b, const AABB& o) {
    if (o.minX < b.minX) b.minX = o.minX;
    if (o.minY < b.minY) b.minY = o.minY;
    if (o.minZ < b.minZ) b.minZ = o.minZ;
    if (o.maxX > b.maxX) b.maxX = o.maxX;
    if (o.maxY > b.maxY) b.maxY = o.maxY;
    if (o.maxZ > b.maxZ) b.maxZ = o.maxZ;
}

inline AABB emptyAabb() {
    constexpr double inf = std::numeric_limits<double>::infinity();
    return AABB{ inf, inf, inf, -inf, -inf, -inf };
}

inline double centroidAxis(const AABB& b, int axis) {
    switch (axis) {
        case 0: return 0.5 * (b.minX + b.maxX);
        case 1: return 0.5 * (b.minY + b.maxY);
        default:return 0.5 * (b.minZ + b.maxZ);
    }
}

// Slab-test ray/AABB intersection — returns true on hit.
inline bool rayAabb(const BvhRay& r, const AABB& b) {
    auto axisHit = [&](double o, double d, double mn, double mx,
                       double& tmin, double& tmax) {
        if (std::abs(d) < 1e-30) {
            // Ray parallel to slab → reject if origin outside.
            if (o < mn || o > mx) return false;
            return true;
        }
        const double inv = 1.0 / d;
        double t0 = (mn - o) * inv;
        double t1 = (mx - o) * inv;
        if (t0 > t1) std::swap(t0, t1);
        if (t0 > tmin) tmin = t0;
        if (t1 < tmax) tmax = t1;
        return tmin <= tmax;
    };
    double tmin = -std::numeric_limits<double>::infinity();
    double tmax =  std::numeric_limits<double>::infinity();
    if (!axisHit(r.ox, r.dx, b.minX, b.maxX, tmin, tmax)) return false;
    if (!axisHit(r.oy, r.dy, b.minY, b.maxY, tmin, tmax)) return false;
    if (!axisHit(r.oz, r.dz, b.minZ, b.maxZ, tmin, tmax)) return false;
    // Allow hits behind the origin (t<0) — picking usually wants those too.
    return tmax >= 0.0;
}

// Frustum vs AABB using the "positive vertex" optimisation: for each plane
// pick the box corner that's most aligned with the plane normal, if that
// corner is "outside" then the whole box is outside.
inline bool aabbInFrustum(const std::array<BvhPlane,6>& planes, const AABB& b) {
    for (const auto& p : planes) {
        const double px = (p.a >= 0.0) ? b.maxX : b.minX;
        const double py = (p.b >= 0.0) ? b.maxY : b.minY;
        const double pz = (p.c >= 0.0) ? b.maxZ : b.minZ;
        if (p.a*px + p.b*py + p.c*pz + p.d < 0.0) return false;
    }
    return true;
}

} // namespace

AABB BVH::boxOfRange(const std::vector<AABB>& boxes,
                     std::uint32_t first, std::uint32_t last) {
    AABB b = emptyAabb();
    for (std::uint32_t i = first; i < last; ++i) expand(b, boxes[i]);
    return b;
}

std::uint32_t BVH::buildRecursive(std::uint32_t first, std::uint32_t last) {
    const std::uint32_t nodeIdx = static_cast<std::uint32_t>(nodes_.size());
    nodes_.push_back(Node{});
    Node node{};
    node.box = boxOfRange(primBoxes_, first, last);
    const std::uint32_t count = last - first;

    if (count <= kLeafThreshold) {
        node.left = 0;
        node.firstPrim = first;
        node.primCount = count;
        nodes_[nodeIdx] = node;
        return nodeIdx;
    }

    // Choose the axis of greatest centroid extent.
    AABB centBox = emptyAabb();
    for (std::uint32_t i = first; i < last; ++i) {
        const double cx = centroidAxis(primBoxes_[i], 0);
        const double cy = centroidAxis(primBoxes_[i], 1);
        const double cz = centroidAxis(primBoxes_[i], 2);
        if (cx < centBox.minX) centBox.minX = cx;
        if (cy < centBox.minY) centBox.minY = cy;
        if (cz < centBox.minZ) centBox.minZ = cz;
        if (cx > centBox.maxX) centBox.maxX = cx;
        if (cy > centBox.maxY) centBox.maxY = cy;
        if (cz > centBox.maxZ) centBox.maxZ = cz;
    }
    const double extX = centBox.maxX - centBox.minX;
    const double extY = centBox.maxY - centBox.minY;
    const double extZ = centBox.maxZ - centBox.minZ;
    int axis = 0;
    double extMax = extX;
    if (extY > extMax) { axis = 1; extMax = extY; }
    if (extZ > extMax) { axis = 2; extMax = extZ; }

    // Centroids all coincide — make a leaf even above threshold; SAH would
    // produce a degenerate split and we'd recurse forever.
    if (extMax <= 0.0) {
        node.left = 0;
        node.firstPrim = first;
        node.primCount = count;
        nodes_[nodeIdx] = node;
        return nodeIdx;
    }

    // SAH-binned: drop centroids into kSahBins bins, sweep prefix/suffix
    // costs, pick the split with minimum cost = SA(L)*N(L) + SA(R)*N(R).
    struct Bin { AABB box = emptyAabb(); std::uint32_t count = 0; };
    Bin bins[kSahBins];
    const double cmin = (axis==0)?centBox.minX:(axis==1)?centBox.minY:centBox.minZ;
    const double scale = static_cast<double>(kSahBins) / extMax;
    for (std::uint32_t i = first; i < last; ++i) {
        const double c = centroidAxis(primBoxes_[i], axis);
        int bi = static_cast<int>((c - cmin) * scale);
        if (bi < 0) bi = 0;
        if (bi >= static_cast<int>(kSahBins)) bi = kSahBins - 1;
        expand(bins[bi].box, primBoxes_[i]);
        bins[bi].count++;
    }

    // Prefix from left, suffix from right.
    AABB         leftBox [kSahBins];
    std::uint32_t leftCnt[kSahBins];
    AABB         rightBox[kSahBins];
    std::uint32_t rightCnt[kSahBins];
    AABB acc = emptyAabb(); std::uint32_t accN = 0;
    for (std::uint32_t i = 0; i < kSahBins; ++i) {
        expand(acc, bins[i].box);
        accN += bins[i].count;
        leftBox[i] = acc;
        leftCnt[i] = accN;
    }
    acc = emptyAabb(); accN = 0;
    for (int i = static_cast<int>(kSahBins) - 1; i >= 0; --i) {
        expand(acc, bins[i].box);
        accN += bins[i].count;
        rightBox[i] = acc;
        rightCnt[i] = accN;
    }

    const double totalSa = surfaceArea(node.box);
    double bestCost = std::numeric_limits<double>::infinity();
    int bestSplit = -1;
    for (std::uint32_t i = 0; i + 1 < kSahBins; ++i) {
        if (leftCnt[i] == 0 || rightCnt[i+1] == 0) continue;
        const double cost =
            surfaceArea(leftBox [i  ]) * leftCnt[i] +
            surfaceArea(rightBox[i+1]) * rightCnt[i+1];
        if (cost < bestCost) { bestCost = cost; bestSplit = static_cast<int>(i); }
    }

    // Bail to leaf if SAH says no useful split (e.g. all in one bin).
    const double leafCost = totalSa * count;
    if (bestSplit < 0 || bestCost >= leafCost * 1.0) {
        // Threshold makes us prefer interior even when SAH ties, but only
        // when we already cleared the kLeafThreshold guard above; if the
        // split is degenerate we still leaf-out to avoid pathological
        // recursion when many centroids share a coordinate.
        if (bestSplit < 0) {
            node.left = 0;
            node.firstPrim = first;
            node.primCount = count;
            nodes_[nodeIdx] = node;
            return nodeIdx;
        }
    }

    // Partition prims+boxes in lockstep around the chosen bin boundary.
    const double splitC = cmin + (bestSplit + 1) * (extMax / kSahBins);
    std::uint32_t i = first, j = last;
    // Hoare-style partition: invariant — [first,i) < splitC, [j,last) >= splitC.
    while (i < j) {
        while (i < j && centroidAxis(primBoxes_[i], axis) <  splitC) ++i;
        while (i < j && centroidAxis(primBoxes_[j - 1], axis) >= splitC) --j;
        if (i < j) {
            std::swap(prims_[i],     prims_[j - 1]);
            std::swap(primBoxes_[i], primBoxes_[j - 1]);
            ++i; --j;
        }
    }
    std::uint32_t mid = i;
    if (mid == first || mid == last) {
        // Degenerate centroid distribution — split down the middle.
        mid = first + count / 2;
    }

    // Recurse left + right. Interior nodes store `left` = left-child index
    // and `firstPrim` overloaded to mean right-child index when primCount=0.
    const std::uint32_t leftChild  = buildRecursive(first, mid);
    const std::uint32_t rightChild = buildRecursive(mid, last);
    node.left      = leftChild;
    node.firstPrim = rightChild;
    node.primCount = 0;
    nodes_[nodeIdx] = node;
    return nodeIdx;
}

void BVH::build(const std::vector<AABB>& aabbs,
                const std::vector<InstanceId>& ids) {
    nodes_.clear();
    prims_.clear();
    primBoxes_.clear();
    if (aabbs.empty()) return;

    prims_.reserve(ids.size());
    primBoxes_.reserve(aabbs.size());
    prims_     = ids;
    primBoxes_ = aabbs;

    // Pre-reserve roughly 2N nodes (binary tree bound).
    nodes_.reserve(2 * prims_.size() + 1);

    buildRecursive(0, static_cast<std::uint32_t>(prims_.size()));
}

void BVH::queryAABB(const AABB& box, std::vector<InstanceId>& out) const {
    if (nodes_.empty()) return;
    // Iterative stack; depth bounded by log2(N)+ε so 64 is huge.
    std::uint32_t stack[128];
    int top = 0;
    stack[top++] = 0;
    while (top > 0) {
        const Node& n = nodes_[stack[--top]];
        if (!n.box.intersects(box)) continue;
        if (n.primCount > 0) {
            // Leaf — test each prim's AABB.
            for (std::uint32_t i = 0; i < n.primCount; ++i) {
                const auto pi = n.firstPrim + i;
                if (primBoxes_[pi].intersects(box)) out.push_back(prims_[pi]);
            }
        } else {
            // Interior — push both children.
            stack[top++] = n.firstPrim; // right
            stack[top++] = n.left;      // left
        }
    }
}

void BVH::queryRay(const BvhRay& ray, std::vector<InstanceId>& out) const {
    if (nodes_.empty()) return;
    std::uint32_t stack[128];
    int top = 0;
    stack[top++] = 0;
    while (top > 0) {
        const Node& n = nodes_[stack[--top]];
        if (!rayAabb(ray, n.box)) continue;
        if (n.primCount > 0) {
            for (std::uint32_t i = 0; i < n.primCount; ++i) {
                const auto pi = n.firstPrim + i;
                if (rayAabb(ray, primBoxes_[pi])) out.push_back(prims_[pi]);
            }
        } else {
            stack[top++] = n.firstPrim;
            stack[top++] = n.left;
        }
    }
}

void BVH::queryFrustum(const std::array<BvhPlane,6>& planes,
                       std::vector<InstanceId>& out) const {
    if (nodes_.empty()) return;
    std::uint32_t stack[128];
    int top = 0;
    stack[top++] = 0;
    while (top > 0) {
        const Node& n = nodes_[stack[--top]];
        if (!aabbInFrustum(planes, n.box)) continue;
        if (n.primCount > 0) {
            for (std::uint32_t i = 0; i < n.primCount; ++i) {
                const auto pi = n.firstPrim + i;
                if (aabbInFrustum(planes, primBoxes_[pi])) out.push_back(prims_[pi]);
            }
        } else {
            stack[top++] = n.firstPrim;
            stack[top++] = n.left;
        }
    }
}

std::size_t BVH::bytesUsed() const {
    return nodes_.capacity() * sizeof(Node) +
           prims_.capacity() * sizeof(InstanceId) +
           primBoxes_.capacity() * sizeof(AABB);
}

} // namespace forge
