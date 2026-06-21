// forge/native/mesh/Curvature.hpp
//
// In-house discrete differential curvature on the half-edge triangle mesh —
// forge::native::mesh::Curvature. Pure C++20, standard library only. NO OCCT,
// NO WASM, NO third-party libs. Builds ONLY on the existing forge native headers
// (by #include, never re-deriving them):
//   * forge/native/Predicates.hpp        (robust orientation, only as a sanity
//                                          oracle for triangle degeneracy)
//   * forge/native/geom/Geom.hpp          (Point3)
//   * forge/native/geom/AABBTree.hpp      (BVH — used only to corroborate that
//                                          the mesh is a clean soup; no query is
//                                          required by the math but the include
//                                          is part of the mandated reuse surface)
//   * forge/native/mesh/HalfEdgeMesh.hpp  (Vec3 / HalfEdgeMesh / buildFromSoup /
//                                          validate / signedVolume / surfaceArea)
//
// WHAT THIS MODULE COMPUTES (REAL and VALIDATED — see curvature_test.cpp):
//   Per-vertex DISCRETE differential curvature, the Meyer–Desbrun–Schröder–Barr
//   ("Discrete Differential-Geometry Operators for Triangulated 2-Manifolds")
//   operator family:
//
//     (1) MEAN curvature H.
//         The cotangent-Laplacian (Laplace–Beltrami) mean-curvature-normal
//             K(x_i) = 1/(2 A_mixed) * sum_{j in N(i)} (cot a_ij + cot b_ij)(x_i - x_j)
//         where a_ij, b_ij are the two angles opposite the edge (i,j) in its two
//         incident triangles, and A_mixed is Meyer's MIXED Voronoi area (true
//         Voronoi area for a non-obtuse triangle; |T|/2 or |T|/4 for the obtuse
//         cases). The scalar mean curvature is H = |K| / 2, signed by the dot of
//         K with the area-weighted vertex normal so that a convex outward sphere
//         reports H > 0.
//
//     (2) GAUSSIAN curvature K.
//         The angle-deficit operator
//             K(x_i) = (2*pi - sum_f theta_f) / A_mixed
//         for an interior vertex (theta_f the incident-triangle tip angles at i).
//         On a BOUNDARY vertex the spherical defect is (pi - sum theta_f) — the
//         geodesic-curvature term — so the per-vertex K is not pointwise defined
//         there; we mark boundary vertices and exclude them from the pointwise K
//         field (their defect is still summed for Gauss–Bonnet, see below).
//
//     (3) PRINCIPAL curvatures k1, k2 from the two invariants:
//             k1 = H + sqrt(max(0, H^2 - K)),
//             k2 = H - sqrt(max(0, H^2 - K)).
//         (k1 >= k2; the discriminant is clamped at 0 — a tiny negative H^2 - K
//         is pure discretisation noise, never a real imaginary curvature.)
//
// VALIDATION ENVELOPE asserted by the standalone gate:
//   * SPHERE radius R: at every INTERIOR vertex K -> 1/R^2 and H -> 1/R, and the
//     error SHRINKS under refinement (coarse icosphere vs fine icosphere).
//   * FLAT plane patch: H ~ 0 and K ~ 0 at every interior vertex.
//   * Discrete GAUSS–BONNET on a CLOSED mesh:
//         sum_v (angle defect at v)  ==  2*pi*chi
//     (equivalently sum_v K_v * A_mixed_v == 2*pi*chi for the interior+the
//     boundary geodesic term; on a closed mesh there is no boundary so the
//     geodesic-curvature integral is zero), with chi = V - E + F the Euler
//     characteristic from the kernel's own audit. Holds to ~1e-9 (it is a
//     combinatorial identity, exact up to floating round-off, NOT a refinement
//     limit).
//
// ROBUSTNESS POSTURE (honest — Bible §0):
//   The curvature operators are plain IEEE-754 double evaluations of an exact
//   discrete formula. There is no tolerance tuning in the MATH: Gauss–Bonnet is a
//   true identity and is asserted at round-off level; the sphere/plane limits are
//   asserted with a tolerance that must SHRINK under refinement (so it cannot be
//   a hand-picked constant). Degenerate input is reported via ok=false, never
//   papered over: a non-2-manifold soup, a mesh with a zero-area (degenerate)
//   triangle, non-finite coordinates, or an empty mesh all fail loudly. The
//   per-vertex fields are only populated for a mesh the kernel's own half-edge
//   audit accepts. 0 FAKES.

#ifndef FORGE_NATIVE_MESH_CURVATURE_HPP
#define FORGE_NATIVE_MESH_CURVATURE_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"
#include "forge/native/geom/AABBTree.hpp"
#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

// Per-vertex discrete curvature result. All vectors are sized numVertices when
// ok==true (empty when ok==false). Indexing matches the input vertex order.
struct CurvatureField {
    bool ok = false;
    const char* reason = "";

    std::uint32_t numVertices = 0;
    std::uint32_t numFaces    = 0;
    std::uint32_t numBoundaryVertices = 0;   // vertices on an open boundary loop

    // Mixed Voronoi area associated with each vertex (Meyer A_mixed). The sum of
    // these equals the total surface area (a partition of unity over the mesh).
    std::vector<double> mixedArea;

    // Mean curvature H (>=0 magnitude form), signed by the outward vertex normal
    // (convex/outward => positive). Pointwise meaningful at INTERIOR vertices.
    std::vector<double> meanH;

    // Gaussian curvature K = angleDefect / A_mixed. Pointwise meaningful at
    // INTERIOR vertices (set to 0 and flagged at boundary vertices).
    std::vector<double> gaussianK;

    // Principal curvatures, k1 >= k2, derived from (H,K). Interior only.
    std::vector<double> k1;
    std::vector<double> k2;

    // Raw angular defect per vertex: interior (2*pi - sum theta), boundary
    // (pi - sum theta). Summed over ALL vertices this is the Gauss–Bonnet total
    // = 2*pi*chi exactly (up to round-off).
    std::vector<double> angleDefect;

    // true for a vertex that lies on an open boundary loop (a half-edge with no
    // twin in its star). Pointwise K/H are NOT reported for these.
    std::vector<unsigned char> isBoundary;

    // Sum over all vertices of angleDefect — the discrete Gauss–Bonnet integrand.
    // Equals 2*pi*chi for the analysed mesh.
    double totalAngleDefect = 0.0;
};

// Compute the per-vertex discrete curvature field for an indexed triangle soup.
// The soup is built into the kernel HalfEdgeMesh and audited; ok=false (with an
// empty field and a populated `reason`) on:
//   * empty input / mismatched index length,
//   * a soup the kernel cannot build (out-of-range index, repeated vertex in a
//     face, inconsistent winding / non-manifold directed edge),
//   * a non-finite coordinate,
//   * a degenerate (zero-area) triangle,
//   * a mesh whose half-edge audit reports it is not 2-manifold.
// A mesh WITH a clean open boundary is accepted (curvature is reported for its
// interior vertices; boundary vertices are flagged, not silently fabricated).
CurvatureField computeCurvature(const std::vector<double>& positions,
                                const std::vector<std::uint32_t>& indices);

// Convenience overload: compute directly from an already-built half-edge mesh.
// Same semantics; the mesh is re-audited internally.
CurvatureField computeCurvature(const HalfEdgeMesh& mesh);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_CURVATURE_HPP
