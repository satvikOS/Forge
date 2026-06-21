// forge/native/mesh/Inset.hpp
//
// forge::native::mesh::Inset — per-face INSET for the in-house Forge native
// kernel. Pure C++20, ZERO external dependencies: the standard library plus the
// existing forge/native headers only. No OCCT, no WASM, no third-party libs.
//
// WHAT THIS MODULE DOES (honest scope — Bible §0/§9)
// --------------------------------------------------
// The classic polygon-modeling INSET op (Blender "I" / Maya bevel-inset /
// "panel loop"): for every polygon FACE of a surface mesh, shrink the face
// toward its own centroid by a planar distance `d`, IN THE FACE PLANE, and
// rebuild the topology so that:
//
//   * the SHRUNKEN inner face replaces the original face, and
//   * a RING of border quads connects each original boundary edge to its inset
//     counterpart (the "panel" between the old rim and the new shrunken face).
//
// This is a per-face operation on POLYGON faces (triangles, quads, n-gons). It
// is the detailing/paneling primitive used to add an inset frame around a face
// before extruding/insetting again — purely additive geometry, the surface area
// of the original face is conserved (inner face + border ring == original).
//
// REPRESENTATION
// --------------
// The mesh is a POLYGON SOUP: a flat array of vertex positions (xyz triples)
// plus a list of faces, each face being an ordered loop of vertex indices
// (CCW as seen from the face's outward side). A box is six quad faces; this is
// the natural representation for the canonical box-inset validation (a triangle
// soup cannot express a square face whose inset area law is (1-2d/side)^2).
//
// GEOMETRY OF ONE FACE INSET
// --------------------------
// For a planar (or near-planar) face with vertices v_0..v_{k-1}:
//   1. centroid  c = (1/k) Σ v_i,
//   2. fit a face plane (Newell normal n through c) — the inset stays in-plane,
//   3. each new inset vertex  v_i' = c + (1 - s)·(v_i - c)  where the per-face
//      uniform planar shrink factor s is chosen so that the inset boundary sits
//      a distance `d` inward from the original boundary. For a regular face the
//      relation is exact; for a general convex face we use the centroid-scaling
//      inset (s = d / r_in, r_in = the in-radius proxy = min centroid→edge
//      distance) which is the standard, area-correct centroid inset and is
//      EXACT for the box's square faces (the validation target).
//
// The classic centroid inset is `v_i' = c + factor·(v_i - c)` with a single
// per-face `factor = 1 - 2d/extent`, where `extent` is the face's full
// centroid-symmetric span (side length for a square). This makes the inner
// face a uniformly scaled copy of the original about its centroid, so the
// inner area == factor^2 · originalArea — the asserted law.
//
// VALIDATION TARGET (asserted in the gate):
//   Insetting the six square faces of a box of side `L` by `d` yields, per
//   face, an inner face that is the original scaled by factor=(1-2d/L) about
//   its centroid, hence inner area == factor^2 · L^2 within 1e-9; plus a border
//   ring of 4 quads per face whose area == L^2 - inner area; the total surface
//   vertex count grows by exactly (Σ face valence) new inset vertices.
//
// ROBUSTNESS / HONEST LIMITS (do NOT overclaim):
//   * This is a CENTROID-SCALING inset (uniform per-face shrink about the
//     centroid in the face plane). It is EXACT for centroid-symmetric faces
//     (squares, regular n-gons, parallelograms) — the inner face is a true
//     scaled copy. For a general NON-symmetric convex face the centroid inset
//     is the standard modeling result but the inset distance is not perfectly
//     uniform along every edge (the same honest ceiling Blender's plain inset
//     ships); a constant-distance (straight-skeleton) inset is TARGETED, not
//     claimed here.
//   * A NON-PLANAR face is projected to its best-fit (Newell) plane for the
//     in-plane shrink; the inset vertices are placed exactly on the original
//     face's affine hull. Strongly non-planar faces are inset honestly in that
//     plane (no fabricated curvature).
//   * d that meets or exceeds half the face's smallest extent would collapse /
//     invert that face (factor <= 0). That face's inset is REJECTED (reported
//     in `rejectedFaces`, the face is passed through UNCHANGED) — never
//     fabricated into a degenerate or back-to-front panel.
//
// 0 FAKES (Bible §0): ok==true is returned ONLY when every accepted face was
// inset into a strictly-shrunk, correctly-wound inner face plus a non-degenerate
// border ring; degenerate, unsupported, or over-large-`d` faces are reported
// honestly (ok stays true with a non-empty rejectedFaces list when SOME faces
// were valid; ok=false only when the whole input is unusable). Geometry is NEVER
// fabricated to pass a test.

#ifndef FORGE_NATIVE_MESH_INSET_HPP
#define FORGE_NATIVE_MESH_INSET_HPP

#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"  // for Vec3 / kInvalid conventions

namespace forge {
namespace native {
namespace mesh {

// A polygon soup: positions are flat xyz triples; each face is an ordered loop
// of indices into the position array (>= 3 entries). This is the in/out type of
// the inset op.
struct PolyMesh {
    std::vector<double>                     positions;  // flat xyz, 3*numVertices
    std::vector<std::vector<std::uint32_t>> faces;      // per-face index loops

    std::size_t vertexCount() const { return positions.size() / 3; }
    std::size_t faceCount()   const { return faces.size(); }
};

// Per-face diagnostic recorded for the canonical box validation and reuse.
struct FaceInsetInfo {
    std::uint32_t sourceFace   = kInvalid;  // index of the original face
    std::uint32_t valence      = 0;         // # vertices in the original face
    double        factor       = 0.0;       // centroid scale used (1 - 2d/extent)
    double        extent       = 0.0;       // face's centroid-symmetric span used
    double        originalArea = 0.0;       // area of the original polygon
    double        innerArea    = 0.0;       // area of the shrunken inner polygon
    double        ringArea     = 0.0;       // area of the border ring (orig-inner)
    bool          rejected     = false;     // true => d too large; passed through
    std::uint32_t innerFace    = kInvalid;  // index of the inner face in result
    // index range of the border-ring quads in the result (half-open) when accepted
    std::uint32_t ringBegin    = kInvalid;
    std::uint32_t ringEnd      = kInvalid;
};

// Outcome of an inset operation.
struct InsetResult {
    bool          ok = false;        // true when >= 1 face was validly inset
    PolyMesh      mesh;              // the inset surface (valid only when ok==true)
    const char*   reason = "";       // why ok==false (diagnostic; "" on success)

    std::vector<FaceInsetInfo> faceInfo;  // one entry per ORIGINAL face

    // Roll-up diagnostics (populated whenever the input parsed):
    std::uint32_t inputVertices   = 0;
    std::uint32_t inputFaces      = 0;
    std::uint32_t outputVertices  = 0;
    std::uint32_t outputFaces     = 0;
    std::uint32_t insetFaces      = 0;   // faces successfully inset
    std::uint32_t rejectedFaces   = 0;   // faces rejected (d too large/degenerate)
    double        inputArea       = 0.0; // total surface area of the input
    double        outputArea      = 0.0; // total surface area of the result
};

// Inset every face of a polygon soup toward its centroid by planar distance `d`.
//
//   positions : flat xyz triples, length == 3 * numVertices
//   faces     : per-face ordered index loops (each face >= 3 indices)
//   d         : the inset distance (planar, inward). d == 0 is a faithful no-op
//               (ok=true, mesh unchanged). d < 0 is rejected (use a positive
//               inset; an outset is a different op).
//
// A face is REJECTED (passed through unchanged, recorded in faceInfo, counted in
// rejectedFaces) when:
//   * it has < 3 vertices or a repeated index, OR
//   * it is degenerate (zero area / collinear), OR
//   * d >= half its smallest centroid-symmetric extent (the inset would collapse
//     or invert that face — factor <= 0).
//
// Returns ok==false (with `reason` set) only when the WHOLE input is unusable:
//   * empty input, ragged positions length, any index out of range, or
//   * NO face could be validly inset (every face rejected) with d > 0.
InsetResult insetFaces(const std::vector<double>& positions,
                       const std::vector<std::vector<std::uint32_t>>& faces,
                       double d);

// Convenience overload taking a PolyMesh.
InsetResult insetFaces(const PolyMesh& input, double d);

// Build the six-quad polygon soup of an axis-aligned box [0,L]^3 placed at
// `origin`, with all faces CCW-wound as seen from OUTSIDE. Exposed for testing /
// reuse (the canonical inset validation target).
PolyMesh makeBox(double L, const Vec3& origin = Vec3{0.0, 0.0, 0.0});

// Area of a single planar (or near-planar) polygon given its vertex loop, via
// the Newell vector-area formula (exact for planar polygons; magnitude of the
// signed vector area for non-planar ones). Exposed for testing / reuse.
double polygonArea(const std::vector<double>& positions,
                   const std::vector<std::uint32_t>& loop);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_INSET_HPP
