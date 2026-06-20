// forge/native/voxel/VoxelMesh.cpp
//
// Implementation of the voxel -> half-edge surface mesh bridge declared in
// forge/native/voxel/VoxelMesh.hpp. See that header for the honest scope /
// robustness statement and the TARGETED remainder.
//
// This file owns ONLY the glue: present the voxel grid to the SHARED
// implicit::IsoMesher (no duplicate marching cubes here) and convert its
// indexed-soup output into the canonical mesh::HalfEdgeMesh (no duplicate mesh
// type). The marching-cubes tables, the trilinear sampler, the half-edge
// adjacency build + validity audit all live in the modules we #include.
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#include "forge/native/voxel/VoxelMesh.hpp"

#include <vector>
#include <cstdint>

namespace forge {
namespace native {
namespace voxel {

ContourResult VoxelMesh::contour(const VoxelGrid<float>& grid, double isovalue) {
    ContourResult result;

    // --- 1. Present the voxel grid to the SHARED iso-surface mesher ----------
    //
    // The grid's sampling box runs over its CELLS: cellsX()*cellsY()*cellsZ()
    // marching-cubes cells, one per voxel cell, so the mesher resolves the field
    // at exactly the grid's resolution. The box is
    //   [origin, origin + (cells * spacing)]  per axis.
    GridFieldSdf adapter(grid);
    implicit::Sdf field(std::make_shared<GridFieldSdf>(grid));

    const native::Vec3 o = grid.origin();
    const double s = grid.spacing();
    implicit::GridSpec spec;
    spec.min = implicit::Vec3{o.x, o.y, o.z};
    spec.max = implicit::Vec3{o.x + double(grid.cellsX()) * s,
                              o.y + double(grid.cellsY()) * s,
                              o.z + double(grid.cellsZ()) * s};
    spec.nx = static_cast<int>(grid.cellsX());
    spec.ny = static_cast<int>(grid.cellsY());
    spec.nz = static_cast<int>(grid.cellsZ());

    // IsoMesher's INSIDE test is f < isovalue (negative inside), matching the
    // VoxelGrid { field <= iso } solid convention. Outward-facing winding (the
    // mesher already reverses to outward) gives a POSITIVE signedVolume().
    const implicit::Mesh soup = implicit::IsoMesher::march(field, spec, isovalue);

    // (void) the stack adapter — `field` owns its own shared GridFieldSdf; the
    // local `adapter` is retained only as documentation of the wrapped type and
    // to keep the grid pointer's lifetime obviously tied to this scope.
    (void)adapter;

    // --- 2. Convert the shared mesher's indexed soup -> HalfEdgeMesh ----------
    //
    // implicit::Mesh is already a shared-vertex indexed soup (edge-keyed
    // de-duplication in IsoMesher). Flatten it into the (positions, indices)
    // form HalfEdgeMesh::buildFromSoup consumes. buildFromSoup ENFORCES
    // 2-manifold / consistent-winding input and returns false on a non-manifold
    // soup (the marching-cubes ambiguous-saddle failure mode) — we surface that
    // honestly as result.ok == false rather than fabricating a mesh.
    std::vector<double> positions;
    positions.reserve(soup.positions.size() * 3);
    for (const implicit::Vec3& p : soup.positions) {
        positions.push_back(p.x);
        positions.push_back(p.y);
        positions.push_back(p.z);
    }

    std::vector<std::uint32_t> indices;
    indices.reserve(soup.triangles.size() * 3);
    for (const std::array<int, 3>& t : soup.triangles) {
        indices.push_back(static_cast<std::uint32_t>(t[0]));
        indices.push_back(static_cast<std::uint32_t>(t[1]));
        indices.push_back(static_cast<std::uint32_t>(t[2]));
    }

    result.ok = result.mesh.buildFromSoup(positions, indices);
    if (!result.ok) {
        // Non-manifold / inconsistent-winding soup (TARGETED: MC33). Leave the
        // mesh empty and the report default; the caller sees ok == false.
        result.mesh = mesh::HalfEdgeMesh{};
        result.report = mesh::ValidityReport{};
        return result;
    }

    result.report = result.mesh.validate();
    return result;
}

} // namespace voxel
} // namespace native
} // namespace forge
