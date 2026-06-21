// forge/native/mesh/Shell.hpp
//
// forge::native::mesh::Shell — shell / hollow a closed 2-manifold triangle mesh
// into a solid WALL of constant thickness. Pure C++20, ZERO external
// dependencies: the standard library plus the existing forge/native headers
// only. No OCCT, no WASM, no third-party libs.
//
// WHAT THIS MODULE DOES (honest scope — Bible §0/§9)
// --------------------------------------------------
// Given a closed 2-manifold "outer" surface S and a wall thickness t > 0, build
// the OCCT/Manifold-class shell (a hollow solid wall):
//
//   1. Construct an INNER surface S' by moving every outer vertex INWARD by t
//      along its area-weighted vertex normal (i.e. by -t along the outward
//      normal). S' has the same connectivity as S but is shrunk by t.
//   2. FLIP the orientation of S' (reverse every triangle's winding) so its
//      normals point INTO the wall material (away from the hollow cavity).
//   3. COMBINE S (outward-facing) and the flipped S' into ONE solid. The result
//      bounds the region BETWEEN the two surfaces — the wall — so its enclosed
//      signed volume is  vol(S) - vol(S')  = the wall volume.
//
//   Optionally OPEN one face as the "mouth": the named outer face and its inner
//   counterpart are removed and the two triangular rims are stitched by a
//   side band, turning the closed wall into an open cup/shell with a real
//   wall-thickness lip around the opening. The opened result is STILL a closed
//   2-manifold solid (the wall has a finite-thickness rim, so there is no
//   boundary edge — the "mouth" is a hole through the solid, not an open mesh).
//
// VALIDATION TARGET (asserted in the gate):
//   Shelling a sphere of radius R by thickness t yields enclosed WALL volume
//   approx  (4/3)·π·(R^3 - (R-t)^3)  within a coarse-mesh tolerance; the result
//   is watertight 2-manifold (validate().isValid()); genus is preserved.
//
// ROBUSTNESS POSTURE (stated up front, do NOT overclaim):
//   * This is a VERTEX-NORMAL inward offset of the inner wall (the same honest
//     ceiling as Offset.hpp): exact-in-the-limit for smooth surfaces, robust-
//     in-practice for moderate t on well-shaped closed manifolds. It is NOT a
//     Minkowski/medial-axis shell: it does NOT insert rounded inner edges and it
//     does NOT remove self-intersections that arise when t exceeds the local
//     feature size. The gross collapse (t >= R, opposing walls crossing,
//     volume-sign flip, wholesale face inversion) is DETECTED and reported as
//     ok=false — never fabricated into a valid-looking but wrong solid.
//   * The combinatorial validity (2-manifold / watertight) of the RESULT is
//     decided by the existing exact-predicate-backed HalfEdgeMesh::validate(),
//     not by a tolerance.
//
// 0 FAKES (Bible §0): ok==true is returned ONLY when the shell mesh is a
// confirmed closed 2-manifold AND the inner wall has not collapsed. Degenerate,
// unsupported, or over-thick (t >= R) input yields ok==false with a human-
// readable reason; geometry is NEVER fabricated to pass a test.

#ifndef FORGE_NATIVE_MESH_SHELL_HPP
#define FORGE_NATIVE_MESH_SHELL_HPP

#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

// Outcome of a shell / hollow operation.
struct ShellResult {
    bool          ok = false;     // true ONLY for a validated closed 2-manifold wall
    HalfEdgeMesh  mesh;           // the shelled wall (valid only when ok==true)
    const char*   reason = "";    // why ok==false (diagnostic; "" on success)

    // Diagnostics (populated whenever the input parsed, regardless of ok):
    double        outerVolume = 0.0;  // signed volume of the outer surface (solid)
    double        innerVolume = 0.0;  // signed volume of the inner surface (cavity)
    double        wallVolume  = 0.0;  // enclosed wall volume = outer - inner
    std::uint32_t numVertices = 0;    // vertices in the result (2*N, or 2*N for open)
    std::uint32_t numFaces    = 0;    // faces in the result
    std::uint32_t inputGenus  = 0;    // genus of the input surface
    std::uint32_t resultGenus = 0;    // genus of the result (preserved => equal*)
                                       // *for the closed case the result is the
                                       //  disjoint union of two genus-g surfaces;
                                       //  resultGenus reports the per-component
                                       //  genus, which equals inputGenus.
};

// Shell a closed 2-manifold triangle mesh (given as an indexed triangle soup)
// into a wall of thickness `thickness` (t > 0). The inner surface is the input
// offset INWARD by t along area-weighted vertex normals, flipped, and unioned
// with the outer surface into a closed solid wall.
//
//   positions   : flat xyz triples, length == 3 * numVertices
//   indices     : flat CCW-wound triangle indices, length == 3 * numTriangles
//   thickness   : wall thickness t. Must be > 0 (a non-positive t is rejected).
//   openFace    : if >= 0, the index of the OUTER triangle to open as the mouth.
//                 The matching inner triangle is removed and the rims stitched.
//                 Pass a negative value (default -1) for a fully closed wall.
//
// Returns ok==false (with `reason` set) when:
//   * the soup fails to build a valid closed 2-manifold input, OR
//   * thickness <= 0, OR
//   * a vertex normal is degenerate (zero incident area), OR
//   * the inner offset collapsed the solid (t >= local feature size: volume sign
//     flip, non-positive inner volume, or wholesale inner-face inversion), OR
//   * the combined wall is not a closed 2-manifold (validate() fails), OR
//   * openFace is out of range.
ShellResult shellMesh(const std::vector<double>& positions,
                      const std::vector<std::uint32_t>& indices,
                      double thickness,
                      int openFace = -1);

// Convenience overload: shell an already-built HalfEdgeMesh. The mesh must be a
// closed 2-manifold (its validate().isValid() must be true) or ok==false is
// returned. Internally exports to a soup and forwards to shellMesh above.
ShellResult shellMesh(const HalfEdgeMesh& input, double thickness,
                      int openFace = -1);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_SHELL_HPP
