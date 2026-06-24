// forge/native/geom/ConvexHull3D.hpp
//
// EXACT 3D convex hull (Quickhull) — forge::native::geom.  A CGAL-class
// primitive for the in-house Forge native kernel.
//
// =========================== WHAT THIS IS / IS NOT =========================
// REAL and VALIDATED against the standalone gate in
// test/native/brep/convex_hull_test.cpp:
//
//   convexHull3D_exact — the convex hull of a 3D point set computed by
//                        QUICKHULL (divide-and-conquer "beneath/beyond"), where
//                        EVERY face-orientation / point-above-face decision is
//                        taken from the EXACT orient3D predicate
//                        (forge::native::exactOrient3D, evaluated through
//                        ExactReal — see ExactPredicates3D.hpp), NEVER from a
//                        floating-point tolerance.  The result is returned as a
//                        triangle mesh (deduplicated hull vertices + CCW-outward
//                        index triples), with each ORIGINAL input point flagged
//                        as a hull vertex or interior, plus the exact divergence-
//                        theorem volume.  An optional brep::Solid is built from
//                        the same triangulation (toSolid).
//
// RELATIONSHIP TO geom::convexHull3D (Geom.hpp) — NOT a duplicate.
//   Geom.hpp::convexHull3D is the Wave-0 INCREMENTAL ("small point set") hull
//   that decides visibility with the fast adaptive double `orient3d` and a
//   centroid-reoriented horizon walk; it returns ONLY face index triples into
//   the caller's array (no vertex dedup, no volume, no interior-point report,
//   no solid, and a horizon scheme that is fragile on large clouds).  THIS file
//   is the higher-grade Quickhull primitive: a proper horizon extraction, the
//   EXACT (rational ExactReal) orient3D for every decision so no degenerate
//   flip is possible, a self-contained deduplicated mesh + volume + a per-input
//   inside/on/vertex classification + a brep::Solid emitter.  The two coexist;
//   downstream code that only needs a quick small-set hull may keep using
//   Geom.hpp, while exact / robust / mesh-returning callers use this one.
//
// ALGORITHM (Quickhull, beneath-beyond):
//   1. Build an initial non-degenerate tetrahedron from 4 affinely-independent
//      input points (two extremes, the farthest point off their line, then the
//      farthest point off their plane — all decisions exact-sign-checked).
//      Seed 4 outward-oriented triangular faces.
//   2. For every remaining point, assign it to the "outside set" of the first
//      face it lies strictly ABOVE (exactOrient3D sign POSITIVE w.r.t. that
//      outward face).  Points above no face are interior and never processed.
//   3. While any face has a non-empty outside set: pick its FARTHEST outside
//      point p (geometric distance to the face plane, used only to choose WHICH
//      point — never to make a combinatorial decision).  Compute the set of all
//      faces p can "see" (exactOrient3D POSITIVE) by flood fill; their union is
//      a connected region whose boundary is the HORIZON (edges shared by one
//      visible and one non-visible face).  Delete the visible faces and cone p
//      to every horizon edge, creating new outward-oriented faces.  Re-assign
//      the orphaned outside points of the deleted faces to the new faces.
//   4. When no face has outside points, the surviving faces are the hull.
//
// Every "above / below / coplanar" test in steps 1–3 is exactOrient3D, so the
// visible region is always the exact connected set of faces strictly below p
// and the horizon is always a single closed loop — which is precisely what
// makes Quickhull robust on cospherical / coplanar-cluster / duplicate inputs
// (a naive float orient3D flips sign there and produces a non-manifold or
// inverted hull).  The DISTANCE used to pick the farthest point is an ordinary
// double; it only selects which exact decision to make next and cannot corrupt
// the combinatorics (ties pick any farthest point — the hull is the same set).
//
// ROBUSTNESS POSTURE (honest, per KERNEL_INHOUSE_ROADMAP.md §0 / Bible §0):
//   "robust-in-practice with EXACT predicates."  The COMBINATORIAL structure
//   (which points are hull vertices, the winding of every face, the horizon) is
//   EXACT: it is decided entirely by the rational exactOrient3D sign, so there
//   are no degenerate flips and the hull of a cospherical or coplanar-cluster
//   set is correct.  The CONSTRUCTION COORDINATES are the input doubles
//   (vertices are exact copies of input points — Quickhull constructs no new
//   points), so the only non-exact quantity is the reported `volume` (a double
//   divergence-theorem sum) and the farthest-point DISTANCE used to order the
//   work.  This is NOT a rational-coordinate (EPECK) construction kernel; it is
//   the kernel's stated ceiling, and is exactly what the gate asserts:
//   cube-corner hull volume == side^3 to floating-point, sphere-sampled hull
//   volume converges to 4/3 pi R^3, and EVERY input point has exactOrient3D
//   sign <= 0 against EVERY hull face (provably inside-or-on the hull).
//
// DEGENERATE / DUPLICATE / COLLINEAR / COPLANAR INPUTS (handled honestly):
//   * Exact-duplicate points are collapsed up front (exact equality); the
//     returned hull references the unique survivors and the duplicate's original
//     index is classified the same as its representative.
//   * < 4 unique points, all-collinear, or all-coplanar inputs have NO 3D hull;
//     `ok` is false, `reason` explains, and (for the coplanar case) `coplanar`
//     is set so the caller can fall back to the 2D hull (convexHull2D) rather
//     than receiving a fabricated zero-volume solid.
//
// CONVENTIONS: pure C++20, standard library only.  No OCCT, no WASM, no third-
// party libs.  Reuses geom::Point3 (Geom.hpp), the EXACT predicate
// forge::native::exactOrient3D (ExactPredicates3D.hpp), and brep::TopologyBuilder
// (Topology.hpp) for the optional solid.  It re-declares NO point type and NO
// predicate.

#ifndef FORGE_NATIVE_GEOM_CONVEXHULL3D_HPP
#define FORGE_NATIVE_GEOM_CONVEXHULL3D_HPP

#include <array>
#include <cstddef>
#include <memory>
#include <vector>

#include "forge/native/geom/Geom.hpp"          // reuse geom::Point3 (no dup type)

namespace forge {
namespace native {
namespace brep { class TopologyBuilder; struct Solid; }  // fwd (toSolid only)
namespace geom {

// Result of an exact 3D convex hull.
//
//   vertices   — the hull vertices (a subset of the unique input points), as a
//                self-contained array.  Quickhull constructs no new points, so
//                each is an exact copy of an input coordinate.
//   faces      — CCW-OUTWARD triangle index triples into `vertices` (each
//                triangle's outward normal points away from the hull interior;
//                exactOrient3D(a,b,c, anyInteriorPoint) < 0).
//   hullVertexInput[i] — the ORIGINAL caller-array index that vertices[i] came
//                from (first occurrence for duplicates).
//   isHullVertex[k]    — for each ORIGINAL input index k, true iff that point is
//                a vertex of the hull (false for interior points AND for points
//                strictly on a hull facet/edge that are not corners — i.e. the
//                point is not a corner of the convex polytope).  Duplicates share
//                their representative's classification.
//   volume     — the enclosed volume of the hull (divergence theorem over the
//                outward faces).  A double; its sign is fixed by the exact
//                winding, the magnitude is floating-point.
//   coplanar   — true when ok==false specifically because all unique points are
//                coplanar (>=3 unique, well-defined 2D hull): the caller may
//                fall back to convexHull2D.  False for the other ok==false
//                reasons (<4 unique / all collinear).
//   reason     — human-readable explanation when ok==false (no geometry is
//                fabricated to pass).
struct ConvexHull3DResult {
    bool ok{false};
    std::vector<Point3>             vertices;        // hull corners, self-contained
    std::vector<std::array<int,3>>  faces;           // CCW-outward index triples
    std::vector<int>                hullVertexInput; // vertices[i] -> original idx
    std::vector<char>               isHullVertex;    // per ORIGINAL input index
    double                          volume{0.0};
    bool                            coplanar{false};
    const char*                     reason{""};
};

// Compute the EXACT convex hull of `pts` via Quickhull.  Deterministic for a
// given input (no randomization; the farthest-point pivot is a fixed rule).
ConvexHull3DResult convexHull3D_exact(const std::vector<Point3>& pts);

// ---------------------------------------------------------------------------
// Verification helpers (used by the gate; also useful to callers that want to
// assert the hull invariants).  All decisions go through the EXACT predicate,
// so the helpers are themselves robust (no tolerance in the sign decision).
// ---------------------------------------------------------------------------

// True iff EVERY original input point lies INSIDE-OR-ON the hull: for every
// hull face f and every input point p, exactOrient3D(f.a, f.b, f.c, p) >= 0
// (p is below-or-on the outward-oriented face — the interior side, with the
// CCW-outward winding, is the BELOW/positive side).  A point strictly OUTSIDE
// the hull would be above some face (orient < 0).  This is the exact, no-
// tolerance "all points inside the hull" certificate the gate requires.
// Returns false if the hull is not ok.
bool allPointsInsideOrOn(const ConvexHull3DResult& hull,
                         const std::vector<Point3>& pts);

// True iff EVERY hull face is OUTWARD-CONVEX: for every face and every hull
// vertex not on that face, exactOrient3D(a,b,c, v) >= 0 (every other vertex is
// below-or-on the face plane — i.e. the face is a true supporting plane of a
// convex polytope and is wound CCW-outward).  Vertices exactly ON the face
// plane (coplanar facets) give sign 0 and are accepted; a vertex ABOVE a face
// (orient < 0) would mean the face is not supporting.  Exact, no tolerance.
bool everyFaceOutwardConvex(const ConvexHull3DResult& hull);

// Enclosed volume of `hull.faces` (outward-CCW triangles) by the divergence
// theorem: sum over faces of dot(a, cross(b,c)) / 6.  Equals hull.volume; this
// is the same value the gate cross-checks against side^3 / (4/3 pi R^3).
double hullVolume(const ConvexHull3DResult& hull);

// Build a brep::Solid from the hull triangulation: one triangular Face per
// `hull.faces` entry, all outward-oriented, edges shared by exactly two faces
// (closed 2-manifold).  Returns nullptr when !hull.ok.  The returned Solid is
// owned by `builder` (its lifetime is the builder's), matching the kernel's
// TopologyBuilder ownership model.  Optional — callers wanting only the mesh
// need not link Topology.cpp.
brep::Solid* toSolid(const ConvexHull3DResult& hull,
                     brep::TopologyBuilder& builder);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_CONVEXHULL3D_HPP
