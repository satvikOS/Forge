// forge/native/mesh/BooleanBVH.cpp
//
// Implementation of forge::native::mesh::BooleanBVH and the cross-mesh
// intersection routines — see BooleanBVH.hpp for the honest scope statement.
// Pure C++20, standard library only. No OCCT, no WASM, no third-party libs.
//
// Contents:
//   * buildTris(): validate a soup with the SAME contract as geom::AABBTree and
//     flatten triangles + per-triangle AABBs (using the reused geom::Aabb type).
//   * BooleanBVH::build / buildRange: median-of-centroids BVH over triangle AABBs.
//   * BooleanBVH::queryOverlaps: stack traversal collecting boxes overlapping a
//     query box (conservative — never misses an overlapping triangle box).
//   * crossIntersectBVH: per-A-triangle box query into B's BVH + exact tri-tri.
//   * crossIntersectBruteForce: O(n*m) reference with IDENTICAL verdict logic.
//
// The BVH is a PURE ACCELERATION structure: it changes only WHICH cross-mesh
// pairs are handed to the exact triTriIntersect, never the verdict on a tested
// pair — which is why crossIntersectBVH returns the SAME pair set as the brute
// force (the standalone gate proves this on random meshes).

// CI PORTABILITY: explicitly include EVERY standard header used below. A header
// transitively available on Mac libc++ can be ABSENT under CI's libstdc++.
#include <algorithm>   // std::sort, std::nth_element
#include <array>       // std::array (traversal stacks)
#include <cmath>       // std::isfinite
#include <cstddef>     // std::size_t
#include <cstdint>     // std::uint32_t, std::uint64_t
#include <limits>      // (defensive — libstdc++ portability per task note)
#include <vector>      // std::vector

#include "forge/native/mesh/BooleanBVH.hpp"

// Reused kernel headers (declarations only here; defined in their own TUs).
#include "forge/native/Predicates.hpp"            // exact orient3d core
#include "forge/native/geom/Geom.hpp"             // Point3 / geom utilities
#include "forge/native/geom/Delaunay3D.hpp"       // Stage-2 geometry sibling
#include "forge/native/geom/AABBTree.hpp"         // geom::Aabb (reused box type)
#include "forge/native/mesh/HalfEdgeMesh.hpp"     // Vec3
#include "forge/native/mesh/TriTriIntersect.hpp"  // triTriIntersect
#include "forge/native/implicit/SdfTree.hpp"      // implicit sibling
#include "forge/native/implicit/IsoMesher.hpp"    // implicit sibling

namespace forge {
namespace native {
namespace mesh {

// ===========================================================================
// local helpers (anonymous namespace — no leaked symbols)
// ===========================================================================
namespace {

inline Vec3 sub(const Vec3& a, const Vec3& b) {
    return {a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Vec3 add(const Vec3& a, const Vec3& b) {
    return {a.x + b.x, a.y + b.y, a.z + b.z};
}
inline Vec3 scale(const Vec3& a, double s) {
    return {a.x * s, a.y * s, a.z * s};
}
inline double dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double comp(const Vec3& v, int axis) {
    return axis == 0 ? v.x : (axis == 1 ? v.y : v.z);
}

// Do two axis-aligned boxes overlap (closed intervals on every axis)? This is
// the conservative test the candidate finder uses: a true triangle intersection
// always has overlapping boxes, so a "no overlap" answer can NEVER drop a real
// crossing. Touching faces (equal on an axis) count as overlapping.
inline bool aabbOverlap(const geom::Aabb& a, const geom::Aabb& b) {
    return a.minx <= b.maxx && a.maxx >= b.minx &&
           a.miny <= b.maxy && a.maxy >= b.miny &&
           a.minz <= b.maxz && a.maxz >= b.minz;
}

// Validate a triangle soup with the SAME contract as geom::AABBTree::build and,
// on success, fill `outTris` (geometry + per-triangle AABB + centroid + source
// index). Returns false (and leaves outTris empty) on any dishonest input.
// `BuildTri` matches BooleanBVH::Tri field-for-field; we fill that type directly
// through the templated lambda the callers pass in.
template <class TriT, class MakeFn>
bool buildTrisImpl(const std::vector<double>& positions,
                   const std::vector<std::uint32_t>& indices,
                   std::vector<TriT>& outTris,
                   MakeFn make) {
    outTris.clear();
    if (positions.size() % 3 != 0) return false;
    if (indices.size() % 3 != 0) return false;
    if (indices.empty()) return false;

    const std::size_t numVerts = positions.size() / 3;
    for (double v : positions) {
        if (!std::isfinite(v)) return false;
    }

    const std::size_t numTris = indices.size() / 3;
    outTris.reserve(numTris);

    for (std::size_t t = 0; t < numTris; ++t) {
        const std::uint32_t ia = indices[3 * t + 0];
        const std::uint32_t ib = indices[3 * t + 1];
        const std::uint32_t ic = indices[3 * t + 2];
        if (ia >= numVerts || ib >= numVerts || ic >= numVerts) {
            outTris.clear();
            return false;
        }
        if (ia == ib || ib == ic || ia == ic) {   // repeated index => degenerate
            outTris.clear();
            return false;
        }
        const Vec3 a{positions[3 * ia + 0], positions[3 * ia + 1], positions[3 * ia + 2]};
        const Vec3 b{positions[3 * ib + 0], positions[3 * ib + 1], positions[3 * ib + 2]};
        const Vec3 c{positions[3 * ic + 0], positions[3 * ic + 1], positions[3 * ic + 2]};
        // Reject zero-area (degenerate) triangles — no well-defined surface.
        const Vec3 n = cross(sub(b, a), sub(c, a));
        if (dot(n, n) == 0.0) {
            outTris.clear();
            return false;
        }
        outTris.push_back(make(a, b, c, static_cast<std::uint32_t>(t)));
    }
    return true;
}

} // namespace

// ===========================================================================
// BooleanBVH
// ===========================================================================
bool BooleanBVH::build(const std::vector<double>& positions,
                       const std::vector<std::uint32_t>& indices) {
    tris_.clear();
    nodes_.clear();
    order_.clear();

    const bool ok = buildTrisImpl<Tri>(
        positions, indices, tris_,
        [](const Vec3& a, const Vec3& b, const Vec3& c, std::uint32_t src) {
            Tri tr;
            tr.a = a; tr.b = b; tr.c = c;
            tr.box = geom::Aabb::empty();
            tr.box.expand(a);
            tr.box.expand(b);
            tr.box.expand(c);
            tr.centroid = scale(add(add(a, b), c), 1.0 / 3.0);
            tr.srcIndex = src;
            return tr;
        });
    if (!ok) {
        tris_.clear();
        return false;
    }

    order_.resize(tris_.size());
    for (std::uint32_t i = 0; i < order_.size(); ++i) order_[i] = i;

    nodes_.reserve(2 * tris_.size());
    buildRange(0, static_cast<std::uint32_t>(order_.size()));

    // Physically reorder tris_ into leaf-contiguous order.
    std::vector<Tri> permuted;
    permuted.reserve(tris_.size());
    for (std::uint32_t idx : order_) permuted.push_back(tris_[idx]);
    tris_.swap(permuted);
    order_.clear();
    order_.shrink_to_fit();
    return true;
}

namespace { constexpr std::uint32_t kLeafSize = 4; }

std::uint32_t BooleanBVH::buildRange(std::uint32_t first, std::uint32_t last) {
    const std::uint32_t nodeIdx = static_cast<std::uint32_t>(nodes_.size());
    nodes_.push_back(Node{});

    geom::Aabb box = geom::Aabb::empty();
    geom::Aabb centroidBox = geom::Aabb::empty();
    for (std::uint32_t i = first; i < last; ++i) {
        const Tri& tr = tris_[order_[i]];
        box.expand(tr.box);
        centroidBox.expand(tr.centroid);
    }

    const std::uint32_t count = last - first;

    bool makeLeaf = (count <= kLeafSize);
    if (!makeLeaf &&
        centroidBox.minx == centroidBox.maxx &&
        centroidBox.miny == centroidBox.maxy &&
        centroidBox.minz == centroidBox.maxz) {
        makeLeaf = true;   // all centroids coincide — cannot split further
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

    // Median-of-centroids split along the longest centroid axis.
    {
        auto begin = order_.begin() + first;
        auto nth   = order_.begin() + mid;
        auto end   = order_.begin() + last;
        std::nth_element(begin, nth, end,
            [&](std::uint32_t lhs, std::uint32_t rhs) {
                return comp(tris_[lhs].centroid, axis) <
                       comp(tris_[rhs].centroid, axis);
            });
    }
    if (mid <= first || mid >= last) mid = first + count / 2;  // safety net

    const std::uint32_t l = buildRange(first, mid);
    const std::uint32_t r = buildRange(mid, last);

    Node& nd = nodes_[nodeIdx];
    nd.box = box;
    nd.start = 0;
    nd.count = 0;     // internal
    nd.left = l;
    nd.right = r;
    return nodeIdx;
}

geom::Aabb BooleanBVH::bounds() const {
    if (nodes_.empty()) return geom::Aabb::empty();
    return nodes_[0].box;
}

void BooleanBVH::queryOverlaps(const geom::Aabb& query,
                               std::vector<std::uint32_t>& out) const {
    if (nodes_.empty()) return;
    if (!query.valid()) return;

    std::array<std::uint32_t, 128> stack;
    int sp = 0;
    stack[sp++] = 0;

    while (sp > 0) {
        const Node& nd = nodes_[stack[--sp]];
        if (!aabbOverlap(nd.box, query)) continue;

        if (nd.count > 0) {  // leaf
            for (std::uint32_t i = 0; i < nd.count; ++i) {
                const Tri& tr = tris_[nd.start + i];
                if (aabbOverlap(tr.box, query)) out.push_back(tr.srcIndex);
            }
            continue;
        }
        if (sp + 2 <= static_cast<int>(stack.size())) {
            stack[sp++] = nd.left;
            stack[sp++] = nd.right;
        }
    }
}

// ===========================================================================
// cross-mesh intersection
// ===========================================================================
namespace {

// Shared per-pair verdict used by BOTH the BVH path and the brute-force path,
// so the two cannot disagree by construction. Returns true (and fills `cp`) iff
// triangles A and B genuinely intersect. triA / triB are source triangle
// indices; `boxA` / `boxB` are the triangles' precomputed AABBs.
//
// THE AABB-OVERLAP PRECONDITION (sound, and load-bearing for the spec):
//   Two triangles whose axis-aligned boxes are DISJOINT cannot share a point —
//   any common point would lie in both boxes — so "boxes overlap" is a SOUND
//   filter that can never drop a true geometric intersection. We apply it in the
//   SHARED verdict so that:
//     (a) the brute-force reference's "intersecting pair" set is exactly the
//         pairs the BVH (which only ever tests box-overlapping candidates) can
//         reach — the two paths agree BY CONSTRUCTION, as the spec demands; and
//     (b) it suppresses a known coplanar false-positive of the underlying
//         triTriIntersect (which, for two FAR-APART coplanar triangles, returns
//         COPLANAR_OVERLAP rather than DISJOINT). Filtering on disjoint boxes is
//         the geometrically-correct verdict and needs no edit to that file.
bool classifyPair(std::uint32_t triA, std::uint32_t triB,
                  const geom::Aabb& boxA, const geom::Aabb& boxB,
                  const Vec3& a0, const Vec3& a1, const Vec3& a2,
                  const Vec3& b0, const Vec3& b1, const Vec3& b2,
                  CrossPair& cp) {
    if (!aabbOverlap(boxA, boxB)) return false;           // sound: cannot intersect
    const TriTriResult r = triTriIntersect(a0, a1, a2, b0, b1, b2);
    if (r.degenerate) return false;                       // malformed pair
    if (r.relation == TriTriRelation::DISJOINT) return false;
    cp.triA = triA;
    cp.triB = triB;
    cp.relation = static_cast<int>(r.relation);
    cp.p = r.p;
    cp.q = r.q;
    return true;
}

// Per-triangle geometry + AABB for the A side of the brute-force / query loops.
struct PlainTri {
    Vec3 a, b, c;
    geom::Aabb box;
    std::uint32_t srcIndex;
};

bool buildPlainTris(const std::vector<double>& positions,
                    const std::vector<std::uint32_t>& indices,
                    std::vector<PlainTri>& out) {
    return buildTrisImpl<PlainTri>(
        positions, indices, out,
        [](const Vec3& a, const Vec3& b, const Vec3& c, std::uint32_t src) {
            PlainTri tr;
            tr.a = a; tr.b = b; tr.c = c;
            tr.box = geom::Aabb::empty();
            tr.box.expand(a);
            tr.box.expand(b);
            tr.box.expand(c);
            tr.srcIndex = src;
            return tr;
        });
}

void sortPairs(std::vector<CrossPair>& pairs) {
    std::sort(pairs.begin(), pairs.end(),
              [](const CrossPair& x, const CrossPair& y) {
                  if (x.triA != y.triA) return x.triA < y.triA;
                  return x.triB < y.triB;
              });
}

} // namespace

CrossIntersectReport crossIntersectBVH(const std::vector<double>& positionsA,
                                       const std::vector<std::uint32_t>& indicesA,
                                       const std::vector<double>& positionsB,
                                       const std::vector<std::uint32_t>& indicesB) {
    CrossIntersectReport rep;

    // Validate A (flatten its triangles with AABBs); validate B by building its
    // BVH. Either failing is an honest ok=false with an empty report.
    std::vector<PlainTri> trisA;
    if (!buildPlainTris(positionsA, indicesA, trisA)) return rep;

    BooleanBVH bvhB;
    if (!bvhB.build(positionsB, indicesB)) return rep;

    // We still need B's flattened triangle geometry indexed by SOURCE index to
    // run the exact primitive (the BVH stores geometry in permuted order). Build
    // a plain source-indexed copy of B; it shares the same validated contract.
    std::vector<PlainTri> trisB;
    if (!buildPlainTris(positionsB, indicesB, trisB)) return rep;

    const std::uint32_t nA = static_cast<std::uint32_t>(trisA.size());
    const std::uint32_t nB = static_cast<std::uint32_t>(trisB.size());
    rep.ok = true;
    rep.numTrisA = nA;
    rep.numTrisB = nB;
    rep.pairsBrute = static_cast<std::uint64_t>(nA) * static_cast<std::uint64_t>(nB);

    std::vector<std::uint32_t> cand;
    std::uint64_t tested = 0;

    for (const PlainTri& ta : trisA) {
        cand.clear();
        bvhB.queryOverlaps(ta.box, cand);
        for (std::uint32_t jb : cand) {
            const PlainTri& tb = trisB[jb];
            ++tested;
            CrossPair cp;
            if (classifyPair(ta.srcIndex, tb.srcIndex, ta.box, tb.box,
                             ta.a, ta.b, ta.c, tb.a, tb.b, tb.c, cp)) {
                rep.pairs.push_back(cp);
            }
        }
    }

    rep.pairsTested = tested;
    sortPairs(rep.pairs);
    rep.disjoint = rep.pairs.empty();
    return rep;
}

CrossIntersectReport crossIntersectBruteForce(const std::vector<double>& positionsA,
                                              const std::vector<std::uint32_t>& indicesA,
                                              const std::vector<double>& positionsB,
                                              const std::vector<std::uint32_t>& indicesB) {
    CrossIntersectReport rep;

    std::vector<PlainTri> trisA, trisB;
    if (!buildPlainTris(positionsA, indicesA, trisA)) return rep;
    if (!buildPlainTris(positionsB, indicesB, trisB)) return rep;

    const std::uint32_t nA = static_cast<std::uint32_t>(trisA.size());
    const std::uint32_t nB = static_cast<std::uint32_t>(trisB.size());
    rep.ok = true;
    rep.numTrisA = nA;
    rep.numTrisB = nB;
    rep.pairsBrute = static_cast<std::uint64_t>(nA) * static_cast<std::uint64_t>(nB);

    std::uint64_t tested = 0;
    for (const PlainTri& ta : trisA) {
        for (const PlainTri& tb : trisB) {
            ++tested;
            CrossPair cp;
            if (classifyPair(ta.srcIndex, tb.srcIndex, ta.box, tb.box,
                             ta.a, ta.b, ta.c, tb.a, tb.b, tb.c, cp)) {
                rep.pairs.push_back(cp);
            }
        }
    }

    rep.pairsTested = tested;   // == pairsBrute for the brute path
    sortPairs(rep.pairs);
    rep.disjoint = rep.pairs.empty();
    return rep;
}

} // namespace mesh
} // namespace native
} // namespace forge
