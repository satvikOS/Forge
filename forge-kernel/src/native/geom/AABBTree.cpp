// forge/native/geom/AABBTree.cpp
//
// Implementation of forge::native::geom::AABBTree — see AABBTree.hpp for the
// honest scope statement. Pure C++20, standard library only. No OCCT, no WASM,
// no third-party libs.
//
// Contents:
//   * Aabb helpers (expand / surface area / longest axis).
//   * build(): validate the soup, flatten triangles, recurse with Median or
//     binned-SAH splits into a leaf-contiguous node array.
//   * rayIntersect(): slab test for box pruning + Moeller–Trumbore per triangle,
//     traversing the nearer child first and pruning by the best t found.
//   * closestPoint(): point-to-AABB squared distance for pruning + exact
//     point-to-triangle projection per triangle.
//
// All arithmetic is plain IEEE-754 double. Pruning is CONSERVATIVE (a box is
// skipped only when it provably cannot improve the answer), so the tree returns
// the SAME answer as an O(n) scan — which the standalone gate verifies.

#include <cstdint>
#include "forge/native/geom/AABBTree.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

namespace forge {
namespace native {
namespace geom {

// ===========================================================================
// small vector helpers (local; do not leak symbols)
// ===========================================================================
namespace {

inline mesh::Vec3 sub(const mesh::Vec3& a, const mesh::Vec3& b) {
    return {a.x - b.x, a.y - b.y, a.z - b.z};
}
inline mesh::Vec3 add(const mesh::Vec3& a, const mesh::Vec3& b) {
    return {a.x + b.x, a.y + b.y, a.z + b.z};
}
inline mesh::Vec3 scale(const mesh::Vec3& a, double s) {
    return {a.x * s, a.y * s, a.z * s};
}
inline double dot(const mesh::Vec3& a, const mesh::Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline mesh::Vec3 cross(const mesh::Vec3& a, const mesh::Vec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double comp(const mesh::Vec3& v, int axis) {
    return axis == 0 ? v.x : (axis == 1 ? v.y : v.z);
}
inline bool finite3(const mesh::Vec3& v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

constexpr double kInf = std::numeric_limits<double>::infinity();

} // namespace

// ===========================================================================
// Aabb
// ===========================================================================
Aabb Aabb::empty() {
    Aabb b;
    b.minx = b.miny = b.minz = kInf;
    b.maxx = b.maxy = b.maxz = -kInf;
    return b;
}

void Aabb::expand(const mesh::Vec3& p) {
    minx = std::min(minx, p.x);
    miny = std::min(miny, p.y);
    minz = std::min(minz, p.z);
    maxx = std::max(maxx, p.x);
    maxy = std::max(maxy, p.y);
    maxz = std::max(maxz, p.z);
}

void Aabb::expand(const Aabb& o) {
    minx = std::min(minx, o.minx);
    miny = std::min(miny, o.miny);
    minz = std::min(minz, o.minz);
    maxx = std::max(maxx, o.maxx);
    maxy = std::max(maxy, o.maxy);
    maxz = std::max(maxz, o.maxz);
}

double Aabb::surfaceArea() const {
    if (!valid()) return 0.0;
    const double dx = maxx - minx;
    const double dy = maxy - miny;
    const double dz = maxz - minz;
    return 2.0 * (dx * dy + dy * dz + dz * dx);
}

int Aabb::longestAxis() const {
    const double dx = maxx - minx;
    const double dy = maxy - miny;
    const double dz = maxz - minz;
    if (dx >= dy && dx >= dz) return 0;
    if (dy >= dz) return 1;
    return 2;
}

// ===========================================================================
// build
// ===========================================================================
bool AABBTree::build(const std::vector<double>& positions,
                     const std::vector<std::uint32_t>& indices,
                     SplitMethod method) {
    tris_.clear();
    nodes_.clear();
    order_.clear();

    if (positions.size() % 3 != 0) return false;
    if (indices.size() % 3 != 0) return false;
    if (indices.empty()) return false;

    const std::size_t numVerts = positions.size() / 3;
    for (double v : positions) {
        if (!std::isfinite(v)) return false;
    }

    const std::size_t numTris = indices.size() / 3;
    tris_.reserve(numTris);

    for (std::size_t t = 0; t < numTris; ++t) {
        const std::uint32_t ia = indices[3 * t + 0];
        const std::uint32_t ib = indices[3 * t + 1];
        const std::uint32_t ic = indices[3 * t + 2];
        if (ia >= numVerts || ib >= numVerts || ic >= numVerts) {
            tris_.clear();
            return false;
        }
        if (ia == ib || ib == ic || ia == ic) {  // repeated index => degenerate
            tris_.clear();
            return false;
        }
        Tri tr;
        tr.a = {positions[3 * ia + 0], positions[3 * ia + 1], positions[3 * ia + 2]};
        tr.b = {positions[3 * ib + 0], positions[3 * ib + 1], positions[3 * ib + 2]};
        tr.c = {positions[3 * ic + 0], positions[3 * ic + 1], positions[3 * ic + 2]};
        // Reject zero-area (degenerate) triangles: no well-defined surface/normal.
        const mesh::Vec3 n = cross(sub(tr.b, tr.a), sub(tr.c, tr.a));
        if (dot(n, n) == 0.0) {
            tris_.clear();
            return false;
        }
        tr.centroid = scale(add(add(tr.a, tr.b), tr.c), 1.0 / 3.0);
        tr.srcIndex = t;
        tris_.push_back(tr);
    }

    // Build a working permutation; buildRange reorders it so that each leaf owns
    // a contiguous slice, then we physically permute tris_ to match.
    order_.resize(tris_.size());
    for (std::uint32_t i = 0; i < order_.size(); ++i) order_[i] = i;

    nodes_.reserve(2 * tris_.size());
    buildRange(0, static_cast<std::uint32_t>(order_.size()), method);

    // Physically reorder tris_ into leaf-contiguous order (so leaves index a
    // contiguous run of tris_ directly). order_ now holds the final permutation.
    std::vector<Tri> permuted;
    permuted.reserve(tris_.size());
    for (std::uint32_t idx : order_) permuted.push_back(tris_[idx]);
    tris_.swap(permuted);
    order_.clear();
    order_.shrink_to_fit();

    return true;
}

// Leaves hold at most this many triangles.
namespace { constexpr std::uint32_t kLeafSize = 4; }

std::uint32_t AABBTree::buildRange(std::uint32_t first, std::uint32_t last,
                                   SplitMethod method) {
    const std::uint32_t nodeIdx = static_cast<std::uint32_t>(nodes_.size());
    nodes_.push_back(Node{});

    // Compute this node's box over its triangles (full extent, not just centroids)
    Aabb box = Aabb::empty();
    Aabb centroidBox = Aabb::empty();
    for (std::uint32_t i = first; i < last; ++i) {
        const Tri& tr = tris_[order_[i]];
        box.expand(tr.a);
        box.expand(tr.b);
        box.expand(tr.c);
        centroidBox.expand(tr.centroid);
    }

    const std::uint32_t count = last - first;

    // Leaf if small enough, or if all centroids coincide (no way to split).
    bool makeLeaf = (count <= kLeafSize);
    if (!makeLeaf && centroidBox.surfaceArea() == 0.0 &&
        centroidBox.minx == centroidBox.maxx &&
        centroidBox.miny == centroidBox.maxy &&
        centroidBox.minz == centroidBox.maxz) {
        makeLeaf = true;
    }

    if (makeLeaf) {
        Node& nd = nodes_[nodeIdx];
        nd.box = box;
        nd.start = first;
        nd.count = count;
        return nodeIdx;
    }

    const int axis = centroidBox.longestAxis();
    std::uint32_t mid = first + count / 2;

    if (method == SplitMethod::Median) {
        // nth_element on centroid coordinate along `axis`.
        auto begin = order_.begin() + first;
        auto nth   = order_.begin() + mid;
        auto end   = order_.begin() + last;
        std::nth_element(begin, nth, end,
            [&](std::uint32_t lhs, std::uint32_t rhs) {
                return comp(tris_[lhs].centroid, axis) <
                       comp(tris_[rhs].centroid, axis);
            });
    } else {
        // Binned SAH along `axis`. Build kBins buckets over the centroid extent,
        // evaluate the standard SA-weighted cost for each of the kBins-1 planes,
        // and partition at the cheapest one. Falls back to the median split if
        // the SAH degenerates (every plane infinite cost / empty side).
        constexpr int kBins = 16;
        const double lo = comp({centroidBox.minx, centroidBox.miny, centroidBox.minz}, axis);
        const double hi = comp({centroidBox.maxx, centroidBox.maxy, centroidBox.maxz}, axis);
        const double extent = hi - lo;

        bool used = false;
        if (extent > 0.0) {
            std::array<std::uint32_t, kBins> binCount{};
            std::array<Aabb, kBins> binBox;
            for (auto& b : binBox) b = Aabb::empty();

            const double scaleK = static_cast<double>(kBins) / extent;
            auto binOf = [&](const Tri& tr) {
                int b = static_cast<int>((comp(tr.centroid, axis) - lo) * scaleK);
                if (b < 0) b = 0;
                if (b >= kBins) b = kBins - 1;
                return b;
            };
            for (std::uint32_t i = first; i < last; ++i) {
                const Tri& tr = tris_[order_[i]];
                const int b = binOf(tr);
                ++binCount[static_cast<std::size_t>(b)];
                binBox[static_cast<std::size_t>(b)].expand(tr.a);
                binBox[static_cast<std::size_t>(b)].expand(tr.b);
                binBox[static_cast<std::size_t>(b)].expand(tr.c);
            }

            // Prefix (left) and suffix (right) sweeps.
            std::array<double, kBins> leftArea{}, rightArea{};
            std::array<std::uint32_t, kBins> leftCount{}, rightCount{};
            {
                Aabb acc = Aabb::empty();
                std::uint32_t cnt = 0;
                for (int b = 0; b < kBins; ++b) {
                    acc.expand(binBox[static_cast<std::size_t>(b)]);
                    cnt += binCount[static_cast<std::size_t>(b)];
                    leftArea[static_cast<std::size_t>(b)] = acc.surfaceArea();
                    leftCount[static_cast<std::size_t>(b)] = cnt;
                }
            }
            {
                Aabb acc = Aabb::empty();
                std::uint32_t cnt = 0;
                for (int b = kBins - 1; b >= 0; --b) {
                    acc.expand(binBox[static_cast<std::size_t>(b)]);
                    cnt += binCount[static_cast<std::size_t>(b)];
                    rightArea[static_cast<std::size_t>(b)] = acc.surfaceArea();
                    rightCount[static_cast<std::size_t>(b)] = cnt;
                }
            }

            double bestCost = kInf;
            int bestSplit = -1;  // split AFTER bin `bestSplit` (left = [0..b])
            for (int b = 0; b < kBins - 1; ++b) {
                const std::uint32_t lc = leftCount[static_cast<std::size_t>(b)];
                const std::uint32_t rc = rightCount[static_cast<std::size_t>(b + 1)];
                if (lc == 0 || rc == 0) continue;
                const double cost =
                    leftArea[static_cast<std::size_t>(b)] * static_cast<double>(lc) +
                    rightArea[static_cast<std::size_t>(b + 1)] * static_cast<double>(rc);
                if (cost < bestCost) {
                    bestCost = cost;
                    bestSplit = b;
                }
            }

            if (bestSplit >= 0) {
                const double planeBin = static_cast<double>(bestSplit);
                auto begin = order_.begin() + first;
                auto end   = order_.begin() + last;
                auto pivot = std::partition(begin, end,
                    [&](std::uint32_t idx) {
                        int b = static_cast<int>(
                            (comp(tris_[idx].centroid, axis) - lo) * scaleK);
                        if (b < 0) b = 0;
                        if (b >= kBins) b = kBins - 1;
                        return static_cast<double>(b) <= planeBin;
                    });
                mid = static_cast<std::uint32_t>(pivot - order_.begin());
                // Guard against a partition that put everything on one side.
                if (mid > first && mid < last) used = true;
            }
        }

        if (!used) {
            auto begin = order_.begin() + first;
            auto nth   = order_.begin() + (first + count / 2);
            auto end   = order_.begin() + last;
            std::nth_element(begin, nth, end,
                [&](std::uint32_t lhs, std::uint32_t rhs) {
                    return comp(tris_[lhs].centroid, axis) <
                           comp(tris_[rhs].centroid, axis);
                });
            mid = first + count / 2;
        }
    }

    if (mid <= first || mid >= last) mid = first + count / 2;  // safety net

    const std::uint32_t l = buildRange(first, mid, method);
    const std::uint32_t r = buildRange(mid, last, method);

    Node& nd = nodes_[nodeIdx];
    nd.box = box;
    nd.start = 0;
    nd.count = 0;       // internal
    nd.left = l;
    nd.right = r;
    return nodeIdx;
}

Aabb AABBTree::bounds() const {
    if (nodes_.empty()) return Aabb::empty();
    return nodes_[0].box;
}

// ===========================================================================
// ray / box slab test  ->  [tEnter, tExit] interval; returns false if no overlap
// with [0, tMax]. `invDir` precomputed; handles axis-parallel rays via inf.
// ===========================================================================
namespace {

bool raySlab(const Aabb& box,
             const mesh::Vec3& origin, const mesh::Vec3& invDir,
             double tMax, double& tEnter) {
    double t0 = 0.0;
    double t1 = tMax;

    const double ox[3] = {origin.x, origin.y, origin.z};
    const double id[3] = {invDir.x, invDir.y, invDir.z};
    const double bmin[3] = {box.minx, box.miny, box.minz};
    const double bmax[3] = {box.maxx, box.maxy, box.maxz};

    for (int a = 0; a < 3; ++a) {
        double tn = (bmin[a] - ox[a]) * id[a];
        double tf = (bmax[a] - ox[a]) * id[a];
        if (tn > tf) std::swap(tn, tf);
        if (tn > t0) t0 = tn;
        if (tf < t1) t1 = tf;
        if (t0 > t1) return false;
    }
    tEnter = t0;
    return true;
}

// Moeller–Trumbore. Returns true and sets t (>=0) when the ray origin+t*dir
// meets the triangle within [0, tMax]. Double-sided. No tolerance fudge on the
// barycentric edges (a strict miss is a miss); a ray exactly grazing an edge is
// a measure-zero event we report consistently with the brute force, which uses
// the IDENTICAL test.
bool rayTri(const mesh::Vec3& origin, const mesh::Vec3& dir,
            const mesh::Vec3& a, const mesh::Vec3& b, const mesh::Vec3& c,
            double tMax, double& tOut) {
    const mesh::Vec3 e1 = sub(b, a);
    const mesh::Vec3 e2 = sub(c, a);
    const mesh::Vec3 p = cross(dir, e2);
    const double det = dot(e1, p);
    if (det == 0.0) return false;             // ray parallel to triangle plane
    const double invDet = 1.0 / det;
    const mesh::Vec3 tvec = sub(origin, a);
    const double u = dot(tvec, p) * invDet;
    if (u < 0.0 || u > 1.0) return false;
    const mesh::Vec3 q = cross(tvec, e1);
    const double v = dot(dir, q) * invDet;
    if (v < 0.0 || u + v > 1.0) return false;
    const double t = dot(e2, q) * invDet;
    if (t < 0.0 || t > tMax) return false;
    tOut = t;
    return true;
}

} // namespace

RayHit AABBTree::rayIntersect(const mesh::Vec3& origin, const mesh::Vec3& dir,
                              double tMax) const {
    RayHit out;
    if (nodes_.empty()) return out;
    if (!finite3(origin) || !finite3(dir)) return out;
    if (dot(dir, dir) == 0.0) return out;       // zero-length direction
    if (!(tMax > 0.0)) return out;

    const mesh::Vec3 invDir{1.0 / dir.x, 1.0 / dir.y, 1.0 / dir.z};

    double bestT = tMax;
    bool found = false;
    std::size_t bestTri = 0;

    // Manual stack traversal; visit the nearer child first to prune more.
    std::array<std::uint32_t, 128> stack;
    int sp = 0;
    stack[sp++] = 0;

    while (sp > 0) {
        const Node& nd = nodes_[stack[--sp]];

        double tEnter;
        if (!raySlab(nd.box, origin, invDir, bestT, tEnter)) continue;

        if (nd.count > 0) {  // leaf
            for (std::uint32_t i = 0; i < nd.count; ++i) {
                const Tri& tr = tris_[nd.start + i];
                double t;
                if (rayTri(origin, dir, tr.a, tr.b, tr.c, bestT, t)) {
                    if (t < bestT) {
                        bestT = t;
                        bestTri = tr.srcIndex;
                        found = true;
                    }
                }
            }
            continue;
        }

        // Internal: push children ordered so the nearer one is processed first
        // (popped last -> processed first means push the FARTHER one first).
        const Node& L = nodes_[nd.left];
        const Node& R = nodes_[nd.right];
        double tL, tR;
        const bool hitL = raySlab(L.box, origin, invDir, bestT, tL);
        const bool hitR = raySlab(R.box, origin, invDir, bestT, tR);
        if (hitL && hitR) {
            if (tL <= tR) {           // L nearer: process L first => push R then L
                if (sp + 2 <= static_cast<int>(stack.size())) {
                    stack[sp++] = nd.right;
                    stack[sp++] = nd.left;
                }
            } else {
                if (sp + 2 <= static_cast<int>(stack.size())) {
                    stack[sp++] = nd.left;
                    stack[sp++] = nd.right;
                }
            }
        } else if (hitL) {
            if (sp < static_cast<int>(stack.size())) stack[sp++] = nd.left;
        } else if (hitR) {
            if (sp < static_cast<int>(stack.size())) stack[sp++] = nd.right;
        }
    }

    if (found) {
        out.hit = true;
        out.t = bestT;
        out.tri = bestTri;
        out.point = add(origin, scale(dir, bestT));
    }
    return out;
}

RayHit AABBTree::rayIntersect(const mesh::Vec3& origin, const mesh::Vec3& dir) const {
    return rayIntersect(origin, dir, kInf);
}

RayHit AABBTree::rayIntersect(const Point3& origin, const Point3& dir) const {
    return rayIntersect(mesh::Vec3{origin.x, origin.y, origin.z},
                        mesh::Vec3{dir.x, dir.y, dir.z}, kInf);
}

// ===========================================================================
// closest point
// ===========================================================================
namespace {

// Squared distance from q to the closest point of box. 0 if q is inside.
double pointBoxDist2(const Aabb& box, const mesh::Vec3& q) {
    double d2 = 0.0;
    const double qx[3] = {q.x, q.y, q.z};
    const double bmin[3] = {box.minx, box.miny, box.minz};
    const double bmax[3] = {box.maxx, box.maxy, box.maxz};
    for (int a = 0; a < 3; ++a) {
        double d = 0.0;
        if (qx[a] < bmin[a]) d = bmin[a] - qx[a];
        else if (qx[a] > bmax[a]) d = qx[a] - bmax[a];
        d2 += d * d;
    }
    return d2;
}

// Closest point on triangle (a,b,c) to q. Standard Ericson region test.
mesh::Vec3 closestOnTri(const mesh::Vec3& q,
                        const mesh::Vec3& a, const mesh::Vec3& b,
                        const mesh::Vec3& c) {
    const mesh::Vec3 ab = sub(b, a);
    const mesh::Vec3 ac = sub(c, a);
    const mesh::Vec3 ap = sub(q, a);
    const double d1 = dot(ab, ap);
    const double d2 = dot(ac, ap);
    if (d1 <= 0.0 && d2 <= 0.0) return a;                       // vertex A

    const mesh::Vec3 bp = sub(q, b);
    const double d3 = dot(ab, bp);
    const double d4 = dot(ac, bp);
    if (d3 >= 0.0 && d4 <= d3) return b;                        // vertex B

    const double vc = d1 * d4 - d3 * d2;
    if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {                  // edge AB
        const double v = d1 / (d1 - d3);
        return add(a, scale(ab, v));
    }

    const mesh::Vec3 cp = sub(q, c);
    const double d5 = dot(ab, cp);
    const double d6 = dot(ac, cp);
    if (d6 >= 0.0 && d5 <= d6) return c;                        // vertex C

    const double vb = d5 * d2 - d1 * d6;
    if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {                  // edge AC
        const double w = d2 / (d2 - d6);
        return add(a, scale(ac, w));
    }

    const double va = d3 * d6 - d5 * d4;
    if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {    // edge BC
        const double w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return add(b, scale(sub(c, b), w));
    }

    // Inside face region.
    const double denom = 1.0 / (va + vb + vc);
    const double v = vb * denom;
    const double w = vc * denom;
    return add(add(a, scale(ab, v)), scale(ac, w));
}

inline double dist2(const mesh::Vec3& a, const mesh::Vec3& b) {
    const mesh::Vec3 d = sub(a, b);
    return dot(d, d);
}

} // namespace

ClosestResult AABBTree::closestPoint(const mesh::Vec3& q) const {
    ClosestResult out;
    if (nodes_.empty()) return out;
    if (!finite3(q)) return out;

    double bestD2 = kInf;
    mesh::Vec3 bestP{};
    std::size_t bestTri = 0;

    std::array<std::uint32_t, 128> stack;
    int sp = 0;
    stack[sp++] = 0;

    while (sp > 0) {
        const std::uint32_t ni = stack[--sp];
        const Node& nd = nodes_[ni];

        // Prune: if even the closest point of this box is farther than best, skip.
        if (pointBoxDist2(nd.box, q) >= bestD2) continue;

        if (nd.count > 0) {  // leaf
            for (std::uint32_t i = 0; i < nd.count; ++i) {
                const Tri& tr = tris_[nd.start + i];
                const mesh::Vec3 cp = closestOnTri(q, tr.a, tr.b, tr.c);
                const double d2 = dist2(cp, q);
                if (d2 < bestD2) {
                    bestD2 = d2;
                    bestP = cp;
                    bestTri = tr.srcIndex;
                }
            }
            continue;
        }

        // Internal: descend into the nearer child first.
        const Node& L = nodes_[nd.left];
        const Node& R = nodes_[nd.right];
        const double dL = pointBoxDist2(L.box, q);
        const double dR = pointBoxDist2(R.box, q);
        if (dL <= dR) {
            if (dR < bestD2 && sp < static_cast<int>(stack.size())) stack[sp++] = nd.right;
            if (dL < bestD2 && sp < static_cast<int>(stack.size())) stack[sp++] = nd.left;
        } else {
            if (dL < bestD2 && sp < static_cast<int>(stack.size())) stack[sp++] = nd.left;
            if (dR < bestD2 && sp < static_cast<int>(stack.size())) stack[sp++] = nd.right;
        }
    }

    out.ok = true;
    out.point = bestP;
    out.dist2 = bestD2;
    out.tri = bestTri;
    return out;
}

ClosestResult AABBTree::closestPoint(const Point3& q) const {
    return closestPoint(mesh::Vec3{q.x, q.y, q.z});
}

} // namespace geom
} // namespace native
} // namespace forge
