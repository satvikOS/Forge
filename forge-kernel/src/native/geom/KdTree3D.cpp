// forge/native/geom/KdTree3D.cpp
//
// Implementation of forge::native::geom::KdTree3D. Pure C++20, stdlib only.
// See KdTree3D.hpp for the honest scope / correctness posture / edge-case
// contract. Nothing here re-implements a point type or a predicate.

#include "forge/native/geom/KdTree3D.hpp"

#include <algorithm>  // std::nth_element, std::sort, std::min/max, std::push_heap/pop_heap
#include <array>
#include <cmath>      // std::isfinite, std::sqrt
#include <cstddef>
#include <limits>

namespace forge {
namespace native {
namespace geom {

// ---------------------------------------------------------------------------
// Local helpers (file-internal). Distances are SQUARED Euclidean in double —
// the identical scalar a brute-force scan uses — so the kd-tree result matches
// brute force exactly on the comparison key, never merely within a tolerance.
// ---------------------------------------------------------------------------
namespace {

inline double coord(const Point3& p, int axis) {
    return axis == 0 ? p.x : (axis == 1 ? p.y : p.z);
}

inline double sqDist(const Point3& a, const Point3& b) {
    const double dx = a.x - b.x;
    const double dy = a.y - b.y;
    const double dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

inline bool finite3(const Point3& p) {
    return std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z);
}

// A candidate during search: squared distance + original point index. Ordered
// so that the WORST (largest) candidate is the heap top, with ties broken so
// that the LARGER index is "worse" — this yields the deterministic tie rule
// (smaller index wins) once the final set is sorted ascending.
struct Cand {
    double      d2;
    std::size_t idx;
};

// "a is worse than b" for the max-heap: larger distance is worse; on equal
// distance, larger index is worse (so it is evicted first, keeping the smaller
// index — matching the documented tie rule).
inline bool worse(const Cand& a, const Cand& b) {
    if (a.d2 != b.d2) return a.d2 < b.d2;  // for a MAX-heap, "less" = "not top"
    return a.idx < b.idx;
}

// Final ordering of the result set: ascending distance, then ascending index.
inline bool finalLess(const Cand& a, const Cand& b) {
    if (a.d2 != b.d2) return a.d2 < b.d2;
    return a.idx < b.idx;
}

} // namespace

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------
bool KdTree3D::build(const std::vector<Point3>& points) {
    // Reset to a clean, honestly-empty state.
    points_.clear();
    nodes_.clear();
    root_ = kNoChild;
    built_ = false;

    // Reject non-finite input rather than silently sanitizing it.
    for (const Point3& p : points) {
        if (!finite3(p)) {
            // Leave the tree empty and unbuilt; the caller gets ok=false here
            // and ok=false from every subsequent query.
            return false;
        }
    }

    points_ = points;            // own a copy

    // Empty input is a valid empty tree (built, size 0).
    if (points_.empty()) {
        built_ = true;
        return true;
    }

    nodes_.reserve(points_.size());
    std::vector<std::uint32_t> order(points_.size());
    for (std::size_t i = 0; i < order.size(); ++i)
        order[i] = static_cast<std::uint32_t>(i);

    root_ = buildRange(order, 0, order.size());
    built_ = true;
    return true;
}

// Build over order[lo,hi): pick the split axis of largest extent, partition at
// the median along it, recurse. O(n) partition per level, O(log n) levels.
std::uint32_t KdTree3D::buildRange(std::vector<std::uint32_t>& order,
                                   std::size_t lo, std::size_t hi) {
    if (lo >= hi) return kNoChild;

    // Choose the axis with the largest coordinate spread over this range — the
    // standard "widest dimension" rule that keeps the tree well balanced.
    std::array<double, 3> mn{ std::numeric_limits<double>::infinity(),
                              std::numeric_limits<double>::infinity(),
                              std::numeric_limits<double>::infinity() };
    std::array<double, 3> mx{ -std::numeric_limits<double>::infinity(),
                              -std::numeric_limits<double>::infinity(),
                              -std::numeric_limits<double>::infinity() };
    for (std::size_t i = lo; i < hi; ++i) {
        const Point3& p = points_[order[i]];
        for (int a = 0; a < 3; ++a) {
            const double c = coord(p, a);
            mn[a] = std::min(mn[a], c);
            mx[a] = std::max(mx[a], c);
        }
    }
    int axis = 0;
    double best = mx[0] - mn[0];
    for (int a = 1; a < 3; ++a) {
        const double ext = mx[a] - mn[a];
        if (ext > best) { best = ext; axis = a; }
    }

    // Median split. nth_element places the median element; partition is by the
    // chosen axis, ties broken by index so the split is deterministic.
    const std::size_t mid = lo + (hi - lo) / 2;
    std::nth_element(order.begin() + static_cast<long>(lo),
                     order.begin() + static_cast<long>(mid),
                     order.begin() + static_cast<long>(hi),
                     [&](std::uint32_t l, std::uint32_t r) {
                         const double cl = coord(points_[l], axis);
                         const double cr = coord(points_[r], axis);
                         if (cl != cr) return cl < cr;
                         return l < r;
                     });

    const std::uint32_t nodeIdx = static_cast<std::uint32_t>(nodes_.size());
    nodes_.push_back(Node{});  // reserve slot; fill after recursion (vector may grow)

    const std::uint32_t splitter = order[mid];
    const std::uint32_t leftChild  = buildRange(order, lo, mid);
    const std::uint32_t rightChild = buildRange(order, mid + 1, hi);

    Node& n = nodes_[nodeIdx];
    n.point = splitter;
    n.axis  = static_cast<std::uint8_t>(axis);
    n.left  = leftChild;
    n.right = rightChild;
    return nodeIdx;
}

// ---------------------------------------------------------------------------
// kNearest — bounded max-heap of size k, branch-and-bound traversal.
// ---------------------------------------------------------------------------
KnnResult KdTree3D::kNearest(const Point3& q, int k) const {
    KnnResult res;
    if (!built_) { res.ok = false; return res; }  // honest failure on unbuilt tree
    res.ok = true;
    if (k <= 0 || points_.empty()) return res;     // honestly empty, not a failure

    const std::size_t kk = std::min<std::size_t>(static_cast<std::size_t>(k),
                                                 points_.size());

    // Max-heap (by `worse`) holding at most kk best candidates. Top is the
    // current kk-th nearest; its distance is the pruning radius.
    std::vector<Cand> heap;
    heap.reserve(kk);

    // Iterative DFS with an explicit stack to avoid recursion depth concerns on
    // large inputs. Each frame is a node index.
    std::vector<std::uint32_t> stack;
    stack.reserve(64);
    if (root_ != kNoChild) stack.push_back(root_);

    // To honor "descend the near side first" pruning, we instead push children
    // in far-then-near order so the near side is processed first (LIFO). The
    // pruning is applied when a node is popped, using the current worst radius.
    // We re-expand by re-pushing children with the near side on top.
    //
    // Implementation: store a small struct so we know whether a node still needs
    // its children expanded. Simpler & equally correct: classic recursion via an
    // explicit work stack of node ids, ordering children by side at push time.
    while (!stack.empty()) {
        const std::uint32_t ni = stack.back();
        stack.pop_back();
        if (ni == kNoChild) continue;
        const Node& nd = nodes_[ni];

        // Consider this node's own point.
        const double d2 = sqDist(points_[nd.point], q);
        const Cand c{ d2, static_cast<std::size_t>(nd.point) };
        if (heap.size() < kk) {
            heap.push_back(c);
            std::push_heap(heap.begin(), heap.end(), worse);
        } else if (finalLess(c, heap.front())) {
            // c is strictly better than the current worst kept candidate
            // (closer, or equal distance with a smaller index) -> replace it.
            std::pop_heap(heap.begin(), heap.end(), worse);
            heap.back() = c;
            std::push_heap(heap.begin(), heap.end(), worse);
        }

        const double diff = coord(q, nd.axis) - coord(points_[nd.point], nd.axis);
        const std::uint32_t nearChild = diff <= 0.0 ? nd.left  : nd.right;
        const std::uint32_t farChild  = diff <= 0.0 ? nd.right : nd.left;

        // Decide whether the far side can possibly contain a closer point: only
        // if the heap is not yet full, or the splitting-plane gap is closer than
        // the current worst kept distance. diff*diff is the exact squared
        // distance from q to the splitting plane.
        const bool farPossible =
            heap.size() < kk || (diff * diff) <= heap.front().d2;

        // Push far first, near last, so near is popped (processed) first.
        if (farPossible && farChild != kNoChild) stack.push_back(farChild);
        if (nearChild != kNoChild)               stack.push_back(nearChild);
    }

    // Emit ascending distance, then ascending index.
    res.neighbors.reserve(heap.size());
    std::sort(heap.begin(), heap.end(), finalLess);
    for (const Cand& c : heap)
        res.neighbors.push_back(Neighbor{ c.idx, std::sqrt(c.d2) });
    return res;
}

// ---------------------------------------------------------------------------
// radiusSearch — collect all points with |p-q| <= r, then order like kNearest.
// ---------------------------------------------------------------------------
KnnResult KdTree3D::radiusSearch(const Point3& q, double r) const {
    KnnResult res;
    if (!built_) { res.ok = false; return res; }  // honest failure on unbuilt tree
    res.ok = true;
    if (r < 0.0 || points_.empty()) return res;    // empty ball / empty tree

    const double r2 = r * r;

    std::vector<Cand> hits;
    std::vector<std::uint32_t> stack;
    stack.reserve(64);
    if (root_ != kNoChild) stack.push_back(root_);

    while (!stack.empty()) {
        const std::uint32_t ni = stack.back();
        stack.pop_back();
        if (ni == kNoChild) continue;
        const Node& nd = nodes_[ni];

        const double d2 = sqDist(points_[nd.point], q);
        if (d2 <= r2)
            hits.push_back(Cand{ d2, static_cast<std::size_t>(nd.point) });

        const double diff = coord(q, nd.axis) - coord(points_[nd.point], nd.axis);
        const std::uint32_t nearChild = diff <= 0.0 ? nd.left  : nd.right;
        const std::uint32_t farChild  = diff <= 0.0 ? nd.right : nd.left;

        // Far side reachable only if the splitting plane is within radius r.
        if ((diff * diff) <= r2 && farChild != kNoChild) stack.push_back(farChild);
        if (nearChild != kNoChild)                        stack.push_back(nearChild);
    }

    std::sort(hits.begin(), hits.end(), finalLess);
    res.neighbors.reserve(hits.size());
    for (const Cand& c : hits)
        res.neighbors.push_back(Neighbor{ c.idx, std::sqrt(c.d2) });
    return res;
}

} // namespace geom
} // namespace native
} // namespace forge
