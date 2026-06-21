// forge/native/mesh/QuadDominant.hpp
//
// In-house triangle-to-quad-dominant mesh conversion for the Forge native
// kernel — Manifold/OCCT-class mesh processing. Pure C++20, ZERO external
// dependencies: standard library plus the existing forge/native headers only.
// No OCCT, no WASM, no third-party libs.
//
// WHAT THIS DOES (REAL + VALIDATED — see test/native/mesh/quaddominant_test.cpp):
//   Greedy "tri-pairing" quad-dominant remesh, the classic conversion every CAD /
//   DCC mesher ships (Blender's Tris-to-Quads, OpenMesh, libigl):
//     * Enumerate every INTERIOR undirected edge of the triangle soup (an edge
//       shared by exactly two triangles). Each such edge defines a CANDIDATE quad:
//       the union of its two incident triangles, the diagonal removed.
//     * SCORE each candidate by how good the merged quad would be — a single
//       fitness number combining:
//         (planarity)  the two triangles must be near-coplanar (the dihedral
//                      angle across the shared edge ~ flat); a sharp crease is
//                      rejected outright and otherwise penalised,
//         (convexity)  the four corners, projected into the quad's average plane,
//                      must wind as a STRICTLY CONVEX simple quadrilateral — every
//                      consecutive triple turns the SAME way (exact orient2d sign
//                      in that plane). A non-convex / self-intersecting pairing is
//                      rejected outright (never produced),
//         (shape)      a squared-edge-length regularity term (Frobenius-style:
//                      the ratio of the quad's area to the sum of its four squared
//                      side lengths, normalised so a perfect square scores 1) — so
//                      well-proportioned quads are preferred over slivers.
//     * GREEDILY merge the best-scoring candidate first (a max-priority queue),
//       marking both its triangles consumed; each triangle is used AT MOST ONCE.
//       A candidate whose either triangle is already consumed is skipped (lazily,
//       its stale queue entry is discarded). Repeat until the queue drains.
//     * Leftover (unpaired) triangles remain as triangular faces. The output is a
//       polygon soup — a mix of 4-gon and 3-gon faces — indexing the SAME vertex
//       array as the input (no vertices are moved, added, or removed).
//
// GEOMETRIC GUARANTEES (asserted by the gate on a fresh random seed):
//   * Every emitted quad is CONVEX in its own average plane (orient2d-checked) and
//     non-degenerate (positive area). No quad is ever emitted that fails this.
//   * VERTEX + AREA PRESERVATION: the output references exactly the same vertices,
//     and Σ(polygon areas) == Σ(input triangle areas) to within 1e-9 (each merged
//     quad's area equals the sum of its two source triangles' areas, because the
//     shared diagonal contributes nothing — they tile the same region exactly).
//   * On a regular triangulated grid (each unit square split into two triangles)
//     the conversion recovers ~100% quads (>= 90% of faces are quads) with ZERO
//     degenerate or non-convex quads.
//   * A single triangle (no interior edge) stays a triangle.
//
// ROBUSTNESS POSTURE (honest — Bible §0 / KERNEL_INHOUSE_ROADMAP.md §0):
//   The COMBINATORIAL gate — "is the projected quad a strictly convex simple
//   quadrilateral?" — is decided by the EXACT orient2d predicate
//   (forge::native::orient2d) on the quad's four corners projected into its
//   average plane, so a candidate can never be mis-classified convex/non-convex by
//   rounding. The planarity penalty and the shape ratio that ORDER the merges are
//   ordinary double arithmetic (a priority, not a predicate) — this is the same
//   "robust-in-practice with exact predicates" ceiling the rest of
//   forge::native::mesh ships. The greedy order is deterministic for a fixed input
//   (ties broken by edge index), so the result is reproducible.
//
//   0 FAKES: quadDominant() returns ok=false (and leaves `out` untouched) on
//   degenerate / unsupported input — an empty soup, a positions array whose length
//   is not a multiple of 3, an indices array whose length is not a multiple of 3,
//   an out-of-range index, or a degenerate-indexed (repeated vertex) triangle. It
//   NEVER fabricates a face to hit a quad ratio, and never emits a non-convex quad.
//
// SCOPE (honest): this is a single-pass GREEDY pairing. It is NOT a globally
// optimal maximum-weight matching (Blossom) — the classic greedy quad-dominant
// conversion, which on a regular grid already reaches ~100% quads. A perfect
// maximum-matching variant and post-merge edge-flip relaxation are TARGETED, not
// claimed here. Input may be an OPEN or CLOSED triangle soup (this conversion does
// not require a watertight 2-manifold) but must be a valid indexed triangle soup.

#ifndef FORGE_NATIVE_MESH_QUADDOMINANT_HPP
#define FORGE_NATIVE_MESH_QUADDOMINANT_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"  // Vec3 (reused vertex type)

namespace forge {
namespace native {
namespace mesh {

// Tuning knobs for the greedy quad-dominant conversion.
struct QuadDominantOptions {
    // Reject a pairing whose dihedral angle across the shared edge exceeds this
    // (radians). The default ~40 deg keeps quads off sharp creases while still
    // pairing the perfectly-flat tris of a planar grid (dihedral == 0). On a flat
    // grid this never bites; on a folded mesh it preserves feature edges. Must be
    // in (0, pi]; a value >= pi disables the crease guard (all pairings allowed
    // subject to the convexity gate, which is NEVER disabled).
    double maxDihedral = 0.6981317007977318;  // 40 degrees
};

// One polygon face of the result: a list of vertex indices (3 for a leftover
// triangle, 4 for a merged quad), wound consistently with its source triangles.
struct PolyFace {
    // 3 or 4 vertex indices into the (unchanged) input vertex array.
    std::vector<std::uint32_t> verts;
    bool isQuad() const { return verts.size() == 4; }
};

// Outcome of a quad-dominant conversion.
struct QuadDominantReport {
    bool        ok     = false;  // false => `outFaces` left unmodified; see reason.
    const char* reason = "";     // human-readable cause when ok==false.

    std::size_t inputTriangles = 0;
    std::size_t quadCount      = 0;  // merged 4-gon faces emitted
    std::size_t triCount       = 0;  // leftover 3-gon faces emitted
    std::size_t faceCount      = 0;  // quadCount + triCount

    // Fraction of OUTPUT faces that are quads, in [0,1]. (quadCount / faceCount.)
    double quadFraction = 0.0;

    // Σ of the four input-triangle / output-polygon areas (for the area-preserved
    // audit). inputArea is over the source triangles; outputArea over the emitted
    // polygons; they must agree to ~1e-9.
    double inputArea  = 0.0;
    double outputArea = 0.0;
};

// Convert an indexed triangle soup to a quad-dominant polygon soup.
//
//   positions : flat xyz triples (length == 3*numVertices), shared, UNCHANGED.
//   indices   : flat triangle indices (length == 3*numTriangles).
//   options   : tuning (crease threshold).
//   outFaces  : the polygon soup (quads + leftover triangles) — only meaningful
//               when ok==true; left untouched on failure.
//
// Returns a QuadDominantReport. On ANY failure (empty / malformed soup, an
// out-of-range or repeated index) returns ok=false with `reason` set and leaves
// `outFaces` unmodified. Every emitted quad is convex (orient2d-checked) and the
// total area is preserved exactly (up to rounding).
QuadDominantReport quadDominant(const std::vector<double>& positions,
                                const std::vector<std::uint32_t>& indices,
                                const QuadDominantOptions& options,
                                std::vector<PolyFace>& outFaces);

// Convenience overload with default options.
QuadDominantReport quadDominant(const std::vector<double>& positions,
                                const std::vector<std::uint32_t>& indices,
                                std::vector<PolyFace>& outFaces);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_QUADDOMINANT_HPP
