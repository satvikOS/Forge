// forge/native/brep/Shell.hpp
//
// K-features — native OFFSET / SHELL (hollow-to-thin-wall) on the Forge native
// ANALYTIC B-rep — the in-house replacement for OCCT BRepOffsetAPI_MakeThickSolid.
// This is the analytic, exact-volume counterpart to the mesh-level hollow op in
// src/native/mesh/Shell.cpp: where the mesh shell displaces triangle VERTICES
// inward and stitches a triangle wall, this operates on the SOLID's ANALYTIC
// FACES — offsetting each retained face's Surface inward by the wall thickness t
// (a plane offsets to a parallel plane, a cylinder r->r-t, a sphere r->r-t, a
// cone shifts), re-trimming adjacent offset faces to their NEW mutual corner
// intersections, and stitching outer + inner + side-wall faces into one hollow
// brep::Solid whose VOLUME is the exact wall volume (not a tessellation estimate).
//
// It builds ON TOP of, and REUSES (no re-derivation):
//   * Topology.hpp       — Vertex/Edge/Coedge/Loop/Face/Shell/Solid + TopologyBuilder
//                          (the inner shell is assembled with the same Euler ops),
//   * Surface.hpp        — the analytic Surface a face carries (Plane/Cyl/Cone/
//                          Sphere/Torus) + its outward normal (the offset direction),
//   * SurfaceIntersect.hpp — intersectSurfaces() to find where two OFFSET faces meet
//                          (the SSI that re-trims adjacent offset planes to their new
//                          shared edge line; the corner is the meet of three),
//   * Sew.hpp            — sewFaces() / diagnoseShell() to stitch outer+inner+wall
//                          fragments into ONE connected, watertight shell (K1.4),
//   * MassProps.hpp      — massProperties() reports the exact hollow volume the gate
//                          asserts (outer minus cavity, via the divergence theorem).
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL algorithm, pure C++20 + stdlib only — NO external dependencies, NO OCCT, NO
// WASM. ADDITIVE: a brand-new header + TU (forge/native/brep/Shell.{hpp,cpp}),
// DISTINCT from the mesh shell (forge/native/mesh/Shell.cpp). Topology.hpp /
// Surface.hpp / Sew.hpp are NOT edited.
//
// HONEST SCOPE (this increment):
//   * SUPPORTED faces: PLANAR + analytic-QUADRIC (cylinder / cone / sphere) with a
//     UNIFORM wall thickness t. The offset of each is closed-form:
//       - plane (origin O, outward unit n):   O' = O - t*n           (parallel plane)
//       - cylinder (axis a, radius r):        r' = r - t              (coaxial)
//       - sphere  (centre c, radius r):       r' = r - t
//       - cone (half-angle alpha, perp r):    r'(perp) = r - t        (offset cone)
//     Each retained face keeps its EXACT analytic surface; only its radius/plane-
//     constant moves, so the inner face is a true analytic patch (the hollow volume
//     is exact, not a chord estimate).
//   * REMOVED faces: an optional set of faces are the OPEN mouths of the shell
//     (their inner counterparts are also dropped); the rim of every removed face is
//     bridged by a planar SIDE-WALL band joining the outer rim to the inner rim, so
//     the wall stays a closed 2-manifold with a real lip of thickness t.
//   * TORUS faces ARE offset natively: the offset of a torus is another torus
//     (major radius / centre / axis unchanged, minor radius r2 -> r2 - t), and
//     every curved-face vertex is re-trimmed along the OUTER surface normal at that
//     vertex's (u,v) so the inner corner lands exactly on the offset surface. The
//     inner face inherits the theta/phi param window verbatim, so its analytic mass
//     integral is exact (a closed donut hollow matches OCCT MakeThickSolid to 1e-6).
//   * NOT built here (honestly deferred — see EXECUTION_ROADMAP Wave-3 P2.5):
//       - VARIABLE / per-face thickness (the spec's true variable-offset shell),
//       - FREEFORM (trimmed-NURBS) face offset with self-intersection trimming, and
//       - automatic self-intersection rejection beyond the t<min-half-extent guard.
//     Each is reported via ShellResult::reason / ok=false, never faked.
//
// CONVENTIONS: namespace forge::native::brep. Thickness is model-space distance,
// measured along each face's INWARD normal. Outer faces keep outward normals; inner
// (cavity) faces are oriented with normals pointing INTO the cavity (away from the
// wall material), so the divergence-theorem volume is outer_volume - cavity_volume.

#ifndef FORGE_NATIVE_BREP_SHELL_HPP
#define FORGE_NATIVE_BREP_SHELL_HPP

#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/brep/Topology.hpp"   // Vertex/Edge/.../Solid, TopologyBuilder

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// ShellOptions — the thickness + tolerances + the removed (open) face set.
// ---------------------------------------------------------------------------
struct ShellOptions {
    // Uniform wall thickness, model-space distance along each face's INWARD
    // normal. Must be > 0 and strictly less than the solid's minimum half-extent
    // (else the inner offset self-intersects / collapses — reported ok=false).
    double thickness = 0.0;

    // Indices (into the input solid's outer-shell face list, in face order) of the
    // faces to REMOVE — the open mouths of the shell. Empty => a fully closed
    // hollow solid (no face removed). Each removed face's inner counterpart is also
    // dropped and its rim bridged by a side-wall band.
    std::vector<std::size_t> removedFaces;

    // Geometric coincidence tolerance for the sew / corner-merge steps.
    double tol = 1e-9;
};

// ---------------------------------------------------------------------------
// ShellResult — the hollow solid + its closure / volume diagnosis.
// ---------------------------------------------------------------------------
struct ShellResult {
    bool ok = false;

    // The hollow wall Solid, owned by the caller's TopologyBuilder (the same
    // builder passed to shellSolid). Outer faces + inner cavity faces + side-wall
    // bands, sewn into one connected shell. Null on failure.
    Solid* solid = nullptr;

    // Closure diagnosis of the wall shell (from the K1.4 sewer): a CLOSED hollow
    // solid (no face removed) is watertight; an OPEN shell (faces removed) is still
    // a closed 2-manifold WALL because the mouth rims are bridged by side-wall
    // bands, so `closedManifold` reports true for BOTH cases (the wall encloses a
    // real volume). `freeEdges` is 0 for a correctly stitched wall.
    bool        closedManifold = false;
    std::size_t freeEdges = 0;

    // Counts of the assembled wall.
    std::size_t outerFaces = 0;   // retained outer faces
    std::size_t innerFaces = 0;   // retained inner (cavity) faces
    std::size_t wallFaces  = 0;   // side-wall bands bridging the removed-face rims

    // The exact wall VOLUME (outer solid volume - inner cavity volume), filled from
    // massProperties() on the result. 0 on failure.
    double volume = 0.0;

    const char* reason = "";
};

// ===========================================================================
// THE SHELL OP — hollow `solid` to a uniform wall of thickness `opt.thickness`,
// optionally removing the faces named in `opt.removedFaces`.
//
// `tb` MUST be the SAME TopologyBuilder that owns `solid` (the op allocates the
// inner + wall faces on it and reuses the outer faces in place). Returns the full
// result; `ok` is false (with `reason` set) on: thickness <= 0, thickness too
// large (inner offset would collapse / self-intersect), a non-planar-non-quadric
// (torus / NURBS) face present, or a malformed input solid.
//
// The input solid's faces MUST each carry an analytic Surface (Primitives.hpp /
// the native feature path attach these); a bare-topology face (surface == null) is
// rejected honestly.
// ===========================================================================
ShellResult shellSolid(TopologyBuilder& tb, Solid* solid, const ShellOptions& opt);

// ---------------------------------------------------------------------------
// offsetPlaneOrigin / offsetQuadricRadius — the closed-form face-offset helpers,
// exposed for the gate's direct unit checks (a plane offsets to a parallel plane;
// a cylinder/sphere radius r -> r - t; a cone's perpendicular radius -> r - t).
// These do not mutate topology; they return the offset analytic surface.
// ---------------------------------------------------------------------------
//
// Offset the analytic surface `s` INWARD by thickness `t` and return the offset
// surface. The returned surface is the SAME kind with its plane-constant / radius
// moved inward; `ok` is false for an unsupported kind (Torus / Nurbs) or a radius
// that would go non-positive (t >= r) — reported, never faked.
struct OffsetSurfaceResult {
    bool    ok = false;
    Surface surface;       // the inward-offset analytic surface
    const char* reason = "";
};
OffsetSurfaceResult offsetSurfaceInward(const Surface& s, double t);

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_SHELL_HPP
