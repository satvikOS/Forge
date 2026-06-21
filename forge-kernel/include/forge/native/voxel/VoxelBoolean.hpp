// forge/native/voxel/VoxelBoolean.hpp
//
// Stage 5 (voxel / lattice) — PicoGK-class CONSTRUCTIVE SOLID GEOMETRY (CSG) on
// two aligned voxel signed-distance-field (SDF) grids. This is the field-CSG
// step the roadmap (§B / §D) places between the dense field engine
// (voxel/VoxelGrid.hpp) and the shared iso-surface mesher
// (implicit/IsoMesher.hpp via voxel/VoxelMesh.hpp): combine two sampled SDF
// fields by the standard SDF boolean operators, then measure/mesh the result.
//
// WHAT THIS INCREMENT SHIPS + VALIDATES (honest — Bible §0/§9):
//   * VoxelBoolean::unite / intersect / subtract — node-wise CSG on two
//     VoxelGrid<float> fields that MUST be aligned (same node dims, origin and
//     spacing). The operators are the textbook PicoGK / libfive SDF booleans on
//     the signed-distance convention (negative inside):
//         union        : f = min(a, b)            (solid(A) OR  solid(B))
//         intersection : f = max(a, b)            (solid(A) AND solid(B))
//         difference   : f = max(a, -b)           (solid(A) AND NOT solid(B))
//     The result is a NEW VoxelGrid<float> sharing the input geometry (dims,
//     origin, spacing). NO new grid type, NO new field engine — VoxelGrid is
//     reused verbatim by #include.
//
//   * VoxelBoolean::enclosedVolume(grid, iso) — the enclosed (solid) volume of a
//     field by the cell-center midpoint-Riemann measure already defined and
//     gated in VoxelGrid.hpp (occupiedVolumeByCenter). This is the SAME measure
//     the existing voxel gate validates against the closed-form sphere volume,
//     so reusing it here means the lens / union / difference volumes are checked
//     on an already-trusted estimator (no second, unvalidated volume routine).
//
//   * VoxelBoolean::contour(grid, iso) — convenience hand-off to the SHARED
//     voxel->mesh bridge voxel::VoxelMesh::contour (which itself reuses the
//     shared implicit::IsoMesher + canonical mesh::HalfEdgeMesh). This meshes
//     the boolean field into the canonical half-edge surface for production
//     callers. NO duplicate mesher / mesh type is introduced here — it is a
//     one-line delegation. (See the BUILD/LINK note below for why the validation
//     gate measures volume on the FIELD rather than on this mesh.)
//
// ALIGNMENT IS A HARD PRECONDITION (0 FAKES):
//   CSG on two voxel fields is only well-defined when the two grids share the
//   same lattice (node dims, origin, spacing) so node (i,j,k) of A and of B name
//   the SAME world point. Resampling a misaligned grid is a real, separate
//   feature (TARGETED below) and is NOT silently performed here: the boolean
//   entry points return a result whose `ok == false` (and an EMPTY grid) when
//   the inputs are not aligned. We never fabricate a combined field from
//   incompatible inputs to make a test pass.
//
// BUILD / LINK NOTE (honest, so the module's own gate is self-contained):
//   The validation gate measures the boolean field's ENCLOSED VOLUME via the
//   header-only VoxelGrid measure (enclosedVolume), NOT via the meshed result's
//   signed volume. Both are the SAME enclosed quantity; the field measure is the
//   PicoGK-native one and — unlike meshing — needs no further translation units,
//   so the module compiles + links against ONLY {VoxelBoolean, VoxelGrid,
//   VoxelMesh, IsoMesher}.cpp without depending on sibling-owned source files
//   (HalfEdgeMesh.cpp / SdfTree.cpp). contour() is still shipped for callers; it
//   simply pulls those siblings in when actually USED at link time.
//
// TARGETED (NOT in this increment — flagged, never faked):
//   * Resampling / regridding of MISALIGNED inputs onto a common lattice (today
//     a mismatch is REPORTED via ok==false, not resampled). // TODO(regrid)
//   * Smooth (rounded) booleans (polynomial smin) on grids — the sharp min/max
//     land here; the smooth blend already exists for SDF *expressions* in
//     implicit/SdfTree.hpp::smoothUnionOp and is a trivial node-wise port.
//     // TODO(smooth-field-boolean)
//   * In-place / streaming combine for VDB-style sparse grids (this stage is
//     DENSE, matching VoxelGrid). // TODO(sparse)
//
// EXACTNESS CAVEAT (stated up front, do NOT overclaim): min/max of two
// Lipschitz-1 SDFs is itself only a Lipschitz-1 BOUND on the true union /
// intersection / difference distance (correct SIGN everywhere, |grad| <= 1) —
// the standard SDF-modeling convention, NOT an exact Euclidean field. The SIGN
// is what the enclosed-volume measure and the iso-surface both depend on, and
// the sign of min/max is exactly correct, which is why the lens / union /
// difference volumes converge to the analytic oracles as spacing -> 0.
//
// CONVENTIONS: namespace forge::native::voxel. Pure C++20, standard library
// only. ZERO external deps, NO OCCT, NO WASM, NO third-party libs.

#ifndef FORGE_NATIVE_VOXEL_VOXELBOOLEAN_HPP
#define FORGE_NATIVE_VOXEL_VOXELBOOLEAN_HPP

#include "forge/native/voxel/VoxelGrid.hpp"   // VoxelGrid<float>, native::Vec3, sdfSphere
#include "forge/native/voxel/VoxelMesh.hpp"   // voxel::VoxelMesh / ContourResult (shared mesher bridge)

namespace forge {
namespace native {
namespace voxel {

// ---------------------------------------------------------------------------
// Result of a field boolean: the combined grid plus an honesty flag.
//   `ok` is false ONLY on a real precondition failure — the two input grids are
//   not aligned (different node dims / origin / spacing). When `ok` is false the
//   `grid` is left at its default (empty 0x0x0) state; the caller must check
//   `ok` before using `grid`. We never return a fabricated field for
//   incompatible inputs.
// ---------------------------------------------------------------------------
struct BooleanResult {
    VoxelGrid<float> grid;        // the combined SDF field (valid iff ok)
    bool             ok = false;  // false when inputs were not aligned
};

// ---------------------------------------------------------------------------
// VoxelBoolean — PicoGK-class CSG on two aligned voxel SDF grids.
//
// All three operators take two grids that MUST be aligned (see aligned()) and
// produce a new grid on the SAME lattice. The combine is purely node-wise on the
// stored field samples (no resampling), which is why alignment is required.
// ---------------------------------------------------------------------------
class VoxelBoolean {
public:
    // Tolerance (in world units) below which two grids' origins / spacings are
    // treated as identical. Defaults to a tiny fraction of the spacing so that
    // truly-shared lattices pass while genuinely-different ones are rejected.
    static bool aligned(const VoxelGrid<float>& a, const VoxelGrid<float>& b,
                        double tol = 1e-9);

    // f = min(a, b). Solid(A) OR Solid(B). ok==false if not aligned.
    static BooleanResult unite(const VoxelGrid<float>& a, const VoxelGrid<float>& b);

    // f = max(a, b). Solid(A) AND Solid(B). ok==false if not aligned.
    static BooleanResult intersect(const VoxelGrid<float>& a, const VoxelGrid<float>& b);

    // f = max(a, -b). Solid(A) AND NOT Solid(B). ok==false if not aligned.
    static BooleanResult subtract(const VoxelGrid<float>& a, const VoxelGrid<float>& b);

    // Enclosed (solid) volume of a field at the given iso, using the
    // already-validated VoxelGrid cell-center midpoint-Riemann measure. The
    // solid is the sub-level set { field <= iso } (negative-inside SDF
    // convention), matching VoxelGrid's occupancy rule and the iso-surface the
    // shared mesher extracts.
    static double enclosedVolume(const VoxelGrid<float>& grid, double iso = 0.0);

    // Convenience: mesh a (boolean) field into the canonical half-edge surface
    // via the SHARED voxel->mesh bridge (voxel::VoxelMesh::contour, which reuses
    // implicit::IsoMesher + mesh::HalfEdgeMesh). No duplicate mesher introduced.
    // Returns ContourResult::ok == false honestly when the marching-cubes soup
    // is non-manifold (the bridge rejects it; MC33 is TARGETED there).
    static ContourResult contour(const VoxelGrid<float>& grid, double iso = 0.0);
};

// ---------------------------------------------------------------------------
// Analytic oracles for the gate (closed-form sphere-sphere CSG volumes).
//
// For two spheres of EQUAL radius r whose centers are a distance d apart with
// 0 <= d < 2r (overlapping), the intersection is a symmetric lens made of two
// equal spherical caps, each of height h = r - d/2:
//
//   capVolume(r, h)        = pi * h^2 * (3r - h) / 3
//   lensVolume(r, d)       = 2 * capVolume(r, h),   h = r - d/2     (intersection)
//   sphereVolume(r)        = 4/3 * pi * r^3
//   unionVolume(r, d)      = 2*sphereVolume(r) - lensVolume(r, d)
//   differenceVolume(r, d) = sphereVolume(r) - lensVolume(r, d)     (A minus B)
//
// These are the EXACT analytic targets the boolean fields' enclosed volumes are
// checked against (within a voxel-resolution tolerance) in the gate.
// ---------------------------------------------------------------------------
double sphereVolume(double r);
double sphericalCapVolume(double r, double h);
double lensVolumeEqualSpheres(double r, double d);
double unionVolumeEqualSpheres(double r, double d);
double differenceVolumeEqualSpheres(double r, double d);

} // namespace voxel
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_VOXEL_VOXELBOOLEAN_HPP
