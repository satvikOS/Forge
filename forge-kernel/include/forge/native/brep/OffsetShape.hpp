// forge/native/brep/OffsetShape.hpp
//
// K-features — native OFFSET-SHAPE (grow / shrink a whole SOLID by offsetting
// EVERY face by a signed distance t) on the Forge native ANALYTIC B-rep — the
// in-house replacement for OCCT BRepOffsetAPI_MakeOffsetShape with the
// INTERSECTION (sharp) join (BRepOffset_Skin, GeomAbs_Intersection).
//
// This is DISTINCT from brep/Shell.hpp (BRepOffsetAPI_MakeThickSolid): Shell
// HOLLOWS a solid into a thin wall (outer faces kept, inner cavity faces offset
// inward, side-wall lip), producing a hollow body whose volume is the WALL
// volume. OffsetShape instead MOVES THE WHOLE BOUNDARY: every face slides along
// its OWN OUTWARD normal by +t (grow) or -t (shrink), the adjacent offset faces
// are re-trimmed/extended to their NEW mutual intersections (SSI), and the
// result is ONE grown / shrunk SOLID (no cavity, no wall) whose volume is the
// offset solid's volume. A box L grown by t becomes a box L+2t; shrunk by t a
// box L-2t; a cylinder r,h grown by t becomes r+t, h+2t.
//
// It builds ON TOP of, and REUSES (no re-derivation) the SAME machinery the
// analytic shell uses — this header deliberately shares brep/Shell.hpp's
// per-surface offset helper and the planar-corner meet pattern:
//   * Topology.hpp        — Vertex/Edge/Coedge/Loop/Face/Shell/Solid + builder
//                           (the offset shell is assembled with the same Euler ops),
//   * Surface.hpp         — the analytic Surface a face carries (Plane/Cyl/Cone/
//                           Sphere/Torus) + its OUTWARD normal (the offset direction),
//   * SurfaceIntersect.hpp — intersectSurfaces() verifies that adjacent OFFSET faces
//                           re-trim to their new shared SSI edge (the corner is the
//                           meet of three offset surfaces, verified to lie on each pair),
//   * Sew.hpp             — sewFaces() / diagnoseShell() to stitch the offset face
//                           fragments into ONE connected, watertight shell,
//   * MassProps.hpp       — massProperties() reports the EXACT offset volume the gate
//                           asserts (box 1728 / 512, cylinder pi*(r+t)^2*(h+2t)).
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL algorithm, pure C++20 + stdlib only — NO external dependencies, NO OCCT,
// NO WASM. ADDITIVE: a brand-new header + TU (forge/native/brep/OffsetShape.{hpp,
// cpp}). Topology.hpp / Surface.hpp / Sew.hpp / Shell.hpp are NOT edited.
//
// HONEST SCOPE (this increment):
//   * SUPPORTED faces: PLANAR + analytic-QUADRIC (cylinder / cone / sphere) with a
//     UNIFORM signed distance t and the INTERSECTION (sharp) join. The offset of
//     each face is the SAME closed form the analytic shell already uses, but along
//     the OUTWARD normal and signed:
//       - plane  (origin O, outward unit n):  O' = O + t*n         (parallel plane)
//       - cylinder (axis a, radius r):        r' = r + t           (coaxial)
//       - sphere  (centre c, radius r):       r' = r + t
//       - cone   (perp radius r):             r' = r + t           (offset cone)
//     t may be NEGATIVE (shrink). Each face keeps its EXACT analytic surface; only
//     its plane-constant / radius moves, so the offset face is a true analytic
//     patch and the offset volume is EXACT (not a chord estimate).
//   * CORNER RE-TRIM: each original vertex shared by k>=3 PLANAR offset faces is
//     moved to the unique meet of those k offset planes (3-plane meet least-squares,
//     exact for the convex box / polyhedron). The shared offset EDGE of two adjacent
//     offset planes is their SSI line; the corner lies on each such line (verified).
//     Quadric-side rims (cylinder/cone caps) are moved by re-deriving each cap-loop
//     vertex onto the offset cap plane at the offset radius — closed-form, exact.
//   * NOT built here (honestly deferred — never faked, reported ok=false / reason):
//       - ARC / ROUNDED join (GeomAbs_Arc: fill convex corners with a fillet/round
//         instead of extending to the sharp intersection),
//       - FREEFORM (trimmed-NURBS) face offset with self-intersection trimming,
//       - TORUS-face offset (offset is a torus r2->r2+t but its corner SSI is deferred),
//       - SELF-INTERSECTION rejection on a large INWARD (shrink) offset that would
//         collapse a thin feature (guarded only by the |t| < min-half-extent test for
//         shrink; a partial collapse inside that bound is not yet detected).
//
// CONVENTIONS: namespace forge::native::brep. `distance` is model-space, measured
// along each face's OUTWARD normal; positive grows, negative shrinks. The offset
// faces keep OUTWARD normals (the result is a normal solid, not a cavity).

#ifndef FORGE_NATIVE_BREP_OFFSETSHAPE_HPP
#define FORGE_NATIVE_BREP_OFFSETSHAPE_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/brep/Topology.hpp"   // Vertex/Edge/.../Solid, TopologyBuilder

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// OffsetShapeOptions — the signed offset distance + tolerances + join style.
// ---------------------------------------------------------------------------
struct OffsetShapeOptions {
    // Signed offset distance, model-space, measured along each face's OUTWARD
    // normal. > 0 grows the solid, < 0 shrinks it. Must be non-zero. For a shrink
    // (t < 0) |t| must be strictly less than the solid's minimum half-extent (else
    // an opposite face pair would cross / the solid collapses — reported ok=false).
    double distance = 0.0;

    // Geometric coincidence tolerance for the sew / corner-merge steps.
    double tol = 1e-9;
};

// ---------------------------------------------------------------------------
// OffsetShapeResult — the offset (grown / shrunk) solid + its closure / volume.
// ---------------------------------------------------------------------------
struct OffsetShapeResult {
    bool ok = false;

    // The offset Solid, owned by the caller's TopologyBuilder (the same builder
    // passed to offsetSolidShape). Every original face re-built as an offset face
    // fragment, sewn into one connected shell. Null on failure.
    Solid* solid = nullptr;

    // Closure diagnosis of the offset shell (from the K1.4 sewer): a correctly
    // re-trimmed offset of a closed solid is itself watertight, so this reports
    // true and `freeEdges` is 0 for a clean result.
    bool        closedManifold = false;
    std::size_t freeEdges = 0;

    // Count of the offset faces assembled (== the input solid's face count).
    std::size_t faces = 0;

    // The EXACT offset solid VOLUME, filled from massProperties() on the result.
    double volume = 0.0;

    const char* reason = "";
};

// ===========================================================================
// THE OFFSET-SHAPE OP — grow / shrink `solid` by the signed `opt.distance`,
// moving every face along its outward normal and re-trimming adjacent offset
// faces to their new mutual intersections (the INTERSECTION / sharp join).
//
// `tb` MUST be the SAME TopologyBuilder that owns `solid` (the op allocates the
// offset faces on it). Returns the full result; `ok` is false (with `reason`
// set) on: distance == 0, a shrink whose |t| >= the solid's min half-extent
// (collapse), a non-planar-non-quadric (torus / NURBS) face present, a quadric
// radius driven non-positive by a shrink, or a malformed input solid.
//
// The input solid's faces MUST each carry an analytic Surface (Primitives.hpp /
// the native feature path attach these); a bare-topology face (surface == null)
// is rejected honestly.
// ===========================================================================
OffsetShapeResult offsetSolidShape(TopologyBuilder& tb, Solid* solid,
                                   const OffsetShapeOptions& opt);

// ---------------------------------------------------------------------------
// offsetSurfaceOutward — the closed-form per-surface offset along the OUTWARD
// normal by the SIGNED distance t (positive grows, negative shrinks), exposed
// for the gate's direct unit checks. Distinct from Shell.hpp's
// offsetSurfaceInward, which always moves INWARD by a positive thickness. Does
// not mutate topology; returns the offset analytic surface.
//   * plane  O,n -> O + t*n      (parallel plane, same normal)
//   * cyl    r   -> r + t        (coaxial)
//   * sphere r   -> r + t
//   * cone   r   -> r + t        (offset cone)
// `ok` is false for an unsupported kind (Torus / NURBS) or a radius driven <= 0
// by a shrink (t <= -r) — reported, never faked.
// ---------------------------------------------------------------------------
struct OffsetShapeSurfaceResult {
    bool    ok = false;
    Surface surface;       // the outward-offset analytic surface
    const char* reason = "";
};
OffsetShapeSurfaceResult offsetSurfaceOutward(const Surface& s, double t);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_OFFSETSHAPE_HPP
