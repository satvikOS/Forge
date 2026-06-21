// forge/native/implicit/MeshToSDF.hpp
//
// In-house mesh -> signed-distance-field voxelization — a new IMPLICIT-stage
// module of KERNEL_INHOUSE_ROADMAP.md. Pure C++20, ZERO external dependencies,
// no OCCT, no WASM, no third-party libs. Standard library + the existing
// forge/native headers only.
//
// WHAT THIS MODULE DOES (the bridge it fills)
// -------------------------------------------
// The kernel already ships the *forward* direction implicit -> mesh:
//   * implicit::IsoMesher / voxel::VoxelMesh contour a sampled field into a
//     forge::native::mesh::HalfEdgeMesh.
// This module ships the *reverse* direction mesh -> implicit field:
//   * Given a triangle mesh (mesh::HalfEdgeMesh), sample a SIGNED distance field
//     onto a dense voxel::VoxelGrid<float> over the mesh's padded axis-aligned
//     bounding box. The result is exactly the input type the IsoMesher/VoxelMesh
//     consume, so a mesh can be round-tripped: mesh -> SDF grid -> re-contoured
//     mesh (remesh / offset / boolean-via-field pipelines all want this seam).
//
// ALGORITHM (honest — this is the FIRST increment)
// ------------------------------------------------
//   UNSIGNED distance at a grid node p:
//       d(p) = min over all triangles T of  pointTriangleDistance(p, T)
//     computed BRUTE FORCE (every node vs every triangle). This is O(N_nodes *
//     N_tris) and is deliberately simple+correct; a BVH-accelerated query is the
//     obvious future speed-up (TARGETED — geom/AABBTree.hpp already exists for it)
//     but changes NOTHING about the VALUES this increment produces.
//   SIGN (inside negative) by PARITY of an axis-aligned ray:
//       shoot a ray from p along +x and count the triangles it crosses; ODD =>
//       p is inside the closed surface => negate the distance. This is the
//       classic ray-parity (Jordan-curve / crossing-number) inside test. It is
//       correct for a CLOSED, consistently-wound mesh away from the measure-zero
//       set of rays that graze an edge/vertex; we PERTURB the ray direction
//       slightly off-axis to dodge those degeneracies (see the .cpp).
//
// HONESTY / ROBUSTNESS POSTURE (Bible §0/§9 — do NOT overclaim)
//   * The DISTANCE magnitude is the exact Euclidean point-to-triangle distance
//     (closed-form per triangle), reduced over the soup — no sampling error in
//     the field value itself; the only approximation is the grid discretisation
//     done by the VoxelGrid (the caller's spacing).
//   * The SIGN is robust-in-practice for a closed manifold mesh. It is decided by
//     ray-triangle crossing PARITY with a small directional perturbation to avoid
//     edge/vertex grazes; it is NOT a proven-exact in/out classification (that
//     would route every crossing through the exact orient3d predicate and a
//     symbolic ray tie-break — TARGETED). For a non-closed / non-manifold mesh
//     the parity sign is meaningless and we do not pretend otherwise (callers get
//     ok=false on the validated degenerate paths; an OPEN mesh is reported via
//     the result's `closed` flag so its signs are not trusted blindly).
//   * 0 FAKES: an EMPTY mesh (no faces) returns ok=false and an empty grid. A
//     zero-extent or non-finite AABB returns ok=false. We never fabricate a field
//     to pass a test.
//
// TARGETED (NOT in this increment — flagged, never faked):
//   * BVH-accelerated nearest-triangle query (geom/AABBTree.hpp) to drop the
//     brute-force O(N_nodes*N_tris). Pure speed; identical values. // TODO(bvh)
//   * Proven-exact ray-parity sign via forge::native::orient3d with symbolic
//     tie-breaking on edge/vertex grazes. // TODO(exact-sign)
//   * Generalized winding number for a robust sign on OPEN / non-manifold meshes
//     (the parity test requires closure). // TODO(winding-number)
//   * Narrow-band / sparse storage; this increment fills the dense grid.
//
// CONVENTIONS: namespace forge::native::implicit. Pure C++20, standard library
// only. ZERO external deps, NO OCCT, NO WASM, NO third-party libs.

#ifndef FORGE_NATIVE_IMPLICIT_MESHTOSDF_HPP
#define FORGE_NATIVE_IMPLICIT_MESHTOSDF_HPP

#include <cstddef>

#include "forge/native/mesh/HalfEdgeMesh.hpp"   // mesh::HalfEdgeMesh, mesh::Vec3
#include "forge/native/voxel/VoxelGrid.hpp"     // voxel VoxelGrid<float>, native::Vec3

namespace forge {
namespace native {
namespace implicit {

// ---------------------------------------------------------------------------
// Result of a mesh -> SDF voxelization.
//
//   ok      : true only when a VALID signed field was produced. false (and
//             `grid` left default / empty) on a degenerate input — an empty mesh
//             (no faces), or a zero-extent / non-finite bounding box. Honest
//             failure; never a fabricated field.
//   grid    : the dense signed-distance field (negative inside, positive
//             outside, ~zero on the surface) sampled at every node over the
//             mesh's padded AABB. Valid only when ok == true.
//   closed  : whether the source mesh was watertight (closed). The PARITY sign is
//             only meaningful for a closed mesh; surfaced so callers do not trust
//             the sign of an open-mesh field blindly. (The field is still
//             produced for an open mesh when ok==true, but `closed` warns that the
//             inside/outside sign is best-effort.)
//   numTriangles : triangle count consumed (diagnostic).
//   reason  : short human-readable cause when ok == false ("" on success).
// ---------------------------------------------------------------------------
struct MeshSdfResult {
    bool ok = false;
    // The dense signed field. VoxelGrid lives in forge::native (NOT ::voxel) per
    // VoxelGrid.hpp; we use float storage to match voxel::VoxelMesh::contour,
    // which consumes a VoxelGrid<float> — so this field round-trips directly.
    native::VoxelGrid<float> grid{};
    bool closed = false;
    std::size_t numTriangles = 0;
    const char* reason = "";
};

// ---------------------------------------------------------------------------
// Sampling spec: how finely to voxelize and how much to pad the AABB.
// ---------------------------------------------------------------------------
struct MeshToSdfSpec {
    // Edge length of one cubic voxel cell in WORLD units. Must be > 0.
    double spacing = 0.05;
    // Padding around the mesh AABB, expressed in CELLS, on every side. Keeps the
    // zero-isosurface strictly interior to the grid box (so a re-contour is
    // closed) and gives the +distance field room to grow. Must be >= 1.
    int marginCells = 3;
};

// ---------------------------------------------------------------------------
// MeshToSDF — the mesh -> signed distance field voxelizer.
// ---------------------------------------------------------------------------
class MeshToSDF {
public:
    // Voxelize `mesh` into a signed distance field over its padded AABB.
    // Returns ok=false (empty grid) on a degenerate input (no faces, or a
    // zero-extent / non-finite box, or a non-positive spacing / margin < 1).
    static MeshSdfResult build(const mesh::HalfEdgeMesh& mesh,
                               const MeshToSdfSpec& spec = MeshToSdfSpec{});

    // Direct unsigned distance from a world point to the mesh's triangle soup
    // (min point-to-triangle distance, brute force). Exposed for testing /
    // reuse. Returns +inf if the soup has no triangles.
    static double unsignedDistance(const mesh::HalfEdgeMesh& mesh,
                                   const native::Vec3& p);

    // Exact closed-form distance from point p to triangle (a,b,c). Static + free
    // of any mesh state so it is independently testable.
    static double pointTriangleDistance(const native::Vec3& p,
                                        const native::Vec3& a,
                                        const native::Vec3& b,
                                        const native::Vec3& c);
};

} // namespace implicit
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_IMPLICIT_MESHTOSDF_HPP
