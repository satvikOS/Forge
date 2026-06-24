// forge/native/brep/TrimmedFace.hpp
//
// K1.2 — TRIMMED-NURBS B-REP FACE for the Forge native kernel. THE critical-path
// keystone of the in-house kernel: the first face whose geometry is an arbitrary
// rational B-spline surface bounded by N (u,v) TRIM LOOPS (an outer loop + inner
// hole loops), rather than the parameter-rectangle window that Surface.hpp/
// NurbsSurface.hpp carry today. Without it the kernel cannot represent or read any
// real-world part whose face is not one of the 5 quadrics, so OCCT can never be
// removed (docs/SCOPE_2026-06-24/kernel/{brep-nurbs,data-exchange}.md, "keystone").
//
// It builds ON TOP of, and REUSES (no re-derivation):
//   * NurbsSurface.hpp  — validateSurface / evaluateWithDerivatives (point + the
//                         analytic rational partials + unit normal),
//   * NurbsAlgebra.hpp  — surfaceCurvature (1st/2nd fundamental form) for the
//                         curvature-adaptive refinement,
//   * Curve.hpp         — PCurve (Line2 / Circle2 / BSpline2) as the 2D trim
//                         pcurve a loop segment follows in (u,v),
//   * geom/ConstrainedDelaunay2D.hpp — constrainedDelaunay2D (PSLG CDT with
//                         even-odd inside marking) as the trim-respecting mesher.
//
// THREE REAL operations (no stub / MVP / placeholder — Bible §0/§9):
//
//   1. POINT-IN-TRIM CLASSIFICATION  (the core op). Given (u,v), classify
//      INSIDE / OUTSIDE / ON the trimmed region by an even-odd ray-cast against
//      the flattened trim pcurves. The holes are handled automatically: a point
//      inside the outer loop AND inside a hole loop is crossed an even number of
//      times overall, so it classifies OUTSIDE the material. A configurable
//      on-boundary tolerance reports ON.
//
//   2. TRIM-RESPECTING ADAPTIVE TESSELLATION. Flatten every loop into a (u,v)
//      polyline (chordal-adaptive in parameter space, curvature-aware), add
//      curvature-adaptive interior Steiner points, run constrainedDelaunay2D with
//      the loop polylines as constraint edges, KEEP the even-odd INSIDE triangles,
//      and map each vertex to 3D via the surface evaluator with a per-vertex
//      analytic normal. The result is watertight AT THE TRIM (the loop polyline
//      vertices are shared exactly by the boundary triangles).
//
//   3. TRIMMED-PATCH MASS-PROPERTIES (area at least): the surface integral
//      ∫∫_trim |S_u × S_v| du dv over the trimmed region. Two paths:
//        * PLANAR-EXACT: when the surface is planar, the area is the Jacobian
//          (constant |S_u × S_v|) times the SIGNED PLANAR AREA enclosed by the
//          trim loops, computed by Green's theorem on the ANALYTIC pcurves (a
//          Circle2 hole contributes exactly π r², so a square-with-round-hole is
//          L² − π r² to machine precision — NOT a chord-polygon underestimate).
//        * QUADRATURE: otherwise, Gauss-Legendre quadrature of |S_u × S_v| over
//          each inside (u,v) triangle of a refined trim tessellation (converges to
//          the true patch area; exercised on a cylindrical patch in the gate).
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL algorithms only, pure C++20 + stdlib (no new deps, no OCCT, no WASM).
// ADDITIVE: a brand-new header + TU; the native path (Surface/Topology/Boolean)
// is untouched. Robustness posture: the CDT mesher decides every COMBINATORIAL
// choice with the exact orient2d/incircle predicates; the point-in-trim crossing
// parity is taken from the same exact segmentIntersect-style orientation signs.
// Coordinate placement (Steiner points, loop flattening) is plain double. This is
// the kernel's stated "robust-in-practice with exact predicates" ceiling, not an
// EPECK construction kernel.
//
// CONVENTIONS: namespace forge::native::brep. Trim loops are given in (u,v) and
// must lie inside the surface's clamped knot domain. Outer loop CCW, inner (hole)
// loops CW — but the even-odd classification does not actually depend on the
// winding (it depends only on closure), so a mis-wound but closed loop set still
// classifies correctly; the winding convention is documented for orientation of
// the emitted normals.

#ifndef FORGE_NATIVE_BREP_TRIMMEDFACE_HPP
#define FORGE_NATIVE_BREP_TRIMMEDFACE_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/brep/Nurbs.hpp"          // Vec3, NurbsSurface
#include "forge/native/brep/Curve.hpp"          // PCurve, UVCoord

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// TrimLoop — one ordered, CLOSED ring of pcurves in the surface (u,v) plane.
//
// `segments` are the pcurves in ring order; the end of segment i must coincide
// (in (u,v)) with the start of segment i+1, and the last with the first, so the
// ring is closed. `isOuter` is true for the single peripheral loop, false for an
// inner (hole) loop. Convention (not required for classification): outer CCW,
// inner CW. A loop may be a single pcurve that is itself closed (a Circle2 over
// [0,2π], or a closed BSpline2).
// ---------------------------------------------------------------------------
struct TrimLoop {
    std::vector<PCurve> segments;
    bool isOuter = true;
};

// ---------------------------------------------------------------------------
// TrimmedFace — a rational B-spline SURFACE + N (u,v) trim loops.
//
// Exactly one loop should be `isOuter`; the rest are holes. The surface must be a
// valid clamped NURBS surface (validateSurface). All loop pcurves must evaluate
// inside the surface's [u0,u1]×[v0,v1] knot domain.
// ---------------------------------------------------------------------------
struct TrimmedFace {
    NurbsSurface surface;
    std::vector<TrimLoop> loops;

    // True iff `surface` is a valid clamped NURBS surface and there is at least
    // one loop with at least one segment. (Does NOT verify ring closure / domain
    // containment — those are checked by the ops below, which fail honestly.)
    bool valid(const char** reason = nullptr) const;
};

// ===========================================================================
// (1) POINT-IN-TRIM CLASSIFICATION
// ===========================================================================

enum class TrimClass {
    Inside,   // (u,v) is on the material side of the trim (in outer, not in any hole)
    Outside,  // outside the outer loop, or inside a hole
    On        // within `onTol` (parameter-space units) of a loop boundary
};

// Flatten each loop into a (u,v) polyline (chordal-adaptive, `loopSamples` chord
// segments per pcurve as a base density, refined where the pcurve curves) and
// classify (u,v) by the even-odd crossing parity of a +u ray against ALL loop
// segments. A point inside the outer loop and inside K holes is crossed with
// parity (1 + K) — odd ⇒ material when K even, so a hole flips it OUTSIDE exactly.
//
// `onTol` (parameter-space units): if the point is within onTol of any loop
// segment it is reported On. The crossing parity itself is taken from the exact
// orientation sign of each segment relative to the query (no float tie-break on
// the combinatorial decision), so the in/out answer is stable away from On.
TrimClass classifyPointInTrim(const TrimmedFace& face, const UVCoord& q,
                              double onTol = 1e-9,
                              std::size_t loopSamples = 64);

// ===========================================================================
// (2) TRIM-RESPECTING ADAPTIVE TESSELLATION
// ===========================================================================

// A watertight-at-the-trim triangle mesh of the trimmed region, in 3D, with
// per-vertex unit normals. `uv` carries the (u,v) parameter of every vertex (so a
// caller can re-evaluate / texture). `triangles` index into positions/normals/uv;
// every triangle lies INSIDE the trimmed region (even-odd inside).
struct TrimMesh {
    bool ok = false;
    std::vector<Vec3>                  positions;  // 3D vertex positions S(u,v)
    std::vector<Vec3>                  normals;    // per-vertex unit normals
    std::vector<UVCoord>               uv;         // per-vertex (u,v)
    std::vector<std::array<std::uint32_t, 3>> triangles;  // CCW in (u,v)
    const char* reason = "";
};

// Parameters controlling the trim-respecting tessellation.
struct TessellateOptions {
    // Base chord segments per loop pcurve (the boundary is at least this fine;
    // curvature refinement may add more on a strongly-curved pcurve).
    std::size_t loopSamples = 48;
    // Interior Steiner-point grid resolution per direction (a regular (u,v) grid
    // of candidate interior points; each is added only if it classifies strictly
    // INSIDE the trim with a margin, so the CDT fills the interior with well-shaped
    // triangles instead of a few long slivers spanning the whole patch).
    std::size_t interiorGrid = 12;
    // Curvature-adaptive interior density: where the surface curvature radius is
    // small the local target spacing shrinks toward `interiorGrid`*this factor.
    double curvatureRefine = 2.0;
    // On-boundary tolerance used when deciding interior-point membership.
    double onTol = 1e-9;
};

TrimMesh tessellateTrimmedFace(const TrimmedFace& face,
                               const TessellateOptions& opt = {});

// ===========================================================================
// (3) TRIMMED-PATCH MASS-PROPERTIES (area)
// ===========================================================================

struct TrimmedMassProps {
    bool   ok = false;
    double area = 0.0;        // ∫∫_trim |S_u × S_v| du dv
    bool   planarExact = false;  // true when the planar-exact Green's path was used
    const char* reason = "";
};

// Compute the surface area of the trimmed region. Uses the PLANAR-EXACT Green's
// path (analytic pcurve loop integral × constant Jacobian) when the surface is a
// degenerate-to-planar B-spline (all control points coplanar and the chart affine,
// detected from the partials being constant), otherwise Gauss-Legendre quadrature
// over a refined trim tessellation. `quadRefine` subdivides each tessellation
// triangle into 4^quadRefine sub-triangles for the quadrature (convergence knob).
TrimmedMassProps trimmedFaceArea(const TrimmedFace& face,
                                 std::size_t quadRefine = 2,
                                 const TessellateOptions& tessOpt = {});

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_TRIMMEDFACE_HPP
