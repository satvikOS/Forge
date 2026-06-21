// forge/native/geom/ConvexDecomposition.hpp
//
// In-house APPROXIMATE convex decomposition of a closed triangle mesh —
// forge::native::geom. Pure C++20, standard library only. NO OCCT, NO WASM,
// NO third-party libs. Builds ONLY on the existing forge native headers:
//   * forge/native/Predicates.hpp        (orient3d — exact side test)
//   * forge/native/geom/Geom.hpp          (Point3, convexHull3D)
//   * forge/native/geom/AABBTree.hpp      (BVH — not required for the core, but
//                                          part of the reusable geom toolbox)
//   * forge/native/mesh/HalfEdgeMesh.hpp  (Vec3, HalfEdgeMesh, buildFromSoup,
//                                          validate, signedVolume, surfaceArea)
//
// PURPOSE (V-HACD / ACD class — an APPROXIMATE convex decomposition):
//   Split a single closed solid into a SMALL set of near-convex sub-pieces, the
//   standard preprocessing step for collision / physics (each convex piece gets
//   an efficient GJK/EPA or separating-axis collision proxy). The decomposition
//   is concavity-driven and GREEDY: while the worst piece is more concave than
//   the tolerance, we cut it by a plane chosen to slice through its most-concave
//   region (the surface point farthest OUTSIDE its own convex hull), recursing
//   on the two halves.
//
// HONESTY POSTURE (Bible §0 — stated up front, do NOT overclaim):
//   This is a HEURISTIC, APPROXIMATE decomposition, exactly like every shipping
//   ACD (V-HACD, CoACD) — it is NOT an exact minimal convex partition (that
//   problem is NP-hard). What IS validated by the standalone gate:
//     * An already-CONVEX input (box, icosphere) is RECOGNISED as convex within
//       the concavity tolerance and returned as exactly ONE piece.
//     * A genuinely NON-CONVEX input (L-shape, two fused boxes) is split into
//       >= 2 pieces whose UNION VOLUME reproduces the original within a few %,
//       and every returned piece passes an independent convexity check.
//   The CUTTING uses HalfEdgeMesh::planeClip (which uses the exact orient3d
//   predicate for the combinatorial side decision), so each cut keeps the piece
//   closed. Concavity is measured geometrically (max surface deviation from the
//   piece's own convex hull, normalised by the piece's bounding radius).
//
//   ok == false (honestly) on degenerate / unsupported input:
//     * empty / malformed soup (sizes not multiples of 3, index out of range)
//     * an OPEN (non-watertight) or non-manifold mesh — concavity and volume are
//       undefined there, so we refuse rather than emit garbage
//     * a zero / non-finite-volume solid

#ifndef FORGE_NATIVE_GEOM_CONVEXDECOMPOSITION_HPP
#define FORGE_NATIVE_GEOM_CONVEXDECOMPOSITION_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"   // Vec3, HalfEdgeMesh

namespace forge {
namespace native {
namespace geom {

// ---------------------------------------------------------------------------
// One sub-piece of the decomposition.
//
// `positions` / `indices` are an indexed triangle soup (the same flat layout
// HalfEdgeMesh::buildFromSoup consumes). `volume` is its signed volume (always
// reported >= 0 here; sign is normalised). `concavity` is the NORMALISED max
// surface deviation from this piece's own convex hull (0 == perfectly convex);
// `convex` is true when concavity <= the run's tolerance.
// ---------------------------------------------------------------------------
struct ConvexPiece {
    std::vector<double>        positions;   // flat xyz triples
    std::vector<std::uint32_t> indices;     // flat triangle indices
    double                     volume{0.0};
    double                     concavity{0.0};
    bool                       convex{false};
};

// ---------------------------------------------------------------------------
// Tuning for the greedy decomposition. The defaults are sane for unit-ish
// solids; `concavityTol` is a FRACTION of the piece bounding radius.
// ---------------------------------------------------------------------------
struct DecompositionParams {
    // A piece is accepted as convex (no further cutting) when its normalised
    // concavity <= concavityTol. Larger => coarser decomposition (fewer pieces).
    double      concavityTol{0.02};
    // Hard cap so a pathological input can never spin forever. The greedy loop
    // also stops if a cut fails to reduce the worst concavity.
    std::size_t maxPieces{64};
    // Recursion guard on cut depth per branch.
    std::size_t maxDepth{24};
};

// ---------------------------------------------------------------------------
// Result of a decomposition run.
//
// `ok == false` (with `reason` set) on the degenerate / unsupported inputs
// listed in the header comment; `pieces` is then empty. On success `pieces`
// holds >= 1 near-convex piece, `totalVolume` is the summed piece volume, and
// `inputVolume` is |signedVolume| of the original — their ratio is the
// volume-preservation metric the gate asserts.
// ---------------------------------------------------------------------------
struct DecompositionResult {
    bool                      ok{false};
    const char*               reason{""};
    std::vector<ConvexPiece>  pieces;
    double                    inputVolume{0.0};   // |V| of the original solid
    double                    totalVolume{0.0};   // sum of piece volumes
    bool                      inputWasConvex{false};
};

// ---------------------------------------------------------------------------
// Independent convexity check of a closed mesh: the maximum NORMALISED distance
// of any mesh vertex OUTSIDE the mesh's own convex hull, divided by the mesh
// bounding radius. Returns 0 for a convex mesh. `ok==false` (concavity left 0)
// when the hull is degenerate (coplanar / < 4 distinct points) — the caller
// treats a degenerate hull as "cannot assess", never as "convex".
// ---------------------------------------------------------------------------
struct ConvexityReport {
    bool   ok{false};
    double concavity{0.0};   // normalised max-outside-hull distance (0 == convex)
};
ConvexityReport meshConcavity(const mesh::HalfEdgeMesh& m);

// ---------------------------------------------------------------------------
// The decomposition entry points.
//
// (a) raw triangle soup — builds + validates the HalfEdgeMesh internally.
// (b) an already-built HalfEdgeMesh.
// Both refuse open / non-manifold / zero-volume input via ok=false.
// ---------------------------------------------------------------------------
DecompositionResult convexDecompose(const std::vector<double>& positions,
                                    const std::vector<std::uint32_t>& indices,
                                    const DecompositionParams& params = {});

DecompositionResult convexDecompose(const mesh::HalfEdgeMesh& mesh,
                                    const DecompositionParams& params = {});

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_CONVEXDECOMPOSITION_HPP
