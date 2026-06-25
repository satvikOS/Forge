// forge/native/implicit/AdaptiveIntervalMesh.hpp
//
// ADAPTIVE (octree-refined) extension of the interval-arithmetic guaranteed
// mesher (IntervalMesh.hpp). ADDITIVE: the uniform IntervalMesh::mesh path is
// untouched. This adds a SECOND entry point that, instead of subdividing every
// interval-crossing box to a single UNIFORM target depth, subdivides each box
// ONLY where:
//
//   (a) the interval evaluation proves the surface MAY pass through it
//       (CellClass::Crossing — identical soundness to the uniform mesher: a box
//        the interval proves wholly inside/outside is never refined nor emitted);
//       AND
//   (b) a local FLATNESS / CURVATURE estimate over the box still exceeds the
//       tolerance — so a region the surface crosses but is locally flat (a plane,
//       a gently curved patch) stops early at a COARSE leaf, while high-curvature
//       regions (a sphere's tight cap, a small bump, a sharp-ish blob) keep
//       refining to fine leaves. This is the whole point of "adaptive": triangles
//       follow curvature.
//
// The result is a 2:1-BALANCED (restricted) octree of varying-size leaves. The
// surface is extracted by ADAPTIVE DUAL CONTOURING (Ju–Losasso–Schaefer–Warren
// 2002, "Dual Contouring of Hermite Data"): one QEF vertex per surface leaf, and
// the dual polygons are produced by the minimal-edge cell/face/edge recursion.
// On a balanced octree the minimal-edge dual is provably WATERTIGHT and CRACK-
// FREE across level transitions — the hanging-node / T-junction problem is
// resolved by the recursion always contouring on the SMALLEST cell incident to a
// shared edge, so coarse and fine leaves share one consistent set of dual edges.
//
// REUSE: this re-uses, never re-derives —
//   * the F-rep tree's GUARANTEED interval bound (FRep::range / classify) for the
//     octree prune (the same sound enclosure the uniform mesher uses);
//   * the F-rep tree's ANALYTIC gradient (FRep::gradient) for Hermite normals;
//   * the SAME QEF / Sym3-Jacobi solve the uniform IntervalMesh and DualContour
//     use (exposed from IntervalMesh.cpp's anonymous helpers via a shared inline
//     solver here so there is ONE QEF, not two — see AdaptiveIntervalMesh.cpp);
//   * the Mesh / Vec3 / Interval types from FRepTree.hpp.
//
// HONEST SCOPE
// ------------
//   * T-junction strategy: 2:1-BALANCED octree + minimal-edge adaptive dual
//     contouring (the canonical crack-free scheme). No transition-cell stitching
//     is used or needed; balancing + minimal-edge recursion is sufficient and
//     exact.
//   * Soundness is IDENTICAL to the uniform mesher: a box the interval certifies
//     wholly inside or wholly outside is pruned — never split, never emitted.
//   * The curvature estimate is a sound, conservative DRIVER of refinement only;
//     it can over-refine (cost, not correctness) but the interval prune still
//     bounds every crossing region, so under-refinement never holes the certified
//     surface — a crossing leaf at max depth is always meshed.
//   * maxDepth caps refinement; minDepth forces a floor so the root is split
//     enough to seed the octree. Feature types handled: smooth implicit surfaces
//     (sphere/torus/blobs/CSG). Genuinely sharp creases get a QEF vertex but are
//     not Newton-snapped here (same as the uniform mesher).
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#ifndef FORGE_NATIVE_IMPLICIT_ADAPTIVEINTERVALMESH_HPP
#define FORGE_NATIVE_IMPLICIT_ADAPTIVEINTERVALMESH_HPP

#include <cstdint>

#include "forge/native/implicit/FRepTree.hpp" // FRep, Mesh, Vec3, Interval

namespace forge {
namespace native {
namespace implicit {

// Statistics of one ADAPTIVE interval-meshing run.
struct AdaptiveMeshStats {
    int           minDepth      = 0;   // forced minimum subdivision depth
    int           maxDepth      = 0;   // refinement cap (finest possible leaf)
    std::uint64_t visitedNodes  = 0;   // octree boxes the interval test examined
    std::uint64_t prunedNodes   = 0;   // boxes certified empty/full & dropped whole
    std::uint64_t leafCells     = 0;   // surface leaves kept (all depths)
    std::uint64_t surfaceCells  = 0;   // leaves that produced a dual vertex
    std::uint64_t minLeafDepth  = 0;   // shallowest surface leaf depth used
    std::uint64_t maxLeafDepth  = 0;   // deepest surface leaf depth used (≤ maxDepth)
    bool          ok            = false;
};

// Adaptive interval-arithmetic mesher: a curvature-driven, interval-pruned,
// 2:1-balanced octree + minimal-edge adaptive dual contouring.
class AdaptiveIntervalMesh {
public:
    // Mesh the {f = isovalue} surface of `frep` inside the box [lo,hi].
    //
    //   minDepth   : the octree is split to at LEAST this depth before the
    //                curvature test can stop refinement (seeds the tree; ≥ 1).
    //   maxDepth   : refinement cap; the finest leaf is 2^maxDepth per axis.
    //   curvatureTol: a box that is interval-crossing but whose local field is
    //                FLATTER than this (normalised deviation-from-linear, see the
    //                .cpp) stops refining once depth ≥ minDepth. Smaller → finer.
    //
    // Returns an empty mesh (stats.ok=false) on an invalid handle, bad depths,
    // or a degenerate box. Never fabricates geometry. Soundness matches the
    // uniform mesher exactly: only interval-crossing boxes are ever refined or
    // emitted.
    static Mesh mesh(const FRep& frep, const Vec3& lo, const Vec3& hi,
                     int minDepth, int maxDepth, double curvatureTol,
                     double isovalue = 0.0, AdaptiveMeshStats* stats = nullptr);
};

} // namespace implicit
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_IMPLICIT_ADAPTIVEINTERVALMESH_HPP
