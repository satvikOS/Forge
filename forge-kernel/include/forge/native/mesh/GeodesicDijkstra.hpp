// forge/native/mesh/GeodesicDijkstra.hpp
//
// In-house APPROXIMATE single-source geodesic distance on a triangle mesh for
// the Forge native kernel — pure C++20, ZERO external dependencies (no OCCT, no
// WASM, no third-party libs; standard library plus the existing forge/native
// headers only).
//
// WHAT THIS MODULE COMPUTES (honest — Bible §0/§9):
//   Given an indexed triangle soup (the same representation HalfEdgeMesh and
//   TopologyStats consume) and a source VERTEX, this module computes the shortest
//   path length from the source to every other vertex measured along a GRAPH
//   embedded in the surface, using Dijkstra's algorithm with non-negative
//   Euclidean edge weights. Two graph modes are offered:
//
//     * EDGES        — the graph is exactly the mesh's undirected edges. The
//                      resulting distance is the classic "Dijkstra-on-edges"
//                      surface metric: an UPPER BOUND on the true geodesic
//                      distance, exact when a shortest surface path happens to
//                      run along mesh edges (e.g. an axis-aligned monotone path
//                      on a regular grid).
//
//     * EDGES_PLUS_DIAGONALS — additionally adds, for every triangle, the
//                      "short-cut" graph edges between its three vertices that
//                      are already mesh edges (always present) PLUS, for any
//                      INTERIOR mesh edge shared by two triangles, the diagonal
//                      connecting the two opposite vertices of that quad. This
//                      densifies the graph so the path can cut across a quad
//                      rather than only tracing its boundary, giving a TIGHTER
//                      (never larger) upper bound on the true geodesic distance.
//                      It is still an over-estimate in general — this is an
//                      APPROXIMATION, not exact polyhedral geodesic (MMP/CH).
//
//   The result is a per-vertex distance array (one entry per referenced vertex)
//   plus a predecessor array describing the shortest-path TREE rooted at the
//   source, and the source's own component.
//
// HONESTY / 0-FAKES POSTURE (Bible §0):
//   * Distances to vertices in a DIFFERENT connected component than the source
//     are reported as +infinity and flagged unreachable — NEVER a fabricated
//     finite value.
//   * Degenerate input (array length not a multiple of 3, an out-of-range index,
//     a triangle with a repeated vertex index, or a source index out of range)
//     sets `ok = false` and leaves the arrays empty. Nothing is repaired or
//     guessed.
//   * This is an APPROXIMATE geodesic (graph upper bound), explicitly NOT exact
//     polyhedral geodesic distance. The header says so; the test asserts the
//     over-estimate stays within the provable bound rather than pretending the
//     graph metric equals the Euclidean/geodesic distance.
//
// RELATIONSHIP TO THE REST OF THE KERNEL:
//   Connectivity is derived directly from the soup (independent of, but
//   consistent with, TopologyStats components). Edge weights are Euclidean
//   lengths from the vertex positions (mesh::Vec3). The module deliberately does
//   NOT re-implement primitives that already exist elsewhere — it includes the
//   established forge native headers rather than duplicating them.
//
// CONVENTIONS: unique symbols in namespace forge::native::mesh. Pure C++20,
// standard library only.

#ifndef FORGE_NATIVE_MESH_GEODESICDIJKSTRA_HPP
#define FORGE_NATIVE_MESH_GEODESICDIJKSTRA_HPP

#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

// Sentinel for "no predecessor" in the shortest-path tree (the source itself,
// and every unreachable vertex, carries this value).
inline constexpr std::uint32_t kNoPred = 0xFFFFFFFFu;

// Which graph the Dijkstra runs over (see header notes).
enum class GeodesicGraph {
    EDGES,                 // mesh edges only (looser upper bound)
    EDGES_PLUS_DIAGONALS   // + per-interior-edge opposite-vertex diagonals (tighter)
};

// Result of a single-source approximate-geodesic query.
//
// `distance`, `predecessor` and `reachable` are all indexed by VERTEX id in the
// same space as the input positions (i.e. position k is at indices 3k..3k+2).
// On success they have length == numVertices = positions.size()/3.
struct GeodesicResult {
    bool ok = false;                       // false on degenerate input

    std::uint32_t source = kInvalid;       // the source vertex id (echoed back)
    GeodesicGraph graph = GeodesicGraph::EDGES;

    std::vector<double>        distance;    // graph distance from source; +inf if unreachable
    std::vector<std::uint32_t> predecessor; // parent in the shortest-path tree; kNoPred if none
    std::vector<bool>          reachable;   // true iff a finite path exists from the source

    // Diagnostics (honest detail).
    std::uint32_t reachableCount = 0;       // number of vertices with a finite distance
    double        maxDistance    = 0.0;     // farthest reachable distance (0 if only source)
};

// Compute single-source approximate geodesic distances over the chosen graph.
//   positions : flat xyz triples, length must be a multiple of 3.
//   indices   : flat triangle indices, length must be a multiple of 3; every
//               index < positions.size()/3 and no triangle may repeat an index.
//   source    : the source vertex id; must be < positions.size()/3.
// Returns ok=false (arrays empty) on any degenerate input. Unique symbol.
GeodesicResult geodesicDijkstra(const std::vector<double>& positions,
                                const std::vector<std::uint32_t>& indices,
                                std::uint32_t source,
                                GeodesicGraph graph = GeodesicGraph::EDGES);

// Convenience overload: run over a built HalfEdgeMesh by exporting its soup.
GeodesicResult geodesicDijkstra(const HalfEdgeMesh& mesh,
                                std::uint32_t source,
                                GeodesicGraph graph = GeodesicGraph::EDGES);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_GEODESICDIJKSTRA_HPP
