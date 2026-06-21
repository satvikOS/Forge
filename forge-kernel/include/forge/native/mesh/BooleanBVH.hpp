// forge/native/mesh/BooleanBVH.hpp
//
// BVH-accelerated candidate-pair finding for two-mesh triangle–triangle
// intersection — forge::native::mesh::BooleanBVH. Pure C++20, ZERO external
// dependencies, no OCCT, no WASM, no third-party libs. Builds ONLY on the
// existing forge native headers (by #include, never re-deriving them):
//   * forge/native/Predicates.hpp        (the exact orient3d core, transitively
//                                          used by triTriIntersect)
//   * forge/native/geom/Geom.hpp         (Point3 / geom utilities)
//   * forge/native/geom/Delaunay3D.hpp   (Stage-2 geometry sibling)
//   * forge/native/geom/AABBTree.hpp     (the geom::Aabb axis-aligned box type +
//                                          its expand / valid / longestAxis
//                                          helpers — REUSED here, not redefined)
//   * forge/native/mesh/HalfEdgeMesh.hpp (Vec3 — the triangle-soup vertex type)
//   * forge/native/mesh/TriTriIntersect.hpp (the EXACT per-pair primitive)
//   * forge/native/implicit/SdfTree.hpp + implicit/IsoMesher.hpp (implicit
//                                          siblings; included for the unified
//                                          Stage-2 surface the roadmap names)
//
// WHAT THIS INCREMENT SHIPS (REAL + VALIDATED — Bible §0/§9)
// ---------------------------------------------------------
//   This is a PERFORMANCE LAYER, *not* a new boolean engine. Given two indexed
//   triangle soups A and B, it finds — far faster than the O(n*m) all-pairs scan
//   — every triangle pair (i in A, j in B) that genuinely intersects, returning
//   the same intersecting-pair set (and the same exact relation + intersection
//   segment) the brute-force scan would.
//
//   It does this by building a bounding-volume hierarchy over B's triangle AABBs
//   (using the SAME geom::Aabb box type the kernel's geom/AABBTree exposes) and,
//   for each triangle of A, descending that hierarchy to enumerate ONLY the B
//   triangles whose AABB overlaps A's triangle AABB. Those — and only those —
//   candidate pairs are then handed to the EXACT primitive
//   forge::native::mesh::triTriIntersect. Because a true triangle intersection
//   ALWAYS has overlapping AABBs, the BVH never drops a real intersection: the
//   pair set it returns is bit-for-bit identical to the brute force (validated
//   over >=25 random mesh pairs including disjoint and deeply-overlapping cases,
//   with a printed std::random_device seed). The BVH changes only WHICH pairs are
//   tested with the exact primitive, never the verdict on a tested pair.
//
// PERFORMANCE
//   The reported `pairsTested` (exact tri-tri tests actually run) versus
//   `pairsBrute` ( = n*m ) is the measured speedup. The candidate enumeration is
//   O((n+m) log m) in practice via hierarchical AABB pruning.
//
// ROBUSTNESS LEVEL (stated up front — do NOT overclaim):
//   robust-in-practice with an EXACT combinatorial core, identical to the rest
//   of Stage 2. The per-pair verdict is exact (orient3d/orient2d signs inside
//   triTriIntersect); the BVH uses ordinary double AABBs but is CONSERVATIVE (a
//   true intersection's triangles always share overlapping boxes), so it never
//   drops a real crossing. This is NOT a proven-exact arrangement; it is a
//   candidate-pair accelerator + detector. Building the full A∪B / A∩B / A−B
//   arrangement from these pairs remains TARGETED.
//
// 0 FAKES (Bible §0/§9): on malformed input (positions length not a multiple of
//   3, indices length not a multiple of 3, an index out of range, a degenerate
//   zero-area triangle index triple, or a non-finite coordinate) the routine
//   returns ok=false and an empty report rather than fabricating a clean verdict.
//
// No external dependencies. No WASM. Pure C++20.

#ifndef FORGE_NATIVE_MESH_BOOLEANBVH_HPP
#define FORGE_NATIVE_MESH_BOOLEANBVH_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"     // Vec3
#include "forge/native/mesh/TriTriIntersect.hpp"  // TriTriRelation, TriTriResult
#include "forge/native/geom/AABBTree.hpp"          // geom::Aabb (REUSED box type)

namespace forge {
namespace native {
namespace mesh {

// One intersecting cross-mesh pair: triangle `triA` (index into A's triangles)
// meets triangle `triB` (index into B's triangles). `relation` is the exact
// TriTriRelation value (as int) classified by triTriIntersect; `p`,`q` are the
// intersection segment endpoints (p==q for a point touch; both unused for a
// DISJOINT pair, which is never recorded here).
struct CrossPair {
    std::uint32_t triA = 0;
    std::uint32_t triB = 0;
    int relation = 0;          // forge::native::mesh::TriTriRelation value (as int)
    Vec3 p{};
    Vec3 q{};
};

// Result of a BVH-accelerated cross-mesh intersection scan.
//   ok          : false ONLY on malformed input (see header note); true otherwise.
//   disjoint    : true iff `pairs` is empty (the two meshes do not intersect).
//   pairs       : every intersecting (triA, triB) pair, sorted by (triA, triB).
//   numTrisA    : triangle count of mesh A.
//   numTrisB    : triangle count of mesh B.
//   pairsBrute  : n*m  — the number of tri-tri tests a brute-force scan would run.
//   pairsTested : the number of tri-tri tests the BVH path actually ran (the
//                 candidate count); pairsBrute / pairsTested is the speedup.
struct CrossIntersectReport {
    bool ok = false;
    bool disjoint = false;
    std::vector<CrossPair> pairs;
    std::uint32_t numTrisA = 0;
    std::uint32_t numTrisB = 0;
    std::uint64_t pairsBrute  = 0;
    std::uint64_t pairsTested = 0;
};

// ---------------------------------------------------------------------------
// BooleanBVH — a static bounding-volume hierarchy over ONE mesh's triangle
// AABBs, supporting fast enumeration of the triangles whose box overlaps a
// query box. Used by the cross-mesh intersection routine below; exposed so a
// caller that intersects MANY meshes against one fixed mesh can build the
// hierarchy once.
//
// Lifetime: build() copies the triangle geometry it needs, so the caller's
// arrays need not outlive the hierarchy.
// ---------------------------------------------------------------------------
class BooleanBVH {
public:
    BooleanBVH() = default;

    // Build over an indexed triangle soup. Returns false (and leaves the
    // hierarchy EMPTY) on dishonest-to-accept input, with the SAME contract as
    // geom::AABBTree::build: positions/indices length not a multiple of 3, zero
    // triangles, an index out of range, a non-finite coordinate, or any
    // repeated-index / zero-area (degenerate) triangle.
    bool build(const std::vector<double>& positions,
               const std::vector<std::uint32_t>& indices);

    bool empty() const { return nodes_.empty(); }
    std::size_t triangleCount() const { return tris_.size(); }
    std::size_t nodeCount() const { return nodes_.size(); }
    geom::Aabb bounds() const;

    // Append the source-triangle indices of every stored triangle whose AABB
    // overlaps `query` to `out`. Conservative: never misses an overlapping box.
    // (Does not clear `out`.)
    void queryOverlaps(const geom::Aabb& query,
                       std::vector<std::uint32_t>& out) const;

private:
    struct Tri {
        Vec3 a, b, c;
        geom::Aabb box;
        Vec3 centroid;
        std::uint32_t srcIndex;   // triangle index in the caller's `indices`
    };
    struct Node {
        geom::Aabb box{};
        std::uint32_t start{0};
        std::uint32_t count{0};   // >0 => leaf
        std::uint32_t left{0};
        std::uint32_t right{0};
    };

    std::uint32_t buildRange(std::uint32_t first, std::uint32_t last);

    std::vector<Tri>           tris_;    // permuted into leaf-contiguous order
    std::vector<Node>          nodes_;   // node 0 is the root (if non-empty)
    std::vector<std::uint32_t> order_;   // working permutation during build
};

// ---------------------------------------------------------------------------
// crossIntersectBVH — BVH-accelerated cross-mesh intersection (PRODUCTION path).
//   Build a BooleanBVH over mesh B, then for each triangle of A enumerate only
//   the B triangles whose AABB overlaps, and classify those candidates with the
//   exact triTriIntersect. `pairs` records every non-DISJOINT, non-degenerate
//   pair, sorted by (triA, triB).
// ---------------------------------------------------------------------------
CrossIntersectReport crossIntersectBVH(const std::vector<double>& positionsA,
                                       const std::vector<std::uint32_t>& indicesA,
                                       const std::vector<double>& positionsB,
                                       const std::vector<std::uint32_t>& indicesB);

// ---------------------------------------------------------------------------
// crossIntersectBruteForce — O(n*m) reference: tests EVERY (i in A, j in B) pair
// with no spatial acceleration. IDENTICAL verdict logic to crossIntersectBVH;
// exists so the gate can prove the BVH path returns the EXACT same pair set.
// Same input contract and ok/disjoint semantics. `pairsTested == pairsBrute`.
// ---------------------------------------------------------------------------
CrossIntersectReport crossIntersectBruteForce(const std::vector<double>& positionsA,
                                              const std::vector<std::uint32_t>& indicesA,
                                              const std::vector<double>& positionsB,
                                              const std::vector<std::uint32_t>& indicesB);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_BOOLEANBVH_HPP
