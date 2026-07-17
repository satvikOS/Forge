// forge/native/brep/Hlr.hpp
//
// forge::native::brep::Hlr — HIDDEN-LINE REMOVAL (HLR) for engineering drawings on
// the Forge native B-rep. The OCCT `HLRBRep_Algo` analogue: given a B-rep Solid
// and an ORTHOGRAPHIC view direction, project the solid's edges onto the view
// plane and classify every edge segment as VISIBLE (drawn solid) or HIDDEN
// (occluded by a face of the solid along the view direction — drawn dashed). This
// is the kernel substrate for 2D drawing generation (orthographic views: front /
// top / side / iso of a part, the classic "9 solid + 3 dashed" box drawing).
//
// docs/SCOPE_2026-06-24/kernel/brep-nurbs.md Phase F3 ("Native HLR for drawings").
//
// ============================ HONESTY (Bible §0/§9) ========================
// REAL algorithm only, pure C++20 + stdlib (no new deps, no OCCT, no WASM). This
// is the depth-buffer / ray-cast HLR every drafting kernel uses at its core:
//
//   1. EDGE COLLECTION. Gather the solid's drawable edges:
//        * every topological B-rep Edge (deduplicated across its two coedges), and
//        * the SILHOUETTE edges of curved analytic faces (cylinder/cone/sphere/
//          torus) — the locus where the view ray grazes the surface tangentially
//          (the surface normal · view-dir == 0), sampled along the face's curved
//          parameter direction. (Planar faces have no smooth silhouette.)
//   2. OCCLUSION FACE SET. Build a flat triangle soup of every face of the solid
//        (loop fan-triangulation; analytic curved faces are tessellated on their
//        (u,v) trim rectangle). This is the depth tester.
//   3. CLASSIFY. The ORTHOGRAPHIC path (hiddenLineRemoval) splits each edge at
//        the ANALYTIC visibility crossings: for every straight projected segment
//        it solves, in closed form, each t where the segment enters/leaves an
//        occluder face's projected outline and where its depth crosses that face's
//        plane depth (both linear in t). The segment is cut at those exact t's and
//        each piece is classified by a robust interior-midpoint in-front test
//        (hole-aware, excluding the edge's own incident faces). Consecutive
//        same-class pieces are merged, so each edge becomes an ordered list of
//        visible + hidden spans split EXACTLY at the true occlusion boundaries
//        (validated 1:1 against OCCT HLRBRep_Algo to rel<=1e-6). The PERSPECTIVE
//        path (hlrPerspective) is now ALSO ANALYTIC: although the perspective image
//        coordinates are non-linear (rational) in the segment parameter, every
//        visibility change is a WORLD-SPACE plane crossing that is LINEAR in t (the
//        plane through the eye and an occluder-triangle edge for a silhouette/outline
//        event; the occluder face plane for the depth swap; the eye plane for the
//        image-plane crossing), so the exact split parameters are solved in closed
//        form and each piece is classified by one exact eye-ray in-front test.
//
// HONEST ENVELOPE (do NOT overclaim — Bible §0):
//   * Solids handled: POLYHEDRAL (planar faces) + ANALYTIC-QUADRIC (cylinder /
//     cone / sphere / torus) faces, tessellated for the depth test. Freeform
//     trimmed-NURBS faces are tessellated by their loop polygon only (no smooth
//     silhouette precision) — a follow-up.
//   * Views: ORTHOGRAPHIC (parallel projection, hiddenLineRemoval) AND
//     PERSPECTIVE (pin-hole camera, hlrPerspective) — the perspective path
//     divides the lateral image coordinates by eye-relative depth (foreshortens)
//     and ray-casts occlusion FROM THE EYE (not parallel). Both share the same
//     polyhedral + analytic-quadric envelope.
//   * BOTH the ORTHOGRAPHIC and the PERSPECTIVE occlusion are resolved ANALYTICALLY:
//     the visible/hidden split points are the exact outline/depth crossings
//     (closed-form roots of linear functions of the segment parameter - solved in
//     the view plane for the ortho path, in world space for the perspective path),
//     classified by a robust interior in-front sample - so per-class projected
//     lengths match OCCT's exact HLR on the polyhedral gate. `samplesPerEdge` only
//     pre-chords CURVED edges; a STRAIGHT edge is split at the true crossings and is
//     exact at ANY samplesPerEdge value (even 1) under BOTH projections.
//
// 0 FAKES (Bible §0): a segment is reported HIDDEN only when a real face triangle
// was found strictly in front of its depth; an empty / degenerate solid yields an
// empty result with `ok==false` and a reason — geometry is never fabricated.
//
// CONVENTIONS: namespace forge::native::brep. Reuses Topology.hpp (Solid graph),
// Surface.hpp (analytic eval + Vec3 helpers), Nurbs.hpp (Vec3). No edits to the
// topology / surface / boolean path — a brand-new header + TU.

#ifndef FORGE_NATIVE_BREP_HLR_HPP
#define FORGE_NATIVE_BREP_HLR_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/brep/Nurbs.hpp"      // Vec3
#include "forge/native/brep/Topology.hpp"   // Solid / Face / Edge graph
#include "forge/native/brep/Surface.hpp"    // analytic Surface + Vec3 helpers

namespace forge {
namespace native {
namespace brep {

// ---------------------------------------------------------------------------
// HlrVisibility — the class of one projected edge span.
// ---------------------------------------------------------------------------
enum class HlrVisibility {
    Visible,  // not occluded — drawn as a SOLID line in the drawing
    Hidden    // occluded by a face of the solid — drawn DASHED
};

// ---------------------------------------------------------------------------
// The source kind of a collected edge (for diagnostics / styling).
// ---------------------------------------------------------------------------
enum class HlrEdgeKind {
    BRep,        // a topological B-rep Edge (a real model edge)
    Silhouette   // a smooth silhouette of a curved analytic face
};

// ---------------------------------------------------------------------------
// HlrSegment — one maximal run of an edge that is uniformly visible or hidden.
//
// `poly3d` is the ordered 3D polyline of this span (>= 2 points). `poly2d` is its
// orthographic image in the view plane's (U,V) frame — the 2D drawing geometry.
// `length2d` is the projected length of this span (the A/B-comparison metric).
// ---------------------------------------------------------------------------
struct HlrSegment {
    HlrVisibility       visibility = HlrVisibility::Visible;
    HlrEdgeKind         kind       = HlrEdgeKind::BRep;
    std::vector<Vec3>   poly3d;          // 3D polyline of the span
    std::vector<std::array<double, 2>> poly2d;  // 2D (u,v) image in the view plane
    double              length2d = 0.0;  // projected length of this span
    std::uint32_t       edgeId   = 0;    // source B-rep edge id (0 for silhouette)
};

// ---------------------------------------------------------------------------
// The 2D view frame the drawing lives in: (U, V, N) right-handed, N == the view
// direction (you look ALONG +N). A 3D point p maps to drawing coordinates
//   u = (p - origin)·U,  v = (p - origin)·V,  depth = (p - origin)·N
// (smaller depth == nearer the viewer, since the viewer sits at -infinity·N).
// ---------------------------------------------------------------------------
struct HlrViewFrame {
    Vec3 origin{};
    Vec3 U{1, 0, 0};
    Vec3 V{0, 1, 0};
    Vec3 N{0, 0, 1};   // view direction (unit)
};

// ---------------------------------------------------------------------------
// HlrResult — all classified segments + summary counts for the drawing.
// ---------------------------------------------------------------------------
struct HlrResult {
    bool ok = false;
    const char* reason = "";
    HlrViewFrame frame{};

    std::vector<HlrSegment> segments;   // all visible + hidden spans

    // Summary diagnostics (the A/B-comparison + test-assertion metrics):
    std::uint32_t visibleSegments = 0;  // # segments classed Visible
    std::uint32_t hiddenSegments  = 0;  // # segments classed Hidden
    // Per-edge counts (an edge is "fully visible" / "fully hidden" / "partial").
    std::uint32_t fullyVisibleEdges = 0;
    std::uint32_t fullyHiddenEdges  = 0;
    std::uint32_t partialEdges      = 0;  // an edge split into both classes
    std::uint32_t totalEdges        = 0;  // distinct collected edges
    // Total projected length by class (rel-comparable to OCCT HLRToShape).
    double visibleLength2d = 0.0;
    double hiddenLength2d  = 0.0;
};

// ---------------------------------------------------------------------------
// Options controlling the HLR pass.
// ---------------------------------------------------------------------------
struct HlrOptions {
    // Samples per edge for the visible/hidden span split. The occlusion boundary
    // along an edge is resolved to within one of these steps; consecutive same-
    // class spans are merged so a fully-visible edge stays a single segment.
    std::size_t samplesPerEdge = 64;
    // Tessellation density (segments per curved parameter direction) when an
    // analytic curved face is triangulated for the depth test / silhouette.
    std::size_t curveTess = 48;
    // A face triangle is treated as occluding a sample only when it lies in front
    // by more than this depth margin (model units), to suppress self-occlusion of
    // an edge by its own incident faces / coplanar grazes.
    double depthBias = 1e-6;
    // Lateral tolerance (model units) for "the ray hits this triangle": a sample
    // ray must land inside a triangle within this slack to count as occluded.
    double rayTol = 1e-9;

    // FEATURE-EDGE SUPPRESSION (facet-diagonal / smooth-seam culling).
    // When true, an interior MANIFOLD edge whose two DISTINCT incident faces lie
    // on the SAME underlying analytic surface — two COPLANAR planes (a
    // triangulation diagonal / an artificial planar split) OR the same
    // cylinder / cone / sphere / torus (a tessellation seam of a curved wall) —
    // is treated as a NON-FEATURE edge and is NOT drawn. Only SHARP feature edges
    // (the two incident faces are genuinely different surfaces across the edge)
    // and SILHOUETTE edges are kept — exactly what OCCT HLRBRep draws. This makes
    // a FACETED import (importOcctSolid, which triangulates every analytic face in
    // its (u,v) domain so each face's triangulation diagonal becomes a topological
    // Edge) draw only the real model edges + outline, instead of every facet edge
    // (a box imports as 18 edges = 12 real + 6 diagonals; culling restores 12).
    //
    // SAFETY: the test fires ONLY when BOTH incident faces carry an analytic
    // Surface AND those surfaces coincide, so a native solid whose faces are bare
    // polygons (surface == nullptr, e.g. TopologyBuilder::buildBox) is NEVER
    // affected — its real feature edges are all kept and the A/B-exact box/hole
    // results are unchanged. A NURBS/free-form wall's facet seams are conservatively
    // KEPT (freeform tangent detection is a follow-up).
    bool cullSmoothEdges = true;
    // Relative tolerance for the same-underlying-surface coincidence test above.
    double smoothTol = 1e-6;
};

// ===========================================================================
// hiddenLineRemoval — THE entry point.
//
// Project `solid` orthographically along `viewDir` (the direction you look ALONG;
// need not be unit, normalised internally) and classify every drawable edge span
// as visible or hidden. Returns ok==false with a reason for an empty / degenerate
// solid or a zero / non-finite `viewDir`.
// ===========================================================================
HlrResult hiddenLineRemoval(const Solid& solid,
                            const Vec3& viewDir,
                            const HlrOptions& opt = {});

// ===========================================================================
// PERSPECTIVE HLR (the orthographic follow-up).
//
// HlrCamera — a pin-hole perspective camera: you sit at `eye`, look toward
// `target`, with `up` the rough world-up (re-orthogonalised internally), and
// `fovYRadians` the FULL vertical field of view. The image plane is a unit
// focal distance ahead of the eye; the focal length is derived from the fov as
//   focal = 1 / tan(fovY / 2)
// so a point one focal-unit deep at the frustum edge maps to v = +-1.
// ===========================================================================
struct HlrCamera {
    Vec3   eye{0, 0, 0};
    Vec3   target{0, 0, 1};
    Vec3   up{0, 1, 0};
    double fovYRadians = 1.0471975511965976;  // 60 degrees default
};

// ---------------------------------------------------------------------------
// hlrPerspective — perspective hidden-line removal.
//
// Projects each drawable edge of `solid` through the pin-hole `cam` onto the
// image plane (lateral coordinates divided by eye-relative depth, so farther
// geometry foreshortens) and resolves occlusion by casting a ray FROM THE EYE
// through every edge sample against the solid's face triangles: a sample is
// HIDDEN when a face (other than the edge's own incident faces) is pierced
// strictly nearer the eye along that ray. Same honest envelope as the
// orthographic path (polyhedral + analytic-quadric; smooth-silhouette-exact and
// analytic-exact HLR remain follow-ups).
//
// The returned HlrViewFrame's (U,V,N) is the camera basis with origin == eye and
// N == normalize(target - eye); each HlrSegment's poly2d holds the PERSPECTIVE
// image coordinates (u/depth*focal, v/depth*focal), and length2d the projected
// length in that image plane. Returns ok==false with a reason for an empty /
// degenerate solid, a degenerate camera (eye==target or up parallel to the look
// direction), or a non-positive / non-finite fov. Geometry behind the eye plane
// (non-positive depth) cannot be projected and is reported via the reason.
// ---------------------------------------------------------------------------
HlrResult hlrPerspective(const Solid& solid,
                         const HlrCamera& cam,
                         const HlrOptions& opt = {});

} // namespace brep
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_BREP_HLR_HPP
