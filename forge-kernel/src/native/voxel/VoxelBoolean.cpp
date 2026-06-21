// forge/native/voxel/VoxelBoolean.cpp
//
// Implementation of the PicoGK-class voxel-field CSG declared in
// forge/native/voxel/VoxelBoolean.hpp. See that header for the honest scope /
// exactness caveat / TARGETED remainder.
//
// This file owns ONLY:
//   * the alignment precondition check (two grids name the same lattice),
//   * the node-wise min / max / max(a,-b) combine into a NEW VoxelGrid<float>,
//   * the enclosed-volume hand-off to the already-validated VoxelGrid measure,
//   * the contour hand-off to the SHARED voxel->mesh bridge,
//   * the closed-form sphere-sphere CSG volume oracles for the gate.
//
// The dense field engine, trilinear sampler and volume measure all live in
// voxel/VoxelGrid.hpp (#include); the iso-surface mesher lives behind
// voxel/VoxelMesh.hpp (#include). No field engine, no mesher, no mesh type is
// duplicated here.
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#include "forge/native/voxel/VoxelBoolean.hpp"

#include <algorithm>   // std::min, std::max
#include <cmath>       // std::fabs, M_PI fallback

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace forge {
namespace native {
namespace voxel {

// ---------------------------------------------------------------------------
// Alignment: the two grids must name the SAME lattice so node (i,j,k) of A and
// of B is the SAME world point. We require identical node dims (exact integer
// equality), and origins + spacing equal within `tol` world units. We never
// resample to paper over a mismatch (TARGETED: regrid).
// ---------------------------------------------------------------------------
bool VoxelBoolean::aligned(const VoxelGrid<float>& a, const VoxelGrid<float>& b,
                           double tol) {
    if (a.nx() != b.nx() || a.ny() != b.ny() || a.nz() != b.nz())
        return false;
    if (std::fabs(a.spacing() - b.spacing()) > tol)
        return false;
    const native::Vec3& oa = a.origin();
    const native::Vec3& ob = b.origin();
    if (std::fabs(oa.x - ob.x) > tol) return false;
    if (std::fabs(oa.y - ob.y) > tol) return false;
    if (std::fabs(oa.z - ob.z) > tol) return false;
    return true;
}

namespace {

// Make an empty result-grid that shares A's lattice, ready for node-wise fill.
// (Caller has already verified alignment, so A and B share this lattice.)
VoxelGrid<float> makeLike(const VoxelGrid<float>& a) {
    return VoxelGrid<float>(a.nx(), a.ny(), a.nz(), a.origin(), a.spacing(),
                            /*fill=*/0.0f);
}

// Apply a binary node-wise combine over two aligned grids into a fresh grid.
template <typename Op>
BooleanResult combine(const VoxelGrid<float>& a, const VoxelGrid<float>& b, Op op) {
    BooleanResult r;
    if (!VoxelBoolean::aligned(a, b)) {
        // Honest precondition failure: not aligned. Leave r.grid empty, ok=false.
        // (BooleanResult::grid is default-constructed 0x0x0.)
        r.ok = false;
        return r;
    }
    VoxelGrid<float> out = makeLike(a);
    const std::vector<float>& da = a.data();
    const std::vector<float>& db = b.data();
    std::vector<float>& dout = out.data();
    const std::size_t n = dout.size();   // == da.size() == db.size() (aligned)
    for (std::size_t i = 0; i < n; ++i) {
        dout[i] = static_cast<float>(op(double(da[i]), double(db[i])));
    }
    r.grid = std::move(out);
    r.ok = true;
    return r;
}

} // namespace

// f = min(a, b)  — union.
BooleanResult VoxelBoolean::unite(const VoxelGrid<float>& a, const VoxelGrid<float>& b) {
    return combine(a, b, [](double fa, double fb) { return std::min(fa, fb); });
}

// f = max(a, b)  — intersection.
BooleanResult VoxelBoolean::intersect(const VoxelGrid<float>& a, const VoxelGrid<float>& b) {
    return combine(a, b, [](double fa, double fb) { return std::max(fa, fb); });
}

// f = max(a, -b) — difference A \ B.
BooleanResult VoxelBoolean::subtract(const VoxelGrid<float>& a, const VoxelGrid<float>& b) {
    return combine(a, b, [](double fa, double fb) { return std::max(fa, -fb); });
}

// Enclosed volume via the already-validated VoxelGrid midpoint-Riemann measure.
// Solid = sub-level set { field <= iso } (negative-inside SDF convention).
double VoxelBoolean::enclosedVolume(const VoxelGrid<float>& grid, double iso) {
    return grid.occupiedVolumeByCenter(iso, /*insideIsLeq=*/true);
}

// Mesh the (boolean) field via the SHARED voxel->mesh bridge (no duplicate
// mesher). Delegation only; honesty (ok==false on a non-manifold soup) is
// inherited from VoxelMesh::contour.
ContourResult VoxelBoolean::contour(const VoxelGrid<float>& grid, double iso) {
    return VoxelMesh::contour(grid, iso);
}

// ---------------------------------------------------------------------------
// Closed-form sphere-sphere CSG volume oracles.
// ---------------------------------------------------------------------------
double sphereVolume(double r) {
    return (4.0 / 3.0) * M_PI * r * r * r;
}

// Volume of a spherical cap of height h cut from a sphere of radius r:
//   V = pi * h^2 * (3r - h) / 3,   valid for 0 <= h <= 2r.
double sphericalCapVolume(double r, double h) {
    if (h <= 0.0) return 0.0;
    if (h >= 2.0 * r) return sphereVolume(r);
    return M_PI * h * h * (3.0 * r - h) / 3.0;
}

// Intersection (lens) volume of two EQUAL-radius spheres whose centers are a
// distance d apart. Two equal caps of height h = r - d/2.
//   d <= 0      -> fully coincident -> one whole sphere.
//   d >= 2r     -> disjoint        -> 0.
double lensVolumeEqualSpheres(double r, double d) {
    if (d <= 0.0)        return sphereVolume(r);
    if (d >= 2.0 * r)    return 0.0;
    const double h = r - d / 2.0;            // cap height, in (0, r]
    return 2.0 * sphericalCapVolume(r, h);
}

// Union of two equal spheres: 2V_sphere - V_lens (inclusion-exclusion).
double unionVolumeEqualSpheres(double r, double d) {
    return 2.0 * sphereVolume(r) - lensVolumeEqualSpheres(r, d);
}

// Difference A \ B of two equal spheres: V_sphere - V_lens.
double differenceVolumeEqualSpheres(double r, double d) {
    return sphereVolume(r) - lensVolumeEqualSpheres(r, d);
}

} // namespace voxel
} // namespace native
} // namespace forge
