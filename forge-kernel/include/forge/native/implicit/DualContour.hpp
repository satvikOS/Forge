// forge/native/implicit/DualContour.hpp
//
// In-house DUAL CONTOURING of a signed-distance field — Stage 4 of
// KERNEL_INHOUSE_ROADMAP.md (the roadmap's named "dual contouring for feature
// preservation" follow-on to the marching-cubes IsoMesher).
//
// WHY DUAL CONTOURING (vs the existing marching cubes)
// ----------------------------------------------------
// Marching cubes (IsoMesher.hpp) places vertices ONLY on grid edges, by linear
// interpolation along each edge. Where the true surface has a SHARP edge or
// corner (a box, a CSG difference, a chamfer), the nearest surface point inside
// a cell is generally NOT on a grid edge — it is in the cell interior — so
// marching cubes cannot represent it and ROUNDS the feature off (the corner is
// chopped into a bevel of facets). Dual contouring instead places ONE vertex
// PER CELL, positioned by minimising a Quadratic Error Function (QEF) built from
// the surface's tangent planes at every edge crossing of that cell. Because each
// tangent plane is (Hermite) data — a surface point AND the surface normal there
// — the QEF minimiser lands on the sharp corner/edge where several planes meet,
// reproducing it crisply. This is the Ju-Losasso-Schaefer-Warren (2002) scheme.
//
// HERMITE DATA FROM THE SDF
// -------------------------
//   * surface point on an edge: the SDF zero-crossing, found by linear
//     interpolation of f between the two grid corners (a root of the locally
//     linear field — the same crossing point marching cubes uses).
//   * surface normal there: the SDF GRADIENT (central differences), which for a
//     distance field is the unit outward normal. REUSES Sdf::gradient — no new
//     SDF machinery, no duplicate primitive code.
//
// THE QEF AND ITS SOLVE (honest robustness statement)
// ---------------------------------------------------
// For a cell we collect planes (p_i, n_i); the vertex x minimises
//   E(x) = sum_i ( n_i . (x - p_i) )^2 .
// The normal equations are A^T A x = A^T b with A rows = n_i, b_i = n_i . p_i.
// A^T A is a symmetric 3x3 matrix; we solve it via a TRUNCATED SVD
// (eigen-decomposition of the 3x3 symmetric normal matrix by the analytic /
// Jacobi route), dropping singular directions below a relative threshold and
// solving only in the well-conditioned subspace, with the cell-centroid (mass
// point) of the edge crossings as the base point for the under-determined
// directions. This is exactly the regularisation Ju et al. recommend so a flat
// region (one dominant normal direction) does not send the vertex to infinity.
// The result is finally CLAMPED to the cell's bounding box — the standard guard
// against an ill-posed QEF placing the vertex far outside its cell.
//
// HONESTY (Bible §0/§9, roadmap Stage 4)
// --------------------------------------
// REAL + VALIDATED here (see test/native/implicit/dualcontour_test.cpp):
//   * a BOX SDF reconstructs with SHARP corners — dual-contour vertices land on
//     the true box faces/edges/corners, and the corner-sharpness metric is
//     MEASURABLY better (smaller max corner-rounding error) than marching cubes
//     at the SAME grid resolution (both run, both measured, MC is the baseline).
//   * a SPHERE SDF still encloses volume ≈ 4/3·π·r³ (the smooth case is not
//     regressed by the sharp-feature machinery).
//   * the output is a CLOSED mesh (every interior grid edge that changes sign
//     contributes exactly one quad joining its four incident cells; the boundary
//     of the sampling box is not crossed because the field is meshed strictly
//     inside it).
//
// ROBUSTNESS LEVEL, stated plainly: *robust-in-practice*, NOT proven-exact.
//   - The zero-crossing and the normal both come from FINITE-DIFFERENCE sampling
//     of the SDF, so they carry O(h) Hermite error; the recovered corner is
//     therefore near the true corner within a tolerance that shrinks with the
//     grid, not bit-exact.
//   - Dual contouring on a uniform grid (no octree) can self-intersect on very
//     thin features relative to the cell size; we do NOT claim a manifold
//     guarantee here. Manifold-guaranteeing variants (Manifold Dual Contouring,
//     octree adaptivity) are TARGETED — see the header TODO. The closed-surface
//     property (no boundary edges) IS produced and is checked by the test.
//
// RELATIONSHIP TO forge::native::Predicates:
//   Like marching cubes, the ONLY combinatorial decision is the sign of f at a
//   grid corner (a single double comparison), so the exact orientation/in-sphere
//   predicates are not required and are intentionally not used. (They are the
//   robust substrate for the Stage-2 mesh-boolean/arrangement code, not for a
//   sampling mesher.) Honest "not needed here", not a silent omission.
//
// REUSE: this file adds NO new SDF type and NO new mesh type. It includes
// SdfTree.hpp (the shared Sdf / Vec3) and IsoMesher.hpp (the shared Mesh /
// GridSpec, and — for the comparison test — marching cubes itself). No
// duplication.
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#ifndef FORGE_NATIVE_IMPLICIT_DUALCONTOUR_HPP
#define FORGE_NATIVE_IMPLICIT_DUALCONTOUR_HPP

#include "forge/native/implicit/SdfTree.hpp"   // Sdf, Vec3 (REUSED — no duplicate SDF)
#include "forge/native/implicit/IsoMesher.hpp" // Mesh, GridSpec (REUSED — no duplicate mesh type)

namespace forge {
namespace native {
namespace implicit {

// Dual-contouring mesher. Same input surface (an Sdf) and same output Mesh type
// as the marching-cubes IsoMesher, so the two can be compared head-to-head on
// the identical grid.
class DualContour {
public:
    // Extract the {f = isovalue} surface of `sdf` over `grid` by dual
    // contouring. One vertex per sign-changing cell (placed by the QEF solve),
    // quads dual to each sign-changing interior grid edge, triangulated.
    //
    // `gradH` is the finite-difference step used to sample the surface normal
    // (the SDF gradient). Defaults to a small fraction of the cell size when 0.
    static Mesh contour(const Sdf& sdf, const GridSpec& grid,
                        double isovalue = 0.0, double gradH = 0.0);

    // Convenience: cubic grid of `n` cells per axis over [min,max], then contour.
    static Mesh contourCubic(const Sdf& sdf, const Vec3& min, const Vec3& max,
                             int n, double isovalue = 0.0, double gradH = 0.0);
};

} // namespace implicit
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_IMPLICIT_DUALCONTOUR_HPP
