// forge/native/implicit/IntervalMesh.hpp
//
// In-house libfive-class INTERVAL-ARITHMETIC GUARANTEED MESHING of an F-rep
// tree — the libfive feature the Wave-0 implicit harvest (IsoMesher marching
// cubes + uniform-grid DualContour) was missing.
//
// WHAT THIS ADDS over the existing meshers
// ----------------------------------------
// IsoMesher (marching cubes) and DualContour both SAMPLE a DENSE uniform grid:
// they evaluate f at every one of the (n+1)^3 grid vertices and every one of the
// n^3 cells, with NO knowledge of where the surface actually is. At a coarse n a
// THIN feature (a gyroid/TPMS wall thinner than a cell, a sheet, a slot) can fall
// ENTIRELY BETWEEN sample planes and be MISSED — marching cubes simply produces a
// hole because no sampled edge changed sign across the wall.
//
// IntervalMesh closes that gap the way libfive does, with INTERVAL ARITHMETIC:
//
//   (1) INTERVAL EVALUATION of the F-rep tree over an axis-aligned box gives a
//       GUARANTEED conservative bound [lo,hi] of the field over the WHOLE box
//       (FRep::range / FRepNode::evalInterval, already in the tree). A box whose
//       interval is wholly > 0 is PROVABLY empty (surface cannot enter it); a box
//       whose interval is wholly < 0 is PROVABLY full. Either way the surface is
//       certified ABSENT and the box is pruned — never subdivided, never sampled.
//
//   (2) An OCTREE is built by interval pruning: starting from the root box, ONLY
//       boxes whose interval STRADDLES 0 (CellClass::Crossing) are subdivided,
//       recursively, to a target depth. Empty/full subtrees are dropped whole.
//       Because the interval is a SOUND enclosure, every box the surface actually
//       crosses is retained: NO crossing region is ever pruned, so NO thin
//       feature is missed within the leaf resolution. This is the GUARANTEE — the
//       coverage certificate marching cubes cannot give.
//
//   (3) TOPOLOGY-AWARE DUAL CONTOURING on the surviving leaf cells: one vertex
//       per surface leaf, placed by a Quadratic Error Function (QEF) over the
//       Hermite data (a surface point + the ANALYTIC gradient normal from
//       FRep::evalGrad — the true chain-rule derivative, not finite differences)
//       on each sign-changing cell edge. Dual quads join the cells sharing each
//       sign-changing leaf edge, wound to face outward and triangulated. On a
//       uniform leaf layer (all leaves at the target depth) the dual mesh is a
//       watertight, closed 2-manifold: every interior sign-changing edge yields
//       exactly one quad, the box boundary is not crossed.
//
// EFFICIENCY: the octree visits O(surface area / leaf^2) cells — the surface, a
// 2D set — instead of the O(n^3) volume marching cubes visits. The mesher reports
// pruned-vs-total so the saving is MEASURED, not asserted.
//
// HONEST SCOPE (Bible §0/§9)
// --------------------------
//   * Leaves are emitted at a UNIFORM target depth (the pruned octree decides
//     WHICH leaves exist, not a varying depth). So the dual mesh is a uniform-leaf
//     dual contour with interval-certified coverage. Adaptive (varying-depth)
//     leaves with crack-patching, plus Newton feature-SNAPPING of the QEF vertex
//     onto the exact surface via the analytic gradient, are the named REFINE
//     follow-on (see TODO) — not claimed here.
//   * The coverage guarantee is "no crossing cell at the target resolution is
//     missed". A feature thinner than the leaf size can still be unresolved — but
//     unlike marching cubes the mesher can DETECT it (a crossing leaf that cannot
//     be split further) rather than silently holing. The guarantee is relative to
//     the chosen depth, stated plainly.
//   * Interval bounds are CONSERVATIVE (sound, not tightest). Pruning is therefore
//     sound: it never discards a box the surface crosses. It MAY retain some boxes
//     the surface does not cross (false-positive crossings) — those cost work, not
//     correctness, and contribute no spurious geometry (a non-sign-changing leaf
//     emits no vertex).
//
// REUSE: adds NO new field type and NO new mesh type. Includes FRepTree.hpp (the
// F-rep tree with interval + analytic-gradient evaluation — REUSED, never
// re-implemented) and rides its Mesh / Vec3 / Interval. The QEF solve is the same
// Ju-Losasso-Schaefer-Warren scheme DualContour uses, here fed analytic-gradient
// Hermite data. No duplication of the SDF, the tree, or the mesh container.
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#ifndef FORGE_NATIVE_IMPLICIT_INTERVALMESH_HPP
#define FORGE_NATIVE_IMPLICIT_INTERVALMESH_HPP

#include <cstdint>

#include "forge/native/implicit/FRepTree.hpp" // FRep (interval + analytic grad), Mesh, Vec3, Interval

namespace forge {
namespace native {
namespace implicit {

// Statistics of one interval-meshing run — proves the interval pruning worked.
struct IntervalMeshStats {
    int   depth          = 0;   // target octree depth actually used
    int   leafGrid       = 0;   // leaves per axis at that depth (= 2^depth)
    std::uint64_t totalCells   = 0; // (2^depth)^3 — cells a dense uniform mesher visits
    std::uint64_t visitedCells = 0; // octree boxes the interval test actually examined
    std::uint64_t prunedCells  = 0; // leaf-equivalent cells certified empty/full & dropped
    std::uint64_t markedCells  = 0; // surface LEAVES the interval octree retained
                                    // (interval straddled the iso) — the DETECTION
                                    // count: nonzero ⇒ the surface was located, even
                                    // for a feature too thin for the leaf to resolve.
    std::uint64_t surfaceCells = 0; // marked leaves that produced a dual vertex
                                    // (corner signs actually changed). ≤ markedCells.
    bool          ok           = false;

    // Fraction of the dense grid the interval prune avoided sampling (0..1).
    double prunedFraction() const {
        return totalCells ? static_cast<double>(prunedCells) /
                                static_cast<double>(totalCells)
                          : 0.0;
    }
};

// Interval-arithmetic guaranteed mesher: an interval-pruned octree + topology-
// aware dual contouring of an F-rep tree.
class IntervalMesh {
public:
    // Mesh the {f = isovalue} surface of `frep` inside the cubic root box
    // [lo,hi] (any AABB is accepted; non-cubic boxes simply yield non-cubic
    // leaves). The octree subdivides ONLY interval-crossing boxes to `maxDepth`
    // levels (leaf grid = 2^maxDepth per axis), then dual-contours the surface
    // leaves. `stats` (if non-null) receives the prune/visit/surface counts.
    //
    // Returns an empty mesh on an invalid handle, maxDepth < 1, or a degenerate
    // box (and sets stats.ok = false). Never fabricates geometry.
    static Mesh mesh(const FRep& frep, const Vec3& lo, const Vec3& hi,
                     int maxDepth, double isovalue = 0.0,
                     IntervalMeshStats* stats = nullptr);

    // ---- TODO (named REFINE follow-on, NOT implemented here) ----------------
    //   * adaptive varying-depth leaves (subdivide finer only where curvature /
    //     interval width demands) with manifold crack-patching across T-junctions;
    //   * Newton feature-SNAP: project each QEF vertex onto {f=0} along the
    //     analytic gradient (FRep::evalGrad) for sub-leaf accuracy on sharp edges.
};

} // namespace implicit
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_IMPLICIT_INTERVALMESH_HPP
