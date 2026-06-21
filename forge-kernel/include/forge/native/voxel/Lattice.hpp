// forge/native/voxel/Lattice.hpp
//
// Stage 5 (voxel / lattice) — PicoGK-class PERIODIC STRUT LATTICE field.
//
// WHAT THIS MODULE IS (honest — Bible §0/§9, KERNEL_INHOUSE_ROADMAP.md §D):
//   A unit-cell strut lattice (a periodic graph of round struts) is one of the
//   two staple PicoGK lattice families (the other is the TPMS level-set already
//   shipped in Tpms.hpp). This module fills an axis-aligned box with a tiled
//   strut graph — simple-cubic, body-centered-cubic (BCC) or face-centered-cubic
//   (FCC) — of a given unit-cell size and strut radius, expressed as a SIGNED
//   DISTANCE FIELD: each strut is a CAPSULE (the exact distance to a line segment
//   minus the radius), and the lattice field is the MIN over the capsule SDFs of
//   the struts in a small neighbourhood of cells around the query point. The
//   solid is the sub-level set { f <= 0 } (negative-inside convention, matching
//   VoxelGrid / VoxelMesh).
//
// REUSE, NO DUPLICATION (every heavy thing is #included, not re-implemented):
//   * dense field + trilinear sampler + volume-by-cell-center + connectivity
//                                            : voxel/VoxelGrid.hpp
//   * voxel field -> half-edge surface mesh  : voxel/VoxelMesh.hpp
//       (which itself reuses implicit::IsoMesher + mesh::HalfEdgeMesh)
//   * exact orientation / in-sphere predicates: forge/native/Predicates.hpp
//   * geom Point2 / Point3                    : geom/Geom.hpp
//   * implicit Vec3 / Sdf base                : implicit/SdfTree.hpp (via VoxelMesh)
//   * mesh Vec3 / HalfEdgeMesh / validate / signedVolume : mesh/HalfEdgeMesh.hpp
//   This file adds ONLY the strut-graph geometry + the capsule-min SDF + the
//   analytic volume-fraction oracle. No new grid, mesher, mesh type or predicate.
//
// THE CAPSULE SDF (exact):
//   For a segment A..B and a point p, with d = B - A, t = clamp(dot(p-A,d)/|d|^2,0,1),
//   the nearest point on the segment is A + t*d and the capsule distance is
//   |p - (A + t*d)| - radius. This is the EXACT Euclidean signed distance to a
//   round-capped cylinder (a "capsule"); it is a true distance field, so the
//   lattice min-field is Lipschitz-1 with the correct zero set.
//
// PREDICATES NOTE (honest, same posture as VoxelGrid.hpp): the lattice field is
//   pure per-point capsule arithmetic (min of distances) — no orientation
//   determinant — so the exact predicates are not load-bearing for the FIELD.
//   They ARE load-bearing for the mesh stage we reuse (HalfEdgeMesh::planeClip,
//   arrangement) and are kept #included per the no-duplicate-header rule.
//
// VALIDATED PROPERTIES (see test/native/voxel/lattice_test.cpp):
//   (1) VOLUME FRACTION matches the ANALYTIC thin-strut volume fraction within a
//       sampling tolerance, over several cell sizes and strut radii, for cubic /
//       BCC / FCC. The analytic oracle is the closed-form per-cell strut volume
//       (sum of cylinder volumes pi*r^2*L over the cell's strut length budget L,
//       the thin-strut limit where node-overlap / cap corrections are O(r^3) and
//       are SUBTRACTED OUT by keeping r/a small) divided by the cell volume a^3.
//       The test asserts agreement within tol AND that refining the grid
//       DECREASES the discretisation error (convergence, not a single lucky h).
//   (2) The contoured surface is CLOSED + 2-manifold (HalfEdgeMesh::validate())
//       when the lattice is built strictly interior to the box (margin cells of
//       empty space pad every side so no strut is clipped by a box face), and its
//       signedVolume() is POSITIVE and tracks the occupied voxel volume.
//   (3) ZERO radius gives an EMPTY solid (no occupied cells, no mesh) — honest:
//       a zero-radius strut has zero volume, so the module returns ok=false on a
//       "build a solid" request and an empty field on a "sample" request rather
//       than fabricating geometry to pass a test.
//
// HONEST ENVELOPE / TARGETED (NOT in this increment — flagged, never faked):
//   * The volume-fraction ORACLE is the THIN-STRUT cylinder sum. For thick struts
//     (large r/a) the struts MERGE at the nodes and the true volume fraction is
//     LESS than the cylinder sum (double-counted node overlap) and eventually
//     saturates to 1; the exact thick-strut fraction needs inclusion-exclusion
//     over the capsule union (TARGETED). The gate stays in the thin-strut regime
//     where the cylinder sum is accurate, and SAYS SO.
//   * Graded / conformal lattices (spatially varying cell size or radius),
//     anisotropic cells, and non-Bravais unit cells (octet-truss as a distinct
//     family, Kelvin, diamond) are TARGETED — this increment ships the three
//     Bravais families cubic / BCC / FCC.
//   * Trimming the lattice to an arbitrary outer shell (boolean-intersect with a
//     solid) reuses the SDF-CSG path (implicit::intersectionOp) and is left to
//     the caller; this module fills an AABB.
//
// CONVENTIONS: namespace forge::native::voxel. Pure C++20, standard library only.
//   ZERO external deps, NO OCCT, NO WASM, NO third-party libs.

#ifndef FORGE_NATIVE_VOXEL_LATTICE_HPP
#define FORGE_NATIVE_VOXEL_LATTICE_HPP

#include <array>
#include <cstddef>
#include <vector>

#include "forge/native/voxel/VoxelGrid.hpp"     // VoxelGrid<float>, native::Vec3
#include "forge/native/voxel/VoxelMesh.hpp"      // VoxelMesh::contour, ContourResult
#include "forge/native/geom/Geom.hpp"            // geom::Point3 (reused, no re-decl)
#include "forge/native/Predicates.hpp"           // exact predicates (no duplicate)

namespace forge {
namespace native {
namespace voxel {

// ---------------------------------------------------------------------------
// Strut-lattice unit-cell family.
//   CUBIC : the 12 cube-edge struts (axis-aligned frame).
//   BCC   : the cubic frame PLUS a body-center node joined to all 8 corners
//           (the 8 body-diagonal struts).
//   FCC   : the cubic frame PLUS a face-center node on each of the 6 faces,
//           each joined to that face's 4 corners (24 face-diagonal struts).
// The exact strut set per family is enumerated in Lattice.cpp and is what the
// analytic volume oracle integrates, so the test's oracle and the field agree
// on the SAME geometry.
// ---------------------------------------------------------------------------
enum class LatticeType { Cubic, BCC, FCC };

// ---------------------------------------------------------------------------
// A single strut as a world-space line segment (the capsule axis).
// ---------------------------------------------------------------------------
struct Strut {
    native::Vec3 a;
    native::Vec3 b;
};

// ---------------------------------------------------------------------------
// LatticeSpec — what to build.
//   type      : cubic / BCC / FCC.
//   cellSize  : unit-cell edge length a (> 0).
//   radius    : strut radius r (>= 0; r == 0 is the honest-empty case).
//   nx,ny,nz  : number of WHOLE unit cells along each axis (>= 1).
//   origin    : world position of the lattice's lower corner (cell (0,0,0)).
// The lattice occupies the box [origin, origin + (nx,ny,nz)*cellSize].
// ---------------------------------------------------------------------------
struct LatticeSpec {
    LatticeType   type     = LatticeType::Cubic;
    double        cellSize = 1.0;
    double        radius   = 0.1;
    std::size_t   nx       = 1, ny = 1, nz = 1;
    native::Vec3  origin   = native::Vec3{0.0, 0.0, 0.0};
};

// ---------------------------------------------------------------------------
// Per-cell strut-length budget L (world units) for a unit cell of the given
// family at the given cellSize. This is the sum over the cell's owned struts of
// (length * ownership-fraction): each undirected edge is attributed across the
// cells that share it so the periodic tiling counts every strut exactly once.
// (The asymptotic INTERIOR density; handy for callers reasoning about relative
// density. EXACT, closed-form — no sampling.) NOTE: a FINITE box renders MORE
// length than this per cell because boundary frame edges are not shared with an
// outside neighbour — for the as-rendered volume use totalStrutLength() below.
// ---------------------------------------------------------------------------
double unitCellStrutLength(LatticeType type, double cellSize);

// ---------------------------------------------------------------------------
// Total length of the ACTUAL struts the field renders in the finite box (the sum
// of |b-a| over enumerateStruts(spec)). EXACT, closed-form. This is the geometry
// the SDF represents, so it is the basis of the analytic volume oracle.
// ---------------------------------------------------------------------------
double totalStrutLength(const LatticeSpec& spec);

// ---------------------------------------------------------------------------
// Analytic THIN-STRUT cylinder-sum VOLUME of the lattice = pi*r^2 * L_total,
// where L_total = totalStrutLength(spec). This is the sum of the (cap-free)
// cylinder volumes of all rendered struts.
//
// RIGOROUS MEANING (this is the oracle the gate uses, and it is honest):
//   * It is an EXACT UPPER BOUND on the true solid (union) volume: the union of
//     the capsules can never exceed the sum of the cylinder volumes (struts
//     OVERLAP at shared nodes, removing volume; caps ADD a little but the net,
//     for the thin-strut families here, stays under the cylinder sum). So the
//     true volume V_true satisfies  V_true <= pi*r^2*L_total  always.
//   * The bound is ASYMPTOTICALLY TIGHT as r/a -> 0: the overlap deficit at a
//     node where k struts meet is O(r^3) while the strut volume is O(r^2 * a),
//     so the relative gap (sum - union)/sum is O(r/a) and -> 0. The gate MEASURES
//     this gap shrinking as r/a shrinks (per-family), which is the real proof
//     that this is the correct asymptotic oracle — not a fitted constant.
//   Returns 0 for radius <= 0 (honest empty).
// ---------------------------------------------------------------------------
double analyticStrutVolume(const LatticeSpec& spec);

// ---------------------------------------------------------------------------
// Analytic CAPSULE-SUM volume = pi*r^2*L_total + nStruts*(4/3)*pi*r^3, i.e. the
// cylinder sum PLUS one full sphere (two hemispherical caps) per strut. Because
// each rendered capsule's volume is exactly pi*r^2*L_i + (4/3)*pi*r^3, this is
// the SUM of the individual capsule volumes, which by sub-additivity is a
// GUARANTEED (always-true, not asymptotic) UPPER BOUND on the true union volume:
//   V_true = |union of capsules| <= sum of capsule volumes = analyticCapsuleVolume.
// The gate asserts occupied <= this as the hard, never-violated bound, and uses
// the (tighter, cap-free) cylinder sum for the asymptotic-tightness check.
// Returns 0 for radius <= 0 (honest empty).
// ---------------------------------------------------------------------------
double analyticCapsuleVolume(const LatticeSpec& spec);

// ---------------------------------------------------------------------------
// Enumerate every strut whose capsule can reach into the lattice box, expressed
// as world-space segments. (Exposed for the gate and for callers who want the
// graph directly; the SDF/voxelization below use the same enumeration.)
// Empty when radius <= 0 is NOT enforced here — struts are radius-independent
// geometry; an empty vector only results from nx*ny*nz == 0.
// ---------------------------------------------------------------------------
std::vector<Strut> enumerateStruts(const LatticeSpec& spec);

// ---------------------------------------------------------------------------
// Exact lattice SDF at a world point p: min over capsule SDFs of the struts in
// the neighbourhood of p (only the cells touching p's cell are consulted, so the
// cost is O(1) per query, independent of lattice size). Negative inside a strut,
// positive outside, zero on a strut surface. For radius <= 0 every capsule has
// non-positive thickness; the field then reports the (positive) distance to the
// nearest strut AXIS with no interior, i.e. the solid { f <= 0 } is empty.
// ---------------------------------------------------------------------------
double latticeSdf(const LatticeSpec& spec, const native::Vec3& p);

// ---------------------------------------------------------------------------
// Result of voxelizing a lattice into a dense grid.
//   grid          : the sampled SDF (negative inside the struts).
//   marginCells   : empty cells padded on every side (keeps struts interior so
//                   the contoured surface is closed).
//   ok            : false when the spec is degenerate (radius <= 0, cellSize <= 0,
//                   zero cells, or a sampling too coarse to resolve the radius).
//                   On ok==false the grid is left default-empty — NO fabricated
//                   field. radius == 0 is the canonical honest-empty case.
//   reason        : human-readable cause when ok==false ("" on success).
// ---------------------------------------------------------------------------
struct VoxelizeResult {
    VoxelGrid<float> grid;
    std::size_t      marginCells = 0;
    bool             ok = false;
    const char*      reason = "";
};

// Voxelize the lattice SDF into a dense VoxelGrid<float>.
//   samplesPerCell : grid nodes per unit cell along each axis (>= 2). Higher =>
//                    finer field. The radius must span at least ~1 cell of the
//                    grid spacing (a = cellSize/samplesPerCell) or the field
//                    cannot resolve the strut — that returns ok=false honestly.
VoxelizeResult voxelize(const LatticeSpec& spec, std::size_t samplesPerCell);

// ---------------------------------------------------------------------------
// Result of building a lattice solid all the way to a surface mesh.
//   contour : the meshed surface (see voxel::ContourResult; .ok / .report carry
//             the closed/2-manifold audit). Empty + report-default when ok==false.
//   voxels  : the voxelization that fed the mesher (its grid measures volume).
//   ok      : false when voxelize() failed (degenerate spec) OR the marching-
//             cubes soup was non-manifold (REJECTED by buildFromSoup, not faked).
//   reason  : cause when ok==false.
// ---------------------------------------------------------------------------
struct LatticeMesh {
    ContourResult    contour;
    VoxelizeResult   voxels;
    bool             ok = false;
    const char*      reason = "";
};

// Build the lattice solid surface: voxelize, then contour via the SHARED mesher.
LatticeMesh buildLatticeMesh(const LatticeSpec& spec, std::size_t samplesPerCell);

// ---------------------------------------------------------------------------
// Measured (discrete) occupied VOLUME of a voxelized lattice: the absolute solid
// volume of { f <= 0 } by the VoxelGrid cell-center midpoint rule over the whole
// (padded) grid — every rendered capsule lies inside the padded grid, so this is
// the discrete estimate of the TRUE union volume V_true. Compared by the gate to
// analyticStrutVolume(): it must satisfy occupied <= analytic (the cylinder sum
// upper-bounds the union, up to the small midpoint-discretisation band), and the
// relative gap must shrink as r/a shrinks. Returns 0 for an empty / default grid.
// ---------------------------------------------------------------------------
double measuredOccupiedVolume(const VoxelizeResult& vr);

} // namespace voxel
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_VOXEL_LATTICE_HPP
