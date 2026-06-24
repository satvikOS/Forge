// forge/native/voxel/VoxelFieldOps.hpp
//
// Stage 5 (voxel / lattice) — the PicoGK-class VOXEL-FIELD op set that the
// Wave-0 voxel harvest was MISSING. The harvest already shipped:
//   * voxel/Morphology.hpp   : OFFSET / dilate / erode / open / close
//                              (the exact level-set offset f' = f - d == PicoGK
//                              `Offset`),
//   * voxel/VoxelBoolean.hpp : SHARP min/max booleans (union/intersect/subtract),
//   * voxel/VoxelMesh.hpp     : voxel -> HalfEdgeMesh contour (the surface
//                              extraction == PicoGK `RenderMesh`-ish read-out),
//   * implicit/MeshToSDF.hpp  : mesh -> signed-distance grid (PicoGK
//                              `RenderMesh`-INTO-voxels, the reverse seam).
//
// What was MISSING from that harvest, and is filled HERE (additive, no edits to
// any existing file), all as exact node-wise ARITHMETIC on the float SDF samples
// a VoxelGrid<float> already stores (reuse-by-include, no new grid/mesher/mesh):
//
//   (A) OFFSET  — re-exposed as VoxelFieldOps::offset for a single PicoGK-named
//       field-op surface. Identical level-set identity f' = f - d as
//       Morphology::offset (delegates to the SAME arithmetic; no second
//       implementation). d > 0 grows the solid (sphere radius R -> R+d), d < 0
//       shrinks it. This is here so callers reach the whole PicoGK field-op set
//       through ONE header; it adds no new behaviour beyond Morphology.
//
//   (B) SHELL / HOLLOW — the PicoGK `Shell` / OpenVDB level-set "thin-shell":
//       from a solid SDF f, the field of a uniform-thickness t shell straddling
//       the original surface is, EXACTLY for a distance field,
//
//                 f_shell(p) = |f(p)| - t/2.
//
//       The new solid is the set { |f| <= t/2 } = a band of total thickness t
//       centred on the old zero-surface { f = 0 }. The hollow INTERIOR (the void)
//       is { f < -t/2 }; the OUTER wall surface is { f = +t/2 } (the old surface
//       grown out by t/2) and the INNER wall surface is { f = -t/2 } (the old
//       surface pulled in by t/2). For a SOLID sphere of radius R shelled by t
//       this gives a spherical shell between radii R-t/2 and R+t/2, of volume
//       4/3·π·[(R+t/2)^3 - (R-t/2)^3] — the analytic oracle the gate checks.
//       (PicoGK's wall-thickness/`Shell` is the inward-only variant t inside the
//       surface; we ship the symmetric `|f| - t/2` straddle and ALSO an
//       inward-only `shellInward` = max(f, -(f + t)) for the wall-thickness use.)
//
//   (C) FILLET / ROUND between two fields — the PicoGK rounded boolean: a
//       SMOOTH-min / smooth-union with blend radius r that rounds the seam where
//       two solids meet (a fillet of radius ~r), instead of the sharp creased
//       min of VoxelBoolean::unite. Realised by the SAME Quilez polynomial smin
//       the SDF-expression stage uses (implicit/SdfOps.cpp::smin) ported
//       node-wise onto the two aligned grids:
//
//          smin(a,b,k): h = clamp(0.5 + 0.5*(b-a)/k, 0, 1)
//                       smin = mix(b,a,h) - k*h*(1-h)   (== min(a,b) when |a-b|>=k)
//
//       smoothUnion(a,b,r) = smin(a,b,r)        (rounded OR  / fillet)
//       smoothIntersect / smoothSubtract are the matching smax variants.
//       Monotone in r: the rounded union ADDS material in the seam, so its volume
//       is >= the sharp union and grows with r (validated, no tolerance on the
//       monotonicity; the band-volume matches the sharp result as r -> 0).
//
//   (D) MESH -> SDF GRID round-trip — re-exposed as VoxelFieldOps::fromMesh, a
//       one-line hand-off to implicit::MeshToSDF::build (the reverse seam that
//       ALREADY exists). Here so a caller building a voxel-field pipeline reaches
//       mesh -> grid through the same op header; it adds no new algorithm.
//
// EXACTNESS / HONESTY POSTURE (Bible §0/§9 — do NOT overclaim):
//   * For an EXACT distance field (our analytic sphere/box SDF sampled at the
//     nodes) shell `|f| - t/2` is the exact SDF of the symmetric shell up to the
//     O(h) voxelization band; the gate MEASURES that band against the closed-form
//     shell volume and never claims a sub-voxel surface.
//   * smin of two Lipschitz-1 SDFs is a SMOOTHED scalar field with the correct
//     rounded zero-set, NOT an exact Euclidean distance field (same caveat as
//     VoxelBoolean's min/max and SdfOps' smin). The SIGN — which the
//     enclosed-volume measure and the iso-surface depend on — is correct, which
//     is why the gate validates the rounded-union volume by MONOTONICITY +
//     bracketing (sharp-union <= rounded-union-of-overlapping <= sum), the only
//     honest closed-form claims available without an OCCT oracle for a blended
//     field.
//   * 0 FAKES: a non-finite thickness/blend, a non-positive blend radius, or
//     MISALIGNED grids return ok==false with an empty/unchanged field — never a
//     fabricated result to pass a test.
//
// REUSE (no duplication — #include only):
//   * voxel/VoxelGrid.hpp    : the dense SDF field + trilinear sampler + the
//                              cell-center occupied-VOLUME measure (the oracle).
//   * voxel/VoxelBoolean.hpp : alignment predicate + the sharp booleans + the
//                              closed-form sphere-sphere oracles (reused by the
//                              gate, and `aligned()` reused by the smooth ops).
//   * voxel/Morphology.hpp   : the level-set offset arithmetic offset() delegates
//                              to (so OFFSET has ONE implementation).
//   * voxel/VoxelMesh.hpp     : the SHARED voxel->mesh contour (round-trip).
//   * implicit/MeshToSDF.hpp  : the SHARED mesh->grid voxelizer (round-trip).
//
// HONEST SCOPE (refine, flagged never faked): these are DENSE SDF-grid ops
// (every node visited). Sparse / narrow-band (VDB-style) storage + a GPU
// node-wise kernel are the obvious accelerations — identical VALUES, pure speed
// — and are TARGETED, not done here. // TODO(sparse-gpu)
//
// CONVENTIONS: namespace forge::native::voxel. Pure C++20, standard library
// only. ZERO external deps, NO OCCT, NO WASM, NO third-party libs.

#ifndef FORGE_NATIVE_VOXEL_VOXELFIELDOPS_HPP
#define FORGE_NATIVE_VOXEL_VOXELFIELDOPS_HPP

#include "forge/native/voxel/VoxelGrid.hpp"        // VoxelGrid<float>, native::Vec3, sdfSphere
#include "forge/native/voxel/VoxelBoolean.hpp"     // VoxelBoolean::aligned + sharp booleans + oracles
#include "forge/native/voxel/VoxelMesh.hpp"        // voxel::VoxelMesh::contour, ContourResult
#include "forge/native/implicit/MeshToSDF.hpp"     // implicit::MeshToSDF (mesh -> grid round-trip)

#include <cstddef>

namespace forge {
namespace native {
namespace voxel {

// ---------------------------------------------------------------------------
// Result of a unary field op (offset / shell). Value semantics: the input is
// never mutated; `grid` is a fresh field. `ok` is false ONLY on a degenerate
// input (non-finite distance / non-positive thickness); then `grid` is a copy of
// the input left UNCHANGED. `empty` reports whether the result solid { f <= iso }
// has any inside node (honest empty, not a failure).
// ---------------------------------------------------------------------------
struct FieldOpResult {
    VoxelGrid<float> grid;
    bool ok    = false;
    bool empty = true;
};

// ---------------------------------------------------------------------------
// VoxelFieldOps — the PicoGK-class voxel-field op set (offset / shell / fillet /
// mesh->grid) as exact node-wise arithmetic on a dense SDF VoxelGrid<float>.
//
// SDF sign convention (matching the whole voxel stack): inside == { f <= iso },
// iso = 0 by default; negative inside, positive outside, ~zero on the surface.
// All distances are WORLD units (the grid's spacing units).
// ---------------------------------------------------------------------------
class VoxelFieldOps {
public:
    // -------- (A) OFFSET (PicoGK `Offset`) -------------------------------------
    // Signed level-set offset f' = f - d. d > 0 grows the solid (sphere R->R+d),
    // d < 0 shrinks it. Delegates to the SAME arithmetic as Morphology::offset
    // (one implementation; this is the single PicoGK-named field-op surface).
    // ok==false (field returned unchanged) iff d is non-finite.
    static FieldOpResult offset(const VoxelGrid<float>& in, double d, double iso = 0.0);

    // -------- (B) SHELL / HOLLOW (PicoGK `Shell`) ------------------------------
    // Symmetric uniform-thickness-t shell straddling the original surface:
    //     f_shell = |f| - t/2.
    // The result solid is the band { |f| <= t/2 } (total wall thickness t),
    // centred on the old zero-surface. For a solid sphere of radius R this is the
    // spherical shell between radii R-t/2 and R+t/2.
    // ok==false (unchanged field) iff t is non-finite or t <= 0.
    // `empty` is true if no node lies in the band (e.g. t smaller than the grid
    // can resolve, or the original surface is outside the box).
    static FieldOpResult shell(const VoxelGrid<float>& in, double t, double iso = 0.0);

    // INWARD-only wall (PicoGK wall-thickness): keep a wall of thickness t on the
    // INSIDE of the original surface (outer wall = the original surface, inner
    // void = { f < -t }). Field: f_wall = max(f, -(f + t)) = max(f, -f - t).
    //   solid(wall) = { f <= 0 } AND NOT { f <= -t } = the inner-t shell.
    // ok==false iff t is non-finite or t <= 0.
    static FieldOpResult shellInward(const VoxelGrid<float>& in, double t, double iso = 0.0);

    // -------- (C) FILLET / ROUND (PicoGK rounded boolean) ----------------------
    // Smooth (rounded) union of two ALIGNED SDF fields with blend radius r > 0:
    //     f = smin(a, b, r)   (Quilez polynomial smin; rounds the seam ~r wide).
    // The seam where the two solids meet is filleted with radius ~r instead of the
    // sharp crease of VoxelBoolean::unite. As r -> 0 this converges to the sharp
    // min. ok==false (empty grid) iff the two grids are not aligned, or r is
    // non-finite / r <= 0.
    static BooleanResult smoothUnion(const VoxelGrid<float>& a,
                                     const VoxelGrid<float>& b, double r);

    // Smooth (rounded) intersection: f = smax(a, b, r) = -smin(-a,-b,r).
    static BooleanResult smoothIntersect(const VoxelGrid<float>& a,
                                         const VoxelGrid<float>& b, double r);

    // Smooth (rounded) difference A \ B: f = smax(a, -b, r).
    static BooleanResult smoothSubtract(const VoxelGrid<float>& a,
                                        const VoxelGrid<float>& b, double r);

    // -------- (D) MESH -> SDF GRID (round-trip; PicoGK RenderMesh->voxels) ------
    // One-line hand-off to the SHARED implicit::MeshToSDF::build. Re-exposed here
    // so a voxel-field pipeline reaches mesh->grid through the same op header. The
    // returned grid round-trips directly back through VoxelMesh::contour.
    static implicit::MeshSdfResult fromMesh(
        const mesh::HalfEdgeMesh& m,
        const implicit::MeshToSdfSpec& spec = implicit::MeshToSdfSpec{});

    // -------- volume oracle (header-light, the gate's measure) -----------------
    // Enclosed (solid) volume of a field at iso, via the already-validated
    // VoxelGrid cell-center midpoint-Riemann measure (the SAME measure the rest
    // of the voxel stack validates against closed forms). Solid = { f <= iso }.
    static double enclosedVolume(const VoxelGrid<float>& g, double iso = 0.0);

    // True iff no node of g is inside at iso (the solid is empty).
    static bool isEmpty(const VoxelGrid<float>& g, double iso = 0.0);

    // -------- exposed scalar primitives (independently testable) ---------------
    // Quilez polynomial smooth-min over a band of width k > 0 (== min(a,b) when
    // |a-b| >= k). The same form as implicit/SdfOps.cpp::smin.
    static double smin(double a, double b, double k);
    // Smooth-max via smin: smax(a,b,k) = -smin(-a,-b,k).
    static double smax(double a, double b, double k);
};

// ---------------------------------------------------------------------------
// Analytic oracle for the SHELL gate (closed-form spherical-shell volume).
//
// A symmetric shell of thickness t on a solid sphere of radius R occupies the
// region between radii R-t/2 and R+t/2 (clamped at 0 for the inner radius):
//     shellVolumeSphere(R, t) = 4/3·π·[ (R+t/2)^3 - max(R-t/2, 0)^3 ].
// This is the EXACT target the shell field's enclosed volume is checked against
// (within a voxel-resolution tolerance) in the gate.
// ---------------------------------------------------------------------------
double shellVolumeSphere(double R, double t);

} // namespace voxel
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_VOXEL_VOXELFIELDOPS_HPP
