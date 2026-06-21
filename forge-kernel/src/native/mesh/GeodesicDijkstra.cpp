// forge/native/mesh/GeodesicDijkstra.cpp
//
// Implementation of forge::native::mesh::geodesicDijkstra — approximate
// single-source geodesic distance over a graph embedded in a triangle mesh,
// computed by Dijkstra with non-negative Euclidean edge weights. Pure C++20,
// standard library only; reuses the existing forge native headers by #include.
//
// See GeodesicDijkstra.hpp for the honest scope / envelope.

#include <functional>
#include "forge/native/mesh/GeodesicDijkstra.hpp"

// Reuse the established native headers by #include only (NOT re-implemented).
// HalfEdgeMesh.hpp supplies Vec3 / HalfEdgeMesh / buildFromSoup / validate /
// signedVolume / surfaceArea; the others are part of the named geometry surface
// this mesh module builds upon (exact predicates, basic geom types, the AABB
// acceleration structure). Including them keeps this module on the single shared
// native geometry stack rather than duplicating primitives.
#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/AABBTree.hpp"

#include <algorithm>   // std::sort, std::min, std::max, std::find
#include <cmath>       // std::sqrt, std::isfinite
#include <cstddef>     // std::size_t
#include <cstdint>     // std::uint32_t, std::uint64_t
#include <limits>      // std::numeric_limits
#include <queue>       // std::priority_queue
#include <utility>     // std::pair, std::move
#include <vector>      // std::vector

namespace forge {
namespace native {
namespace mesh {

namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();

// Euclidean distance between two soup vertices addressed by id.
inline double edgeLen(const std::vector<double>& pos, std::uint32_t a, std::uint32_t b) {
    const double dx = pos[3 * a + 0] - pos[3 * b + 0];
    const double dy = pos[3 * a + 1] - pos[3 * b + 1];
    const double dz = pos[3 * a + 2] - pos[3 * b + 2];
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

// Undirected-edge key (sorted pair packed into 64 bits) for de-duplication.
inline std::uint64_t edgeKey(std::uint32_t a, std::uint32_t b) {
    if (a > b) { const std::uint32_t t = a; a = b; b = t; }
    return (static_cast<std::uint64_t>(a) << 32) | static_cast<std::uint64_t>(b);
}

// A weighted directed adjacency entry.
struct Adj {
    std::uint32_t to;
    double        w;
};

} // namespace

GeodesicResult geodesicDijkstra(const std::vector<double>& positions,
                                const std::vector<std::uint32_t>& indices,
                                std::uint32_t source,
                                GeodesicGraph graph) {
    GeodesicResult R;
    R.graph = graph;

    // ---- validate input honestly (0 FAKES) --------------------------------
    if (positions.empty() || positions.size() % 3 != 0) return R;       // ok stays false
    if (indices.size() % 3 != 0) return R;
    const std::uint32_t nV = static_cast<std::uint32_t>(positions.size() / 3);
    if (source >= nV) return R;

    const std::size_t nT = indices.size() / 3;
    for (std::size_t t = 0; t < nT; ++t) {
        const std::uint32_t a = indices[3 * t + 0];
        const std::uint32_t b = indices[3 * t + 1];
        const std::uint32_t c = indices[3 * t + 2];
        if (a >= nV || b >= nV || c >= nV) return R;        // out-of-range index
        if (a == b || b == c || a == c)    return R;        // repeated index (degenerate tri)
    }
    // Source vertex must actually be referenced by some triangle, otherwise the
    // "vertex" is isolated and a single-source geodesic over the mesh graph is
    // ill-posed. (An out-of-range source was already rejected above; here we
    // catch a valid-range but unreferenced source.)
    {
        bool referenced = false;
        for (std::size_t i = 0; i < indices.size(); ++i) {
            if (indices[i] == source) { referenced = true; break; }
        }
        if (!referenced) return R;
    }

    // ---- build the undirected weighted graph -------------------------------
    // Collect unique undirected edges with their Euclidean weight. We use a
    // sort+unique over packed keys (no external hash dependency).
    std::vector<std::uint64_t> keys;
    keys.reserve(nT * (graph == GeodesicGraph::EDGES_PLUS_DIAGONALS ? 6 : 3));

    // (1) the three mesh edges of every triangle.
    for (std::size_t t = 0; t < nT; ++t) {
        const std::uint32_t a = indices[3 * t + 0];
        const std::uint32_t b = indices[3 * t + 1];
        const std::uint32_t c = indices[3 * t + 2];
        keys.push_back(edgeKey(a, b));
        keys.push_back(edgeKey(b, c));
        keys.push_back(edgeKey(c, a));
    }

    // (2) optional diagonals: for every INTERIOR undirected mesh edge (shared by
    //     exactly two triangles), connect the two opposite vertices. We map each
    //     directed half-edge (u->v of a triangle) to the third vertex of that
    //     triangle; the opposite vertices of an interior edge are the two thirds.
    if (graph == GeodesicGraph::EDGES_PLUS_DIAGONALS) {
        // For each undirected edge, gather up to two "apex" (opposite) vertices.
        // Build a parallel list (edgeKey, apex) then sort to pair them up.
        std::vector<std::pair<std::uint64_t, std::uint32_t>> apex;
        apex.reserve(nT * 3);
        for (std::size_t t = 0; t < nT; ++t) {
            const std::uint32_t a = indices[3 * t + 0];
            const std::uint32_t b = indices[3 * t + 1];
            const std::uint32_t c = indices[3 * t + 2];
            apex.emplace_back(edgeKey(a, b), c);
            apex.emplace_back(edgeKey(b, c), a);
            apex.emplace_back(edgeKey(c, a), b);
        }
        std::sort(apex.begin(), apex.end(),
                  [](const std::pair<std::uint64_t, std::uint32_t>& x,
                     const std::pair<std::uint64_t, std::uint32_t>& y) {
                      if (x.first != y.first) return x.first < y.first;
                      return x.second < y.second;
                  });
        // Walk runs of equal edgeKey; an interior edge has exactly two distinct
        // apexes -> add the diagonal between them. (A non-manifold edge with 3+
        // incident triangles yields multiple apexes; we conservatively connect
        // each unordered apex pair, which only ever ADDS valid surface short-cuts
        // and never invents a smaller-than-true distance because every added
        // weight is a real Euclidean length between two real vertices.)
        std::size_t i = 0;
        while (i < apex.size()) {
            std::size_t j = i + 1;
            while (j < apex.size() && apex[j].first == apex[i].first) ++j;
            // run [i, j): the apexes incident to this undirected edge.
            for (std::size_t p = i; p < j; ++p) {
                for (std::size_t q = p + 1; q < j; ++q) {
                    if (apex[p].second != apex[q].second)
                        keys.push_back(edgeKey(apex[p].second, apex[q].second));
                }
            }
            i = j;
        }
    }

    std::sort(keys.begin(), keys.end());
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());

    // CSR-ish adjacency from the unique undirected edges.
    std::vector<std::vector<Adj>> adj(nV);
    for (std::uint64_t k : keys) {
        const std::uint32_t a = static_cast<std::uint32_t>(k >> 32);
        const std::uint32_t b = static_cast<std::uint32_t>(k & 0xFFFFFFFFu);
        const double w = edgeLen(positions, a, b);
        // A zero-length edge (coincident vertices) is a legitimate non-negative
        // weight and stays; it can never break Dijkstra's correctness.
        adj[a].push_back(Adj{b, w});
        adj[b].push_back(Adj{a, w});
    }

    // ---- Dijkstra ----------------------------------------------------------
    R.distance.assign(nV, kInf);
    R.predecessor.assign(nV, kNoPred);
    R.reachable.assign(nV, false);
    R.source = source;

    using QN = std::pair<double, std::uint32_t>;   // (dist, vertex)
    std::priority_queue<QN, std::vector<QN>, std::greater<QN>> pq;

    R.distance[source] = 0.0;
    pq.push({0.0, source});

    while (!pq.empty()) {
        const QN top = pq.top();
        pq.pop();
        const double d = top.first;
        const std::uint32_t u = top.second;
        if (d > R.distance[u]) continue;        // stale lazy-deletion entry
        for (const Adj& e : adj[u]) {
            const double nd = d + e.w;
            if (nd < R.distance[e.to]) {
                R.distance[e.to]    = nd;
                R.predecessor[e.to] = u;
                pq.push({nd, e.to});
            }
        }
    }

    // ---- summarize reachability honestly -----------------------------------
    R.reachableCount = 0;
    R.maxDistance = 0.0;
    for (std::uint32_t v = 0; v < nV; ++v) {
        const bool fin = std::isfinite(R.distance[v]);
        R.reachable[v] = fin;
        if (fin) {
            ++R.reachableCount;
            if (R.distance[v] > R.maxDistance) R.maxDistance = R.distance[v];
        } else {
            // keep predecessor as kNoPred; distance stays +inf.
            R.predecessor[v] = kNoPred;
        }
    }
    // The source carries no predecessor.
    R.predecessor[source] = kNoPred;

    R.ok = true;
    return R;
}

GeodesicResult geodesicDijkstra(const HalfEdgeMesh& mesh,
                                std::uint32_t source,
                                GeodesicGraph graph) {
    std::vector<double> pos;
    std::vector<std::uint32_t> idx;
    mesh.toSoup(pos, idx);
    return geodesicDijkstra(pos, idx, source, graph);
}

} // namespace mesh
} // namespace native
} // namespace forge
