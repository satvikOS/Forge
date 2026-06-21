// forge/native/mesh/SelfIntersect.hpp
//
// Mesh self-intersection detection for the in-house Forge native kernel —
// Stage 2 mesh-repair / validity tooling (KERNEL_INHOUSE_ROADMAP.md). Pure
// C++20, ZERO external dependencies, no OCCT, no WASM, no third-party libs.
//
// WHAT THIS INCREMENT SHIPS (REAL + VALIDATED — Bible §0/§9)
// ---------------------------------------------------------
//   Given an indexed triangle soup (positions + triangle indices), report every
//   pair of triangles (i, j) that actually INTERSECT each other in a way that is
//   NOT the legitimate shared geometry of an adjacent pair. Two triangles that
//   share a vertex (by index OR by coincident position, i.e. a welded vertex)
//   are ADJACENT: an edge-fan / vertex-fan meeting along a shared edge or vertex
//   is the normal, correct way a watertight surface is stitched together, so
//   those pairs are skipped — counting them would flag every conforming mesh as
//   "self-intersecting". Every NON-adjacent pair is tested with the exact
//   triangle–triangle primitive forge::native::mesh::triTriIntersect: a pair is
//   recorded as a self-intersection iff the triangles genuinely meet (any
//   non-DISJOINT, non-degenerate relation — proper crossing, coplanar overlap,
//   edge/point touch between triangles that do NOT share geometry).
//
//   The combinatorial decision of WHETHER two triangles meet is exact: it is the
//   sign pattern of orient3d / orient2d inside triTriIntersect (see that header).
//   So the BOOLEAN "is this pair a self-intersection?" can never flip because a
//   determinant rounded the wrong way near coplanarity. The returned report is
//   therefore reproducible and matches a brute-force O(n^2) reference EXACTLY —
//   the uniform spatial grid below is a pure acceleration structure that changes
//   only WHICH pairs are tested, never the verdict on a tested pair.
//
// PERFORMANCE
//   A naive all-pairs scan is O(n^2) in the triangle count. To stay usable on
//   real meshes we bin each triangle's axis-aligned bounding box into a uniform
//   3-D grid sized to the mesh's average triangle extent; only triangles that
//   co-occupy at least one grid cell are ever paired (with de-duplication so a
//   pair sharing several cells is tested once). The grid reproduces the
//   brute-force result exactly — it is validated against it in the gate.
//
// ROBUSTNESS LEVEL (stated up front — do NOT overclaim):
//   robust-in-practice with an EXACT combinatorial core, identical to the rest
//   of Stage 2. The per-pair verdict is exact (orient3d/orient2d signs inside
//   triTriIntersect); the spatial-grid bucketing uses ordinary double AABBs but
//   is conservative (a true intersection's triangles always share a cell), so it
//   never drops a real crossing. This is NOT a proven-exact arrangement; it is a
//   detector. Repairing the detected crossings (re-triangulating the surface to
//   remove them) is the general mesh-boolean arrangement and remains TARGETED.
//
// 0 FAKES (Bible §0/§9): on malformed input (positions length not a multiple of
//   3, indices length not a multiple of 3, an index out of range, or a degenerate
//   zero-area triangle index triple) the routine returns ok=false and an empty
//   report rather than fabricating a clean verdict.
//
// No external dependencies. No WASM. Pure C++20.

#ifndef FORGE_NATIVE_MESH_SELFINTERSECT_HPP
#define FORGE_NATIVE_MESH_SELFINTERSECT_HPP

#include <cstdint>
#include <vector>
#include <utility>

#include "forge/native/mesh/HalfEdgeMesh.hpp"  // reuse Vec3 (no re-declaration)

namespace forge {
namespace native {
namespace mesh {

// One detected self-intersection: triangle indices i < j into the input soup,
// plus the exact relation triTriIntersect classified them with (so callers can
// distinguish a hard PROPER_CROSS from an edge/point touch of non-adjacent
// faces). `i` and `j` index TRIANGLES (face number), not vertices.
struct SelfIntersection {
    std::uint32_t i = 0;   // first triangle (i < j)
    std::uint32_t j = 0;   // second triangle
    int relation = 0;      // forge::native::mesh::TriTriRelation value (as int)
};

// Result of a self-intersection scan.
//   ok        : false ONLY on malformed input (see header note); true otherwise.
//   isClean   : true iff `pairs` is empty (no self-intersecting pair found).
//   pairs     : every detected non-adjacent intersecting pair, i<j, sorted.
//   numTris   : triangle count actually scanned (for diagnostics).
//   gridCells : number of occupied uniform-grid cells (0 if the brute path ran).
struct SelfIntersectReport {
    bool ok = false;
    bool isClean = false;
    std::vector<SelfIntersection> pairs;
    std::uint32_t numTris = 0;
    std::uint32_t gridCells = 0;
};

// Detect all self-intersecting triangle pairs in an indexed triangle soup using
// the uniform spatial grid (the production path). `positions` is flat xyz
// triples (length == 3*numVertices); `indices` is flat triangle indices
// (length == 3*numTriangles). Pairs sharing a vertex (by index OR by coincident
// position within `weldTol`) are treated as adjacent and skipped.
//
//   weldTol : two vertices closer than this (Euclidean) are considered the same
//             welded point for the ADJACENCY (skip) test. Default 0 means
//             index-identity only PLUS exact coordinate equality. A positive tol
//             additionally treats near-coincident vertices as welded.
SelfIntersectReport detectSelfIntersections(const std::vector<double>& positions,
                                            const std::vector<std::uint32_t>& indices,
                                            double weldTol = 0.0);

// Brute-force O(n^2) reference: tests EVERY non-adjacent pair with no spatial
// acceleration. Identical verdict logic to detectSelfIntersections; exists so
// the gate can prove the grid path returns the EXACT same pair set. Same input
// contract and ok/isClean semantics.
SelfIntersectReport detectSelfIntersectionsBruteForce(const std::vector<double>& positions,
                                                      const std::vector<std::uint32_t>& indices,
                                                      double weldTol = 0.0);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_SELFINTERSECT_HPP
