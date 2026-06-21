// forge/native/mesh/Offset.hpp
//
// forge::native::mesh::Offset — uniform mesh offset / shell for the in-house
// Forge native kernel. Pure C++20, ZERO external dependencies: standard library
// plus the existing forge/native/mesh half-edge engine only. No OCCT, no WASM,
// no third-party libs.
//
// WHAT THIS MODULE DOES (honest scope — Bible §0/§9)
// --------------------------------------------------
// An OCCT/Manifold-class UNIFORM offset of a closed, 2-manifold triangle mesh:
// every vertex is displaced along its AREA-WEIGHTED vertex normal by a signed
// distance `d`. A positive `d` GROWS the solid (outward shell); a negative `d`
// SHRINKS it (inward shell / hollow-by-difference precursor). The displaced
// soup is re-wired through HalfEdgeMesh::buildFromSoup and audited with the
// existing validate(), then a light geometric validity pass rejects a shrink
// that has collapsed (folded / inverted) the solid.
//
// WHY AREA-WEIGHTED VERTEX NORMALS (and not angle-weighted): for the canonical
// validation target — a uniformly tessellated sphere of radius r offset by d —
// the area-weighted vertex normal at every vertex coincides (up to tessellation
// error) with the true outward radial direction, so the offset surface tends to
// the analytic sphere of radius (r+d) and the enclosed volume tends to
// (4/3)·π·(r+d)^3. We assert that against a coarse-mesh tolerance.
//
// ROBUSTNESS POSTURE (stated up front, do NOT overclaim):
//   * This is a VERTEX-DISPLACEMENT offset. It is exact-in-the-limit for smooth
//     convex surfaces and robust-in-practice for moderate |d| on well-shaped
//     closed manifolds. It is NOT a Minkowski-sum offset: it does NOT insert the
//     rounded/chamfered edge & corner geometry that a true solid offset adds at
//     convex edges, and it does NOT perform self-intersection removal. A large
//     positive d on a sharp convex feature will leave the topology intact but
//     under-fill the corner; a large negative d that pushes opposing walls past
//     each other WILL self-intersect — we DETECT the gross form of that (volume
//     sign flip / non-positive volume / wholesale face inversion) and return
//     ok=false rather than fabricate a valid-looking but wrong solid.
//   * The combinatorial validity (2-manifold / watertight) of the RESULT is
//     decided by the existing exact-predicate-backed HalfEdgeMesh::validate(),
//     not by a tolerance.
//
// 0 FAKES (Bible §0): ok==true is returned ONLY when the offset mesh is a
// confirmed closed 2-manifold AND (for a shrink) has not collapsed. Degenerate
// or unsupported input yields ok==false with a human-readable reason; geometry
// is NEVER fabricated to pass a test.

#ifndef FORGE_NATIVE_MESH_OFFSET_HPP
#define FORGE_NATIVE_MESH_OFFSET_HPP

#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

// Outcome of an offset operation.
struct OffsetResult {
    bool          ok = false;     // true ONLY for a validated closed 2-manifold
    HalfEdgeMesh  mesh;           // the offset mesh (valid only when ok==true)
    const char*   reason = "";    // why ok==false (diagnostic; "" on success)

    // Diagnostics (populated whenever the input parsed, regardless of ok):
    double        inputVolume  = 0.0;  // signed volume of the input solid
    double        outputVolume = 0.0;  // signed volume of the displaced solid
    std::uint32_t numVertices  = 0;    // vertex count (unchanged by offset)
    std::uint32_t numFaces     = 0;    // face count   (unchanged by offset)
    std::uint32_t flippedFaces = 0;    // faces whose normal inverted vs. input
};

// Offset a closed 2-manifold triangle mesh (given as an indexed triangle soup)
// by signed distance `distance` along area-weighted vertex normals.
//
//   positions : flat xyz triples, length == 3 * numVertices
//   indices   : flat CCW-wound triangle indices, length == 3 * numTriangles
//   distance  : signed offset. > 0 grows the solid; < 0 shrinks it; == 0 is a
//               valid no-op (returns a faithful copy, ok=true).
//
// Returns ok==false (with `reason` set) when:
//   * the soup fails to build a valid closed 2-manifold input, OR
//   * a vertex normal is degenerate (zero area incidence), OR
//   * the displaced mesh is no longer a closed 2-manifold, OR
//   * a shrink (distance < 0) collapsed the solid (volume sign flip, non-positive
//     output volume, or wholesale face inversion).
OffsetResult offsetMesh(const std::vector<double>& positions,
                        const std::vector<std::uint32_t>& indices,
                        double distance);

// Convenience overload: offset an already-built HalfEdgeMesh. The mesh must be a
// closed 2-manifold (its validate().isValid() must be true) or ok==false is
// returned. Internally exports to a soup and forwards to offsetMesh above.
OffsetResult offsetMesh(const HalfEdgeMesh& input, double distance);

// Compute the AREA-WEIGHTED vertex normals of a triangle soup. For vertex v the
// returned normal is the (un-normalized then normalized) sum over incident
// triangles t of (2·area(t))·unitFaceNormal(t) = the raw triangle cross product,
// i.e. each face contributes its full geometric area as weight. Output length is
// numVertices; a vertex with zero total incident area gets a zero normal (the
// caller treats that as degenerate). Exposed for testing / reuse.
std::vector<Vec3> areaWeightedVertexNormals(const std::vector<double>& positions,
                                            const std::vector<std::uint32_t>& indices);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_OFFSET_HPP
