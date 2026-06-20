// forge/native/voxel/VoxelMesh.hpp
//
// Stage 5 (voxel / lattice) — the VOXEL -> SURFACE MESH bridge, finishing the
// "voxel->mesh" TARGETED item left open by VoxelGrid.hpp. This is the
// consolidation step the roadmap calls for (§B / §D): a voxel field is meshed by
// the SAME shared iso-surface mesher the implicit (SDF) stage already ships, and
// the result is delivered as the canonical in-house mesh type so every stage
// converges on ONE mesh representation.
//
// WHAT THIS INCREMENT SHIPS + VALIDATES (honest — Bible §0/§9):
//   * VoxelMesh::contour(grid, isovalue) — extract the {f = isovalue} surface of
//     a VoxelGrid<float> and return a forge::native::mesh::HalfEdgeMesh.
//   * REUSE, no duplication:
//       - the dense field + trilinear sampler   : voxel/VoxelGrid.hpp (#include)
//       - the marching-cubes lookup + interp    : implicit/IsoMesher.hpp (the
//         shared mesher; the grid is wrapped as an Sdf so the SAME march() runs)
//       - the half-edge mesh + validity audit   : mesh/HalfEdgeMesh.hpp (#include)
//     No new mesher, no new grid, no new mesh type, no re-declared predicate.
//   * VALIDATED in test/native/voxel/voxelmesh_test.cpp:
//       (1) a voxelized SDF sphere contours to a CLOSED, 2-manifold mesh whose
//           enclosed (signed) volume -> 4/3·π·r³ as the spacing shrinks (the
//           error decreases under refinement). Oracle: closed-form sphere volume.
//       (2) a gyroid TPMS field contours to a CONNECTED, 2-manifold surface.
//
// HOW THE SHARED MESHER IS REUSED (no duplicate marching cubes):
//   The grid is sampled by trilinear interpolation through a thin Sdf adapter
//   (GridFieldSdf, below) whose eval(p) == grid.sample(p). IsoMesher::march then
//   meshes that adapter over the grid's own box at one cell-per-voxel-cell. The
//   mesher's edge-keyed vertex de-duplication already yields a shared-vertex
//   indexed soup; we hand that soup to HalfEdgeMesh::buildFromSoup, which builds
//   the half-edge adjacency AND enforces 2-manifold/consistent-winding input
//   (it fails loudly on a non-manifold soup — never silently repairs). So the
//   manifold guarantee in the gate is a REAL audit of buildFromSoup + validate(),
//   not an assumption.
//
// ROBUSTNESS LEVEL (stated up front, do NOT overclaim): robust-in-practice.
//   Marching cubes is a SAMPLING mesher; the surface carries the standard
//   O(h^2) chordal/iso error in the cell size h, and sharp features are softened
//   at low resolution (dual contouring is the future fix — TARGETED). For the
//   smooth fields meshed here (an SDF sphere, a gyroid) over a sampling grid that
//   resolves them, the classic Lorensen-Cline triangulation yields a closed,
//   edge-2-manifold surface, which the gate AUDITS via HalfEdgeMesh::validate().
//   This is NOT a proof of manifoldness for every possible field/grid: the known
//   marching-cubes failure mode is the AMBIGUOUS-FACE / saddle configuration,
//   where the unmodified Lorensen-Cline table can emit a non-manifold edge. When
//   that occurs, buildFromSoup() returns false (the soup is rejected) rather than
//   producing a fake mesh — the caller sees a hard failure. Hardening the
//   ambiguous cases (an MC33 / asymptotic-decider table, or dual contouring) is
//   TARGETED. See the TARGETED list below.
//
// TARGETED (NOT in this increment — flagged, never faked):
//   * MC33 / asymptotic-decider disambiguation of saddle cells (the only source
//     of a non-manifold marching-cubes soup; today such a soup is REJECTED by
//     buildFromSoup rather than meshed). // TODO(mc33)
//   * Dual contouring for sharp-feature preservation (roadmap Stage 4 note).
//   * Open-surface handling: a field whose solid touches the grid boundary
//     produces an OPEN surface (the box face is not capped here). The gate keeps
//     the sphere strictly interior (voxelizeSphere pads margin cells) so the
//     result is closed; capping a clipped field is TARGETED (mesh/MeshBoolean
//     planeClip is the future capper). // TODO(cap-boundary)
//   * Anisotropic spacing (VoxelGrid is isotropic this increment).
//
// CONVENTIONS: namespace forge::native::voxel. Pure C++20, standard library
// only. ZERO external deps, NO OCCT, NO WASM, NO third-party libs.

#ifndef FORGE_NATIVE_VOXEL_VOXELMESH_HPP
#define FORGE_NATIVE_VOXEL_VOXELMESH_HPP

#include "forge/native/voxel/VoxelGrid.hpp"        // VoxelGrid<float>, native::Vec3
#include "forge/native/mesh/HalfEdgeMesh.hpp"      // mesh::HalfEdgeMesh (the target type)
#include "forge/native/implicit/IsoMesher.hpp"     // implicit::IsoMesher (the shared mesher)
#include "forge/native/implicit/SdfTree.hpp"       // implicit::Sdf / SdfNode (grid adapter)

namespace forge {
namespace native {
namespace voxel {

// ---------------------------------------------------------------------------
// Result of a contour: the meshed surface plus a copy of its validity audit so
// callers (and the gate) can assert manifold/watertight without re-walking.
//   `ok` is false when the marching-cubes soup was non-manifold and therefore
//   REJECTED by HalfEdgeMesh::buildFromSoup (never silently repaired). When `ok`
//   is false `mesh` is empty and `report` is default (all-false).
// ---------------------------------------------------------------------------
struct ContourResult {
    mesh::HalfEdgeMesh   mesh;
    mesh::ValidityReport report;
    bool                 ok = false;
};

// ---------------------------------------------------------------------------
// VoxelMesh — voxel field -> half-edge surface mesh, via the shared IsoMesher.
// ---------------------------------------------------------------------------
class VoxelMesh {
public:
    // Extract the {field = isovalue} iso-surface of `grid` as a HalfEdgeMesh.
    //
    // Convention (matching VoxelGrid's occupancy rule): the SOLID is the
    // sub-level set { field <= isovalue } (negative-inside SDF convention), so
    // the emitted triangles wind CCW seen from OUTSIDE the solid and the mesh's
    // signedVolume() is POSITIVE for the enclosed volume.
    //
    // The grid is meshed at ONE marching-cubes cell per voxel CELL over the
    // grid's own box, by wrapping the grid's trilinear sampler as an Sdf and
    // running the shared implicit::IsoMesher (no duplicate mesher).
    static ContourResult contour(const VoxelGrid<float>& grid, double isovalue = 0.0);
};

// ---------------------------------------------------------------------------
// GridFieldSdf — the thin adapter that lets the SHARED implicit mesher read a
// voxel grid. eval(p) == grid.sample(p) (trilinear). This is the whole reason
// no second marching-cubes routine is needed: the voxel field is presented to
// implicit::IsoMesher::march exactly like any other Sdf.
//
// (Exposed in the header so the adapter is testable / reusable, but the normal
// entry point is VoxelMesh::contour.)
// ---------------------------------------------------------------------------
class GridFieldSdf : public implicit::SdfNode {
public:
    explicit GridFieldSdf(const VoxelGrid<float>& grid) : grid_(&grid) {}

    double eval(const implicit::Vec3& p) const override {
        // implicit::Vec3 -> native::Vec3 (the grid's point type). Distinct POD
        // structs across the two stages; convert field-by-field (no shared math
        // header yet — // TODO(shared-math)).
        return grid_->sample(native::Vec3{p.x, p.y, p.z});
    }

private:
    const VoxelGrid<float>* grid_;
};

} // namespace voxel
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_VOXEL_VOXELMESH_HPP
