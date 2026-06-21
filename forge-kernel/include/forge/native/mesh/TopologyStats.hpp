// forge/native/mesh/TopologyStats.hpp
//
// In-house mesh TOPOLOGY analysis for the Forge native kernel — pure C++20,
// ZERO external dependencies (no OCCT, no WASM, no third-party libs; standard
// library plus the existing forge/native headers only).
//
// WHAT THIS MODULE COMPUTES (honest — Bible §0/§9):
//   Given an indexed triangle soup (the same representation HalfEdgeMesh consumes
//   via buildFromSoup), this module reports the combinatorial topology of the
//   surface as a 2-complex:
//
//     * V / E / F      — referenced-vertex count, distinct undirected-edge count,
//                        triangle count.
//     * components     — connected components (vertices joined through a shared
//                        triangle; union-find).
//     * boundaryLoops  — number of closed loops formed by the boundary edges
//                        (edges incident to exactly ONE triangle).
//     * eulerChar chi  — V - E + F.
//     * genus          — for a CLOSED, ORIENTABLE, MANIFOLD surface, the genus
//                        summed over components: per component g = (2 - chi_c)/2.
//                        Reported ONLY when those preconditions hold; otherwise
//                        `genusKnown == false` and `genus == 0` (NO fabricated
//                        genus on open / non-manifold / non-orientable input).
//     * isClosed       — every undirected edge has exactly two incident triangles
//                        (no boundary edges) AND no edge has more than two.
//     * isManifold     — every undirected edge is incident to 1 or 2 triangles
//                        (so a boundary edge is allowed) AND every vertex link is
//                        a single fan/cycle (no two triangles meeting only at a
//                        pinch vertex). An edge shared by 3+ triangles, or a
//                        bow-tie vertex, makes it NON-manifold.
//     * isOrientable   — a consistent global orientation exists: walking adjacent
//                        triangles across shared (2-incident) edges never forces a
//                        flip. Decided only when the edge structure is manifold;
//                        on a non-manifold edge structure orientability is
//                        undefined and reported as false with `orientKnown=false`.
//
// HONESTY / 0-FAKES POSTURE (Bible §0):
//   This module NEVER repairs or guesses. Degenerate input (mismatched array
//   lengths, an out-of-range index, or a triangle with a repeated index) sets
//   `ok = false` and leaves the stats zeroed. Genus is emitted only when its
//   mathematical precondition (closed + orientable + manifold) is met; otherwise
//   `genusKnown == false`. Non-manifold / non-orientable inputs are flagged
//   honestly rather than coerced into a closed-surface formula.
//
//   Unlike HalfEdgeMesh::buildFromSoup (which REJECTS non-manifold / bad-winding
//   soups outright by returning false), TopologyStats analyses the raw soup
//   directly, so it can and does honestly report on open, non-manifold and
//   non-orientable inputs that the half-edge builder refuses to construct.
//
// RELATIONSHIP TO HalfEdgeMesh:
//   For inputs the half-edge builder accepts (manifold, consistently wound),
//   analyze(mesh) below derives the identical V/E/F/chi as
//   HalfEdgeMesh::validate(); this module adds components, boundary loops, genus,
//   and the orientability decision on top, and additionally handles the soups the
//   builder rejects.
//
// CONVENTIONS: unique symbols in namespace forge::native::mesh. Pure C++20,
// standard library only.

#ifndef FORGE_NATIVE_MESH_TOPOLOGYSTATS_HPP
#define FORGE_NATIVE_MESH_TOPOLOGYSTATS_HPP

#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

// Result of a topology audit. All counts refer to the surface as a 2-complex
// built from the input triangle soup (referenced vertices only).
struct TopologyReport {
    bool ok = false;             // false on degenerate input (see header notes)

    std::uint32_t numVertices = 0;   // distinct vertices referenced by any face
    std::uint32_t numEdges    = 0;   // distinct undirected edges
    std::uint32_t numFaces    = 0;   // triangles
    std::uint32_t components  = 0;   // connected components (face-connected)
    std::uint32_t boundaryLoops = 0; // closed loops of boundary (1-incident) edges

    int  eulerChar = 0;          // chi = V - E + F

    bool isClosed     = false;   // watertight: every edge has exactly 2 faces
    bool isManifold   = false;   // every edge has 1 or 2 faces; vertex links are fans
    bool isOrientable = false;   // a consistent global orientation exists
    bool orientKnown  = false;   // orientability was decidable (edge-manifold)

    bool genusKnown = false;     // genus is meaningful (closed+orientable+manifold)
    int  genus      = 0;         // total genus summed over components (>=0); 0 if !genusKnown

    // Diagnostic counts (honest detail; 0 on a clean closed manifold).
    std::uint32_t nonManifoldEdges = 0;   // edges incident to 3+ faces
    std::uint32_t boundaryEdges    = 0;   // edges incident to exactly 1 face
    std::uint32_t nonManifoldVertices = 0; // pinch (bow-tie) vertices
};

// Analyse an indexed triangle soup directly.
//   positions : flat xyz triples, length must be a multiple of 3.
//   indices   : flat triangle indices, length must be a multiple of 3.
// Vertex POSITIONS are not used by the combinatorial analysis (topology is
// purely connectivity); positions are accepted for signature parity with the
// rest of the mesh class and to validate index ranges. Returns ok=false on any
// degenerate input (see header). Unique symbol in this namespace.
TopologyReport analyzeTopology(const std::vector<double>& positions,
                               const std::vector<std::uint32_t>& indices);

// Convenience overload: analyse a built HalfEdgeMesh by exporting its soup.
// (HalfEdgeMesh only ever holds manifold, consistently-wound geometry, so this
// path always sees a valid soup; the heavy lifting is the soup overload above.)
TopologyReport analyzeTopology(const HalfEdgeMesh& mesh);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_TOPOLOGYSTATS_HPP
