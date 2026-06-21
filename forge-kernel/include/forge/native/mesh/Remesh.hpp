// forge/native/mesh/Remesh.hpp
//
// Manifold-class ISOTROPIC REMESHING for the in-house Forge native kernel.
// Pure C++20, ZERO external dependencies — no OCCT, no WASM, no third-party
// libs. Uses only the standard library plus the existing forge/native mesh
// half-edge data structure (HalfEdgeMesh.hpp) for the soup<->mesh round trip
// and the validity / volume audit.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS MODULE DOES (the classical Botsch–Kobbelt incremental remesher):
//
//   Given a 2-manifold triangle mesh and a target edge length L, iterate:
//     (1) SPLIT   every edge longer than 4/3·L at its midpoint,
//     (2) COLLAPSE every edge shorter than 4/5·L (guarded by the topological
//         LINK CONDITION + a no-long-edge / no-flip safeguard so the result
//         stays 2-manifold and does not create over-long edges),
//     (3) FLIP    every interior edge whose flip reduces the total deviation of
//         the four incident vertex valences from the ideal (6 interior / 4 on a
//         boundary),
//     (4) SMOOTH  each vertex by a TANGENTIAL Laplacian step (the centroid of
//         its 1-ring, with the component along the local surface normal removed
//         so the surface is not shrunk/inflated), boundary vertices smoothed
//         only along the boundary polyline.
//
//   The net effect is a near-uniform-edge-length, near-valence-6 triangulation
//   that approximates the same surface — edge-length STDDEV collapses while the
//   mesh stays watertight, 2-manifold, and volume-preserving to a few percent.
//
// PRESERVATION GUARANTEES (honest — see Remesh.cpp for the proofs in code):
//   * 2-MANIFOLDNESS: every split/collapse/flip is rejected unless it keeps the
//     edge–face incidence at exactly two. Collapses additionally enforce the
//     LINK CONDITION (the intersection of the two endpoints' one-ring vertex
//     links is exactly the two shared opposite vertices) — the necessary and
//     sufficient combinatorial test for an edge collapse to preserve a 2-mani-
//     fold. This is why we never produce non-manifold edges.
//   * BOUNDARY: boundary edges are never collapsed across the boundary and
//     boundary vertices never leave the boundary polyline; an interior edge is
//     never flipped if either opposite vertex is on the boundary in a way that
//     would fold the boundary. (For a closed input there is no boundary; the
//     boundary logic is exercised by the open-mesh path and reported honestly.)
//   * SURFACE: smoothing is purely TANGENTIAL (normal component removed) so the
//     vertices slide along the surface rather than shrinking it.
//
// 0-FAKES (Bible §0/§9): on degenerate or unsupported input (non-manifold soup,
// non-positive target length, empty mesh) we return ok=false and DO NOT fabri-
// cate geometry. ok=true is returned ONLY after the result round-trips through
// HalfEdgeMesh::buildFromSoup + validate() as a real 2-manifold mesh.
//
// ROBUSTNESS POSTURE (honest): this is a combinatorial/geometric remesher in
// plain double precision. The half-edge surgery (split/collapse/flip) is exact
// in its COMBINATORICS (integer index bookkeeping); vertex placement is double.
// We do NOT call the exact orient3d predicate here — the operations are guarded
// by the link condition + a normal-flip / area-degeneracy veto rather than by
// an exact in/out test, which is the same posture the reference incremental
// remeshers ship. The validation gate (watertight 2-manifold, bounded volume
// drift, shrinking edge-length stddev) is asserted on a fresh random seed.
// ─────────────────────────────────────────────────────────────────────────────

#ifndef FORGE_NATIVE_MESH_REMESH_HPP
#define FORGE_NATIVE_MESH_REMESH_HPP

#include <cstdint>
#include <vector>

namespace forge {
namespace native {
namespace mesh {

// Tuning knobs for the incremental remesher. Defaults follow Botsch–Kobbelt.
struct RemeshOptions {
    // Number of split/collapse/flip/smooth passes. 5–10 is the usual range.
    int    iterations          = 8;
    // Long-edge split threshold = splitRatio * targetLength (default 4/3).
    double splitRatio          = 4.0 / 3.0;
    // Short-edge collapse threshold = collapseRatio * targetLength (default 4/5).
    double collapseRatio       = 4.0 / 5.0;
    // Tangential smoothing relaxation factor in [0,1] (0 = none, 1 = full step).
    // Kept moderate: a tangential Laplacian step still creeps a convex surface
    // inward slightly per pass, so a smaller lambda trades a touch of uniformity
    // for markedly better volume preservation.
    double smoothLambda        = 0.3;
    // Enable the valence-improving edge flips.
    bool   doFlips             = true;
    // Enable the tangential Laplacian smoothing pass.
    bool   doSmoothing         = true;
    // Project each collapse target onto the midpoint of the collapsed edge
    // (true) vs onto one of its endpoints (false). Midpoint is the default.
    bool   collapseToMidpoint  = true;
};

// Diagnostics returned alongside the remeshed soup.
struct RemeshReport {
    bool          ok                = false; // true ONLY for a validated 2-manifold
    const char*   reason            = "";    // why ok==false (for diagnostics)

    // Before / after geometry stats (computed on the actual meshes).
    std::uint32_t inVertices        = 0;
    std::uint32_t inFaces           = 0;
    std::uint32_t outVertices       = 0;
    std::uint32_t outFaces          = 0;

    double        targetLength      = 0.0;
    double        meanEdgeBefore    = 0.0;
    double        meanEdgeAfter     = 0.0;
    double        stddevEdgeBefore  = 0.0;
    double        stddevEdgeAfter   = 0.0;

    double        volumeBefore      = 0.0;
    double        volumeAfter       = 0.0;

    bool          watertight        = false; // out mesh closed
    bool          manifold          = false; // out mesh 2-manifold
    std::uint32_t nonManifoldEdges  = 0;     // out mesh count (must be 0)
    std::uint32_t boundaryEdges     = 0;     // out mesh boundary half-edges
    int           splits            = 0;     // surgery counters (cumulative)
    int           collapses         = 0;
    int           flips             = 0;
};

// Isotropic-remesh an indexed triangle soup to target edge length `targetLength`.
//
//   positions    : flat xyz triples (length == 3*numVertices)
//   indices      : flat triangle indices (length == 3*numTriangles)
//   targetLength : desired uniform edge length (> 0)
//   outPositions / outIndices : the remeshed soup (only meaningful if ok==true)
//
// Returns a RemeshReport. On ANY failure (bad input, non-manifold soup, target
// length <= 0, or a result that fails the half-edge validity audit) ok==false
// and the out-soup is left empty — NO geometry is fabricated.
RemeshReport remesh(const std::vector<double>&        positions,
                    const std::vector<std::uint32_t>& indices,
                    double                            targetLength,
                    const RemeshOptions&              options,
                    std::vector<double>&              outPositions,
                    std::vector<std::uint32_t>&       outIndices);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_REMESH_HPP
