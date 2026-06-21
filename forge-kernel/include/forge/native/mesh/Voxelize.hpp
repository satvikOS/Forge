// forge/native/mesh/Voxelize.hpp
//
// In-house SOLID voxelization — forge::native::mesh::Voxelize.
// Pure C++20, standard library only. NO OCCT, NO WASM, NO third-party libs.
//
// WHAT THIS IS (honest — Bible §0/§9, KERNEL_INHOUSE_ROADMAP.md):
//   Rasterize a CLOSED, consistently-wound triangle mesh into a boolean /
//   occupancy field (a `forge::native::VoxelGrid<float>`) over its PADDED
//   axis-aligned bounding box. A voxel CELL is OCCUPIED (inside the solid) iff
//   an axis-aligned ray fired through the cell CENTRE crosses the mesh surface
//   an ODD number of times (the even-odd / Jordan-curve ray-parity rule). Each
//   INSIDE cell sets exactly its LOWER-CORNER node to 1.0f (a 1:1 cell<->node
//   tally; all other nodes stay 0.0f), so the occupancy is read back by counting
//   set nodes — VoxelizeResult.occupiedCells equals that node count exactly.
//   (We do NOT use the VoxelGrid trilinear cell-CENTRE rule here: that averages
//   8 corner nodes and would blur a binary indicator; the parity fill already
//   decides occupancy per cell, so a direct 1:1 node tally is the faithful
//   read-back.)
//
// DISTINCT FROM MeshToSDF (implicit/MeshToSDF.hpp): that builds a *signed
//   distance* field (a continuous scalar = distance to surface). THIS builds an
//   *occupancy* field (a binary in/out indicator). Both share the VoxelGrid
//   container, but the quantity stored and the fill rule are different — solid
//   voxelization is the integer-parity rasterization, not a distance transform.
//
// ALGORITHM (parity scanline, exact-predicate-guarded combinatorics):
//   The ray axis is +X. For each grid CELL row (j,k) we collect the X-coordinate
//   where every triangle whose Y-Z projection contains the row's (y,z) sample is
//   pierced by the +X ray through that (y,z). Sorting those hits and pairing them
//   (enter/exit) yields the inside X-spans; cells whose centre falls in a span
//   are marked occupied. The point-in-triangle (Y-Z projection) containment test
//   is decided by the ROBUST forge::native::orient2d predicate so the
//   combinatorial "does the ray pass through this triangle" decision cannot be
//   corrupted by rounding (the X-crossing COORDINATE is an ordinary double — the
//   same honest "exact classification, double construction" posture as Geom.hpp).
//
//   To keep the parity globally consistent on edge/vertex grazes (where a naive
//   point-in-triangle would double-count a shared edge), the row sample points
//   (y,z) are the cell CENTRES (half-integer offsets), which generically miss
//   every mesh vertex/edge; degenerate on-edge samples are rejected (the triangle
//   does not contribute) so each true crossing is counted exactly once.
//
// CONVERGENCE (the validated claim): the occupied-cell volume of a voxelized
//   solid converges to the true volume as spacing -> 0 (midpoint Riemann sum of
//   the indicator). For a sphere the error SHRINKS monotonically under
//   refinement; for an axis-aligned box the voxelization is ~exact (the box
//   faces align with cell faces, so the only error is sub-cell boundary slivers).
//
// HONEST FAILURE (0 FAKES): voxelize() returns ok=false (and an empty grid) on:
//   * spacing <= 0 or non-finite,
//   * a mesh that is NOT a closed 2-manifold (open / non-watertight) — parity
//     fill is undefined on an open surface, so we REFUSE rather than fabricate,
//   * empty / ragged / out-of-range / degenerate-indexed soup (buildFromSoup
//     fails), or a zero-extent bounding box.
//   It NEVER returns ok=true with a half-filled or fabricated grid.

#ifndef FORGE_NATIVE_MESH_VOXELIZE_HPP
#define FORGE_NATIVE_MESH_VOXELIZE_HPP

#include <cstdint>
#include <vector>

// Named deps (per the module contract) — reused by #include only, never
// re-implemented. Predicates supplies the robust orient2d that guards the
// ray/triangle containment classification; VoxelGrid is the occupancy container;
// HalfEdgeMesh validates closedness; Geom/KdTree3D/SdfTree/IsoMesher are part of
// the shared geometry stack this module sits within.
#include "forge/native/Predicates.hpp"               // orient2d (robust)
#include "forge/native/geom/Geom.hpp"                 // Point2/Point3, convexHull
#include "forge/native/geom/KdTree3D.hpp"             // shared spatial stack
#include "forge/native/mesh/HalfEdgeMesh.hpp"         // Vec3/HalfEdgeMesh/validate
#include "forge/native/voxel/VoxelGrid.hpp"           // VoxelGrid<float> container
#include "forge/native/implicit/SdfTree.hpp"          // shared implicit stack
#include "forge/native/implicit/IsoMesher.hpp"        // shared implicit stack

namespace forge {
namespace native {
namespace mesh {

// Result of a solid voxelization.
//   ok            : true iff a closed mesh was rasterized into a valid grid.
//   reason        : diagnostic string when ok==false (empty on success).
//   grid          : the occupancy field (1.0f at each inside cell's lower-corner
//                   node, else 0.0f). Read it back by counting nodes >= 0.5f over
//                   the CELL index range [0,cellsX)x[0,cellsY)x[0,cellsZ).
//   occupiedCells : number of cells whose centre is inside (the volume count).
//   occupiedVolume: occupiedCells * cellVolume() — the discrete solid volume.
struct VoxelizeResult {
    bool                       ok = false;
    const char*                reason = "";
    forge::native::VoxelGrid<float> grid;
    std::size_t                occupiedCells = 0;
    double                     occupiedVolume = 0.0;
};

// Voxelize a CLOSED triangle soup into an occupancy VoxelGrid at the requested
// cubic `spacing`. The grid's box is the mesh AABB padded by `padCells` cells of
// margin on every side (>= 1 so no surface cell is clipped). `spacing` must be
// > 0 and finite; the mesh must be a watertight 2-manifold. See header notes for
// the exact failure contract (0 FAKES).
VoxelizeResult voxelize(const std::vector<double>& positions,
                        const std::vector<std::uint32_t>& indices,
                        double spacing,
                        int padCells = 2);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_VOXELIZE_HPP
