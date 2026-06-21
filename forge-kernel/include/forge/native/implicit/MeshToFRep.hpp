// forge/native/implicit/MeshToFRep.hpp
//
// In-house mesh -> evaluable implicit FIELD ("F-rep") bridge — an IMPLICIT-stage
// module of KERNEL_INHOUSE_ROADMAP.md. Pure C++20, ZERO external dependencies,
// no OCCT, no WASM, no third-party libs. Standard library + the existing
// forge/native headers only.
//
// WHAT THIS MODULE DOES (the seam it fills)
// -----------------------------------------
// The kernel already ships two adjacent seams:
//   * implicit::IsoMesher contours an Sdf field FORWARD into a triangle Mesh.
//   * implicit::MeshToSDF samples a mesh into a DENSE voxel signed field.
// This module ships the missing OBJECT-LEVEL seam: it wraps a CLOSED triangle
// mesh as a *lazily evaluable* signed-distance field — an implicit::Sdf node —
// with NO voxel grid. The mesh becomes a first-class operand in the SDF
// expression tree, so a scanned/imported mesh can be CSG'd and *blended*
// (smoothUnionOp) against analytic primitives and then re-meshed with IsoMesher.
//
// Concretely, MeshToFRep::build(mesh) returns a handle whose:
//   * eval(p)   = signed distance to the mesh (negative inside, positive
//                 outside) — closest-triangle Euclidean distance for the
//                 MAGNITUDE, ray-parity crossing count for the SIGN.
//   * field()   = an implicit::Sdf wrapping the SAME evaluator, ready to feed
//                 unionOp / intersectionOp / differenceOp / smoothUnionOp and
//                 IsoMesher::march — exactly like sphere()/box()/plane().
//
// ALGORITHM (honest — first increment)
// ------------------------------------
//   MAGNITUDE: closest point on the triangle soup via geom::AABBTree
//     (BVH-accelerated nearest-triangle query). The distance is the EXACT
//     closed-form point-to-triangle Euclidean distance, reduced over the soup by
//     the BVH — O(log n) per query, identical VALUE to a brute-force scan.
//   SIGN (inside negative): PARITY of an axis-aligned-ish ray. We shoot a ray
//     from p along a fixed, slightly-off-axis direction and COUNT how many
//     triangles it crosses (repeatedly advancing past each nearest hit via the
//     BVH ray query). ODD crossings => p is inside the closed surface => the
//     distance is negated. This is the classic Jordan-curve / crossing-number
//     inside test; the off-axis perturbation dodges the measure-zero set of rays
//     that graze a shared edge/vertex. We additionally vote across THREE
//     independent ray directions and take the majority sign, so a single grazing
//     ray cannot flip the classification.
//
// HONESTY / ROBUSTNESS POSTURE (Bible §0/§9 — do NOT overclaim)
//   * The DISTANCE magnitude is the exact Euclidean point-to-triangle distance
//     (closed-form per triangle), reduced over the soup — no sampling error in
//     the field value. The only field-level approximation is the IsoMesher's own
//     marching-cubes O(h^2) chord error when the field is re-meshed.
//   * The SIGN is robust-in-practice for a CLOSED, consistently-wound, 2-manifold
//     mesh. It is decided by ray-crossing PARITY with a multi-ray majority vote;
//     it is NOT a proven-exact in/out classification (that would route every
//     crossing through the exact orient3d predicate with symbolic ray
//     tie-breaking — TARGETED). For an OPEN / non-manifold mesh the parity sign
//     is meaningless and we do NOT pretend otherwise: build() returns ok=false.
//   * 0 FAKES: an empty mesh, an open mesh, a non-manifold mesh, a mesh whose
//     soup the BVH rejects (degenerate / non-finite triangles), or a zero-extent
//     AABB all return ok=false with an honest `reason`. eval()/field() on a
//     failed handle throw — they never fabricate a field.
//
// TARGETED (NOT in this increment — flagged, never faked):
//   * Proven-exact ray-parity sign via forge::native::orient3d with symbolic
//     tie-breaking on edge/vertex grazes. // TODO(exact-sign)
//   * Generalized winding number for a robust sign on OPEN / non-manifold meshes
//     (the parity test requires closure). // TODO(winding-number)
//   * A true EXACT-distance field for blends (the min/max/smin of an exact mesh
//     distance is only a Lipschitz-1 bound, the usual SDF-modeling convention).
//
// CONVENTIONS: namespace forge::native::implicit. Pure C++20, standard library
// only. ZERO external deps, NO OCCT, NO WASM, NO third-party libs.

#ifndef FORGE_NATIVE_IMPLICIT_MESHTOFREP_HPP
#define FORGE_NATIVE_IMPLICIT_MESHTOFREP_HPP

#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>

#include "forge/native/geom/AABBTree.hpp"        // geom::AABBTree (BVH)
#include "forge/native/implicit/IsoMesher.hpp"   // implicit::GridSpec (re-mesh)
#include "forge/native/implicit/SdfTree.hpp"     // implicit::Sdf, Vec3
#include "forge/native/mesh/HalfEdgeMesh.hpp"    // mesh::HalfEdgeMesh, mesh::Vec3

namespace forge {
namespace native {
namespace implicit {

// ---------------------------------------------------------------------------
// MeshFieldEvaluator — the lazily-evaluable mesh signed field.
//
// Holds the BVH (geom::AABBTree) over the mesh soup plus the precomputed ray
// directions for the parity vote. eval(p) returns the signed distance. This is
// a shared, immutable object (shared_ptr) so the same evaluator can back both a
// raw eval() caller and the Sdf node returned by field() with no copies.
// ---------------------------------------------------------------------------
class MeshFieldEvaluator {
public:
    // Construct from an already-validated, BVH-buildable flat soup. Callers
    // should go through MeshToFRep::build() rather than constructing directly;
    // build() performs the closed/manifold validation that makes the sign valid.
    MeshFieldEvaluator(std::vector<double> positions,
                       std::vector<std::uint32_t> indices,
                       geom::AABBTree tree,
                       double diag);

    // Signed distance at p: negative INSIDE the closed mesh, positive outside,
    // ~0 on the surface. Magnitude = exact closest-triangle Euclidean distance.
    double eval(const Vec3& p) const;

    // The axis-aligned bounding box of the source mesh (for grid sizing).
    geom::Aabb bounds() const { return tree_.bounds(); }

    // Diagnostic: bounding-box diagonal length (the ray length used for parity).
    double diagonal() const { return diag_; }

private:
    std::vector<double>        positions_;  // kept so the soup outlives the tree's view
    std::vector<std::uint32_t> indices_;
    geom::AABBTree             tree_;
    double                     diag_;       // AABB diagonal (ray cast length scale)
};

// ---------------------------------------------------------------------------
// Result of wrapping a mesh as an implicit field.
//
//   ok      : true only when a VALID signed field was produced. false (and
//             `field` empty / `eval` unusable) on a degenerate input — an empty
//             mesh, an OPEN or NON-MANIFOLD mesh (the parity sign would be
//             meaningless), a soup the BVH rejects, or a zero-extent AABB.
//             Honest failure; never a fabricated field.
//   eval    : the shared evaluator (null when ok==false).
//   field() : an implicit::Sdf wrapping `eval`, ready to compose with the SDF
//             tree ops and IsoMesher. Empty Sdf when ok==false.
//   closed/manifold : the audited topology flags (both true on success).
//   numTriangles : triangle count consumed (diagnostic).
//   reason  : short human-readable cause when ok == false ("" on success).
// ---------------------------------------------------------------------------
struct MeshFRepResult {
    bool ok = false;
    std::shared_ptr<const MeshFieldEvaluator> eval{};
    bool closed = false;
    bool manifold = false;
    std::size_t numTriangles = 0;
    const char* reason = "";

    // The evaluable implicit field. Composes with unionOp / intersectionOp /
    // differenceOp / smoothUnionOp and IsoMesher::march. Empty when ok==false.
    Sdf field() const;
};

// ---------------------------------------------------------------------------
// MeshToFRep — wrap a closed mesh as an evaluable implicit field.
// ---------------------------------------------------------------------------
class MeshToFRep {
public:
    // Wrap `mesh` (a closed, 2-manifold, consistently-wound triangle mesh) as an
    // implicit signed field. Returns ok=false (empty field) on a degenerate or
    // unsupported input — empty / open / non-manifold mesh, a soup the BVH
    // rejects, or a zero-extent bounding box. Honest failure; never fabricated.
    static MeshFRepResult build(const mesh::HalfEdgeMesh& mesh);

    // Convenience: a default GridSpec that comfortably contains `eval`'s mesh
    // with `margin`-cell padding and `n` cells along the LONGEST axis (the other
    // axes scaled to keep cells ~cubic). Useful for re-meshing the field with
    // IsoMesher::march. The returned grid box pads the mesh AABB so the zero
    // isosurface stays strictly interior (a closed re-contour).
    static GridSpec defaultGrid(const MeshFieldEvaluator& eval,
                                int n = 32, int marginCells = 3);
};

} // namespace implicit
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_IMPLICIT_MESHTOFREP_HPP
