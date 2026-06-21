// forge/native/geom/SurfaceIntersect.cpp
//
// Implementation of forge::native::geom::surfaceIntersect — the mesh-level
// surface–surface intersection (OCCT SSI analog). See SurfaceIntersect.hpp for
// the honest scope / envelope statement. Pure C++20, standard library only.
// No OCCT, no WASM, no third-party libs.
//
// Pipeline (mirrors the header):
//   validate -> AABBTree per mesh (+ bounds() disjoint reject) -> uniform-grid
//   complete broadphase of candidate tri pairs -> exact triTriIntersect per pair
//   -> weld endpoints -> trace polylines (open chains + closed loops).

#include "forge/native/geom/SurfaceIntersect.hpp"

// The named reuse surface (by #include only — never re-deriving these):
#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/AABBTree.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"
#include "forge/native/mesh/FeatureEdges.hpp"
#include "forge/native/mesh/TriTriIntersect.hpp"

// CI portability: explicitly include EVERY standard header used. A missing
// include compiles on Mac libc++ (transitive) but FAILS CI's libstdc++.
#include <algorithm>
#include <numeric>
#include <functional>
#include <cstdint>
#include <limits>
#include <cstring>
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <set>
#include <cmath>
#include <string>
#include <vector>
#include <array>

namespace forge {
namespace native {
namespace geom {

namespace {

// ---------------------------------------------------------------------------
// tiny double-vector helpers (local; do not leak symbols)
// ---------------------------------------------------------------------------
inline mesh::Vec3 vsub(const mesh::Vec3& a, const mesh::Vec3& b) {
    return {a.x - b.x, a.y - b.y, a.z - b.z};
}
inline double vdot(const mesh::Vec3& a, const mesh::Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline mesh::Vec3 vcross(const mesh::Vec3& a, const mesh::Vec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline double vdist2(const mesh::Vec3& a, const mesh::Vec3& b) {
    const mesh::Vec3 d = vsub(a, b);
    return vdot(d, d);
}
inline bool finite3(const mesh::Vec3& v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

// A validated triangle soup: per-triangle corner positions + world AABB.
struct SoupTri {
    mesh::Vec3 a, b, c;
    double lo[3];
    double hi[3];
};

// Validate a flat soup and flatten it into SoupTri. Mirrors AABBTree::build's
// honesty rules so that what we accept here is exactly what the BVH accepts.
//   returns "" on success, else a static reason string.
const char* buildSoup(const std::vector<double>& pos,
                      const std::vector<std::uint32_t>& idx,
                      std::vector<SoupTri>& out) {
    out.clear();
    if (pos.size() % 3 != 0) return "ragged positions";
    if (idx.size() % 3 != 0) return "ragged indices";
    if (idx.empty())         return "empty mesh";

    const std::size_t numVerts = pos.size() / 3;
    for (double v : pos) {
        if (!std::isfinite(v)) return "non-finite coordinate";
    }

    const std::size_t numTris = idx.size() / 3;
    out.reserve(numTris);
    for (std::size_t t = 0; t < numTris; ++t) {
        const std::uint32_t ia = idx[3 * t + 0];
        const std::uint32_t ib = idx[3 * t + 1];
        const std::uint32_t ic = idx[3 * t + 2];
        if (ia >= numVerts || ib >= numVerts || ic >= numVerts) {
            out.clear();
            return "index out of range";
        }
        if (ia == ib || ib == ic || ia == ic) {
            out.clear();
            return "repeated vertex in a face";
        }
        SoupTri tr;
        tr.a = {pos[3 * ia + 0], pos[3 * ia + 1], pos[3 * ia + 2]};
        tr.b = {pos[3 * ib + 0], pos[3 * ib + 1], pos[3 * ib + 2]};
        tr.c = {pos[3 * ic + 0], pos[3 * ic + 1], pos[3 * ic + 2]};
        const mesh::Vec3 n = vcross(vsub(tr.b, tr.a), vsub(tr.c, tr.a));
        if (vdot(n, n) == 0.0) {           // zero-area => degenerate
            out.clear();
            return "zero-area triangle";
        }
        for (int axis = 0; axis < 3; ++axis) {
            auto comp = [&](const mesh::Vec3& v) {
                return axis == 0 ? v.x : (axis == 1 ? v.y : v.z);
            };
            tr.lo[axis] = std::min(comp(tr.a), std::min(comp(tr.b), comp(tr.c)));
            tr.hi[axis] = std::max(comp(tr.a), std::max(comp(tr.b), comp(tr.c)));
        }
        out.push_back(tr);
    }
    return "";
}

// ---------------------------------------------------------------------------
// Uniform-grid broadphase (COMPLETE: a true intersection has overlapping AABBs,
// so the two triangles co-occupy at least one cell — no real pair is dropped).
// We rasterise mesh B's triangle boxes into a hashed sparse grid, then probe
// each of mesh A's triangle boxes against the cells it spans. Cell size = mean
// triangle-box extent across both meshes (so a triangle spans a few cells).
// ---------------------------------------------------------------------------
struct Grid {
    double cell = 1.0;
    double origin[3] = {0, 0, 0};
    // cell key -> list of B triangle indices occupying it.
    std::unordered_map<std::uint64_t, std::vector<std::uint32_t>> buckets;

    static std::uint64_t key(std::int64_t i, std::int64_t j, std::int64_t k) {
        // Mix three 21-bit-ish cell coords into one 64-bit key. Offset keeps
        // negatives non-negative within the practical range.
        const std::uint64_t bias = 1ull << 20;
        std::uint64_t x = static_cast<std::uint64_t>(i + static_cast<std::int64_t>(bias)) & 0x1FFFFFull;
        std::uint64_t y = static_cast<std::uint64_t>(j + static_cast<std::int64_t>(bias)) & 0x1FFFFFull;
        std::uint64_t z = static_cast<std::uint64_t>(k + static_cast<std::int64_t>(bias)) & 0x1FFFFFull;
        return (x << 42) | (y << 21) | z;
    }
    std::int64_t coord(double v, int axis) const {
        return static_cast<std::int64_t>(std::floor((v - origin[axis]) / cell));
    }
};

} // namespace

// ===========================================================================
SurfaceIntersectResult surfaceIntersect(
    const std::vector<double>& positionsA,
    const std::vector<std::uint32_t>& indicesA,
    const std::vector<double>& positionsB,
    const std::vector<std::uint32_t>& indicesB,
    const SurfaceIntersectOptions& opts) {

    SurfaceIntersectResult res;

    // ---- (1) validate + flatten both soups -------------------------------
    std::vector<SoupTri> trisA, trisB;
    if (const char* why = buildSoup(positionsA, indicesA, trisA); why[0] != '\0') {
        res.ok = false; res.reason = why; return res;
    }
    if (const char* why = buildSoup(positionsB, indicesB, trisB); why[0] != '\0') {
        res.ok = false; res.reason = why; return res;
    }

    // ---- (2) AABBTree per mesh (mandated spatial structure) ---------------
    // Built over each mesh; bounds() gives the O(1) globally-disjoint reject and
    // the node count is surfaced as a diagnostic. The trees accept exactly the
    // soups buildSoup accepted (same honesty rules), so a build failure here
    // would indicate an internal inconsistency.
    AABBTree treeA, treeB;
    if (!treeA.build(positionsA, indicesA) || !treeB.build(positionsB, indicesB)) {
        res.ok = false; res.reason = "internal: AABBTree build disagreed with soup validation";
        return res;
    }
    res.nodesA = treeA.nodeCount();
    res.nodesB = treeB.nodeCount();

    // Global bounds: a fast disjoint reject (and the bbox diagonal for tolerances).
    const Aabb bA = treeA.bounds();
    const Aabb bB = treeB.bounds();
    res.ok = true;  // from here, every early return is a valid (possibly empty) answer

    auto boxesDisjoint = [](const Aabb& x, const Aabb& y) {
        return x.maxx < y.minx || y.maxx < x.minx ||
               x.maxy < y.miny || y.maxy < x.miny ||
               x.maxz < y.minz || y.maxz < x.minz;
    };

    // Combined bbox diagonal -> absolute weld tolerance.
    Aabb both = bA; both.expand(bB);
    const double diag = std::sqrt(
        (both.maxx - both.minx) * (both.maxx - both.minx) +
        (both.maxy - both.miny) * (both.maxy - both.miny) +
        (both.maxz - both.minz) * (both.maxz - both.minz));
    double frac = opts.weldTolFrac > 0.0 ? opts.weldTolFrac : 1e-7;
    res.weldTol = (diag > 0.0 ? diag : 1.0) * frac;

    if (boxesDisjoint(bA, bB)) {
        // Globally disjoint: zero polylines, ok=true (not a failure).
        return res;
    }

    // ---- (2b) build the uniform grid over mesh B --------------------------
    Grid grid;
    {
        // mean triangle-box extent across BOTH meshes (avoids absurd cell sizes)
        double sumExt = 0.0;
        std::size_t cnt = 0;
        auto accum = [&](const std::vector<SoupTri>& T) {
            for (const SoupTri& t : T) {
                const double ex = (t.hi[0] - t.lo[0]) +
                                  (t.hi[1] - t.lo[1]) +
                                  (t.hi[2] - t.lo[2]);
                sumExt += ex / 3.0;
                ++cnt;
            }
        };
        accum(trisA);
        accum(trisB);
        double meanExt = (cnt > 0) ? (sumExt / static_cast<double>(cnt)) : 1.0;
        if (!(meanExt > 0.0)) meanExt = 1.0;
        grid.cell = meanExt;
        grid.origin[0] = both.minx;
        grid.origin[1] = both.miny;
        grid.origin[2] = both.minz;

        for (std::uint32_t bi = 0; bi < trisB.size(); ++bi) {
            const SoupTri& t = trisB[bi];
            const std::int64_t i0 = grid.coord(t.lo[0], 0), i1 = grid.coord(t.hi[0], 0);
            const std::int64_t j0 = grid.coord(t.lo[1], 1), j1 = grid.coord(t.hi[1], 1);
            const std::int64_t k0 = grid.coord(t.lo[2], 2), k1 = grid.coord(t.hi[2], 2);
            for (std::int64_t i = i0; i <= i1; ++i)
                for (std::int64_t j = j0; j <= j1; ++j)
                    for (std::int64_t k = k0; k <= k1; ++k)
                        grid.buckets[Grid::key(i, j, k)].push_back(bi);
        }
    }

    // ---- (3) narrowphase: exact triTriIntersect over candidate pairs ------
    // For each A triangle, gather the unique set of B triangles whose grid cells
    // it overlaps; AABB-reject; then exact tri-tri. Deterministic ordering: outer
    // loop over A index, inner over sorted-unique B index.
    auto boxOverlapTri = [](const SoupTri& x, const SoupTri& y) {
        for (int k = 0; k < 3; ++k) {
            if (x.hi[k] < y.lo[k] || y.hi[k] < x.lo[k]) return false;
        }
        return true;
    };

    std::size_t candidatePairs = 0;
    std::vector<std::uint32_t> cand;            // reused scratch (B indices)
    for (std::uint32_t ai = 0; ai < trisA.size(); ++ai) {
        const SoupTri& ta = trisA[ai];
        cand.clear();
        const std::int64_t i0 = grid.coord(ta.lo[0], 0), i1 = grid.coord(ta.hi[0], 0);
        const std::int64_t j0 = grid.coord(ta.lo[1], 1), j1 = grid.coord(ta.hi[1], 1);
        const std::int64_t k0 = grid.coord(ta.lo[2], 2), k1 = grid.coord(ta.hi[2], 2);
        for (std::int64_t i = i0; i <= i1; ++i)
            for (std::int64_t j = j0; j <= j1; ++j)
                for (std::int64_t k = k0; k <= k1; ++k) {
                    auto it = grid.buckets.find(Grid::key(i, j, k));
                    if (it == grid.buckets.end()) continue;
                    for (std::uint32_t bi : it->second) cand.push_back(bi);
                }
        if (cand.empty()) continue;
        std::sort(cand.begin(), cand.end());
        cand.erase(std::unique(cand.begin(), cand.end()), cand.end());

        for (std::uint32_t bi : cand) {
            const SoupTri& tb = trisB[bi];
            if (!boxOverlapTri(ta, tb)) continue;   // cheap exact-box reject
            ++candidatePairs;
            mesh::TriTriResult r = mesh::triTriIntersect(ta.a, ta.b, ta.c,
                                                         tb.a, tb.b, tb.c);
            if (r.degenerate) continue;             // malformed pair: never claim
            if (r.relation == mesh::TriTriRelation::DISJOINT) continue;
            if (r.relation == mesh::TriTriRelation::POINT_TOUCH) continue; // p==q
            if (r.relation == mesh::TriTriRelation::COPLANAR_OVERLAP &&
                !opts.includeCoplanar) continue;
            // PROPER_CROSS / EDGE_TOUCH / (optionally) COPLANAR_OVERLAP: a segment.
            if (vdist2(r.p, r.q) == 0.0) continue;  // guard zero-length
            if (!finite3(r.p) || !finite3(r.q)) continue;
            IntersectionSegment s;
            s.p = r.p; s.q = r.q; s.triA = ai; s.triB = bi;
            res.segments.push_back(s);
        }
    }
    res.candidatePairs = candidatePairs;

    if (res.segments.empty()) {
        // Bounds overlapped but nothing actually crosses: a valid empty answer.
        return res;
    }

    // ---- (4) weld endpoints into graph nodes ------------------------------
    // Snap-round each endpoint to a grid of size weldTol and look the bucket up;
    // within the (and the 26 neighbouring) buckets, fuse to the first node within
    // weldTol. This makes welding order-independent for well-separated curves.
    const double wt = res.weldTol > 0.0 ? res.weldTol : 1e-12;
    const double wt2 = wt * wt;

    struct NodePt { mesh::Vec3 p; };
    std::vector<NodePt> nodes;
    std::unordered_map<std::uint64_t, std::vector<std::uint32_t>> nodeGrid;

    auto cellOf = [&](double v, int axis) -> std::int64_t {
        double o = (axis == 0 ? both.minx : (axis == 1 ? both.miny : both.minz));
        return static_cast<std::int64_t>(std::floor((v - o) / wt));
    };
    auto findOrAdd = [&](const mesh::Vec3& p) -> std::uint32_t {
        const std::int64_t ci = cellOf(p.x, 0);
        const std::int64_t cj = cellOf(p.y, 1);
        const std::int64_t ck = cellOf(p.z, 2);
        for (std::int64_t di = -1; di <= 1; ++di)
            for (std::int64_t dj = -1; dj <= 1; ++dj)
                for (std::int64_t dk = -1; dk <= 1; ++dk) {
                    auto it = nodeGrid.find(Grid::key(ci + di, cj + dj, ck + dk));
                    if (it == nodeGrid.end()) continue;
                    for (std::uint32_t nid : it->second) {
                        if (vdist2(nodes[nid].p, p) <= wt2) return nid;
                    }
                }
        const std::uint32_t nid = static_cast<std::uint32_t>(nodes.size());
        nodes.push_back({p});
        nodeGrid[Grid::key(ci, cj, ck)].push_back(nid);
        return nid;
    };

    // Build undirected edges (deduplicated) between welded nodes.
    struct Edge { std::uint32_t u, v; };
    std::vector<Edge> edges;
    std::set<std::pair<std::uint32_t, std::uint32_t>> seen;
    for (const IntersectionSegment& s : res.segments) {
        const std::uint32_t u = findOrAdd(s.p);
        const std::uint32_t v = findOrAdd(s.q);
        if (u == v) continue;                      // collapsed to a point: skip
        std::pair<std::uint32_t, std::uint32_t> k = (u < v) ? std::make_pair(u, v)
                                                            : std::make_pair(v, u);
        if (seen.insert(k).second) edges.push_back({u, v});
    }

    // ---- (5) trace polylines ----------------------------------------------
    // Adjacency list. A clean intersection curve is a union of paths/cycles where
    // interior nodes have degree 2. We trace: start every OPEN chain at a node of
    // odd/!=2 degree, walking until a dead end; then trace remaining pure cycles.
    const std::size_t N = nodes.size();
    std::vector<std::vector<std::uint32_t>> adj(N);   // adj[u] = list of EDGE ids
    for (std::uint32_t e = 0; e < edges.size(); ++e) {
        adj[edges[e].u].push_back(e);
        adj[edges[e].v].push_back(e);
    }
    std::vector<char> usedEdge(edges.size(), 0);

    auto otherEnd = [&](std::uint32_t e, std::uint32_t from) {
        return edges[e].u == from ? edges[e].v : edges[e].u;
    };
    auto nextUnused = [&](std::uint32_t node) -> std::int64_t {
        for (std::uint32_t e : adj[node]) if (!usedEdge[e]) return static_cast<std::int64_t>(e);
        return -1;
    };

    auto walk = [&](std::uint32_t start) {
        Polyline pl;
        pl.points.push_back(nodes[start].p);
        std::uint32_t cur = start;
        for (;;) {
            const std::int64_t e = nextUnused(cur);
            if (e < 0) break;
            usedEdge[static_cast<std::size_t>(e)] = 1;
            const std::uint32_t nxt = otherEnd(static_cast<std::uint32_t>(e), cur);
            if (nxt == start) {                    // closed back onto the seed
                pl.closed = true;
                break;
            }
            pl.points.push_back(nodes[nxt].p);
            cur = nxt;
        }
        return pl;
    };

    // (a) open chains: seed at endpoints (degree != 2, i.e. dangling/branch ends).
    for (std::uint32_t n = 0; n < N; ++n) {
        if (adj[n].size() == 2) continue;          // interior of a chain/loop
        while (nextUnused(n) >= 0) {
            Polyline pl = walk(n);
            if (pl.points.size() >= 2) {
                if (pl.closed) ++res.numClosedLoops; else ++res.numOpenChains;
                res.polylines.push_back(std::move(pl));
            }
        }
    }
    // (b) remaining pure cycles: every still-unused edge belongs to a degree-2 loop.
    for (std::uint32_t n = 0; n < N; ++n) {
        while (nextUnused(n) >= 0) {
            Polyline pl = walk(n);
            if (pl.points.size() >= 2) {
                // A standalone degree-2 traversal that returns to its seed is closed.
                if (!pl.closed) {
                    // Defensive: if a cycle was entered mid-edge it should still
                    // close; only mark closed when the last point links to the
                    // first within weldTol.
                    pl.closed = vdist2(pl.points.front(), pl.points.back()) <= wt2
                                && pl.points.size() >= 3;
                }
                if (pl.closed) ++res.numClosedLoops; else ++res.numOpenChains;
                res.polylines.push_back(std::move(pl));
            }
        }
    }

    return res;
}

} // namespace geom
} // namespace native
} // namespace forge
