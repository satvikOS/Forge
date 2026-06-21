// forge/native/geom/ConstrainedDelaunay2D.hpp
//
// In-house 2D CONSTRAINED Delaunay triangulation — forge::native::geom.
//
// CGAL-class increment (one slice of the multi-year robust-geometry program;
// the unconstrained sibling lives in forge/native/geom/Delaunay.hpp). What
// ships here is REAL and VALIDATED against the standalone gate in
// test/native/geom/constraineddelaunay2d_test.cpp:
//
//   constrainedDelaunay2D — Constrained Delaunay triangulation (CDT) of a planar
//                straight-line graph (PSLG): an input point set PLUS a set of
//                required CONSTRAINT EDGES (segments that MUST appear in the
//                output as triangulation edges — e.g. a polygon boundary and the
//                boundaries of its holes). The result:
//                  (a) CONTAINS every constraint edge as an edge of the
//                      triangulation (the constrained guarantee); and
//                  (b) is DELAUNAY away from the constraints: for every NON-
//                      constrained edge, the empty-circumcircle property holds in
//                      its *constrained* form — no vertex VISIBLE across that edge
//                      (not separated from it by a constraint) lies strictly
//                      inside the circumcircle of either adjacent triangle.
//
//                Optionally the routine marks each output triangle as INSIDE or
//                OUTSIDE the region bounded by the constraint edges, using the
//                even-odd (crossing-parity) rule. This is what lets a polygon
//                WITH HOLES be triangulated and then reduced to exactly its
//                interior triangles.
//
// ALGORITHM
// ---------
//   1. De-duplicate input points EXACTLY (a duplicate has no well-defined
//      circumcircle membership). Map every caller constraint endpoint to its
//      surviving unique vertex index.
//   2. VALIDATE the constraint set: every constraint endpoint must be an input
//      vertex; no constraint may be degenerate (zero length); and NO two
//      constraint segments may properly cross or collinearly overlap (a
//      self-intersecting PSLG has no CDT). This is decided EXACTLY by the
//      orient2d-driven segmentIntersect classifier in Geom.hpp. On violation we
//      report ok=false HONESTLY with a reason — never a garbage mesh.
//   3. Build the UNCONSTRAINED Delaunay triangulation of the points
//      (Bowyer-Watson, exact incircle / orient2d), keeping full triangle
//      adjacency so constraint insertion can walk the mesh.
//   4. INSERT each constraint edge (Anglada's algorithm): if the edge is already
//      present, just flag it constrained. Otherwise collect the strip of
//      triangles the segment crosses, delete them, and re-triangulate the two
//      polygonal cavities on either side of the segment by a constrained
//      ear-clipping / recursive-Delaunay fill, flagging the inserted segment as
//      constrained so later flips never destroy it.
//   5. RESTORE the constrained-Delaunay property: Lawson edge-flip pass over all
//      NON-constrained interior edges — flip any edge that fails the exact
//      incircle test and whose flip is convex (constrained edges are pinned).
//   6. Optionally classify INSIDE/OUTSIDE: seed the unbounded region OUTSIDE and
//      flood across edges, toggling parity ONLY when an edge is a constraint
//      (even-odd). Triangles reached with odd parity are INSIDE.
//
// ROBUSTNESS POSTURE (honest, per KERNEL_INHOUSE_ROADMAP.md §0 / Bible §0):
//   "robust-in-practice with exact predicates", NOT a proven-exact (rational /
//   EPECK) construction kernel. Every COMBINATORIAL decision — point in
//   circumcircle, segment side / crossing, which triangles a constraint crosses,
//   ear convexity, flip legality, inside/outside parity — is taken from the
//   adaptive-exact predicates in forge/native/Predicates.hpp (orient2d,
//   incircle) and the orient2d-driven segmentIntersect classifier. So the mesh
//   topology is decided without floating-point tie-breaking. The ONE place a
//   double is still load-bearing is the super-triangle coordinate construction
//   from the bounding box, which only has to be "large enough" and is checked by
//   the gate (the final mesh contains no super vertex and its inside triangles
//   tile exactly the constraint polygon area).
//
// HONEST LIMITS (0 FAKES):
//   * The input PSLG must be EDGE-conforming: constraint endpoints must be input
//     points and constraints may not cross. We do NOT silently split crossing
//     constraints by inserting Steiner points; we report ok=false. (Conforming
//     CDT with Steiner refinement is a later TARGETED slice.)
//   * A constraint endpoint that is a duplicate of another input point is mapped
//     to the surviving unique vertex; a constraint whose two endpoints collapse
//     to the same unique vertex is degenerate and reported.
//   * Inside/outside marking assumes the constraint edges form CLOSED loops
//     (every vertex has even constraint-degree). If they do not, marking still
//     runs (parity flood) but `closedLoops` is reported false so the caller knows
//     the even-odd interior is only as meaningful as the loops are closed.
//
// CONVENTIONS: pure C++20, standard library only. NO OCCT, NO WASM, NO
// third-party libs. Reuses forge/native/geom/Geom.hpp (Point2, segmentIntersect)
// and the exact predicates in forge/native/Predicates.hpp. It does NOT re-declare
// Point2 nor re-implement any predicate.

#ifndef FORGE_NATIVE_GEOM_CONSTRAINEDDELAUNAY2D_HPP
#define FORGE_NATIVE_GEOM_CONSTRAINEDDELAUNAY2D_HPP

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"  // reuse Point2 + segmentIntersect

namespace forge {
namespace native {
namespace geom {

// A required constraint edge, given as two indices into the ORIGINAL caller
// point array. Order is irrelevant (an edge is undirected).
struct ConstraintEdge {
    int a{0};
    int b{0};
};

// Result of a constrained Delaunay triangulation.
//
//   triangles — index triples into `points`. Each triangle is wound
//               COUNTER-CLOCKWISE (orient2d(a,b,c) > 0).
//   inside    — parallel to `triangles`: inside[t] is true iff triangle t lies
//               INSIDE the even-odd region bounded by the constraint edges. When
//               there are no constraints, every triangle is "inside" (the whole
//               convex hull). Only meaningful when `closedLoops` is true; still
//               populated otherwise (see header limits).
//   points    — the surviving UNIQUE input points, original order, exact dups
//               removed. Triangle indices reference THIS array.
//   inputIndex[i] — original caller index that point i came from (first occ.).
//   constraintEdges — the de-duplicated constraint edges as undirected vertex
//               pairs (u<v) into `points`, every one of which is guaranteed to
//               be an edge of `triangles` on success.
//   closedLoops — true iff every vertex has even constraint-degree (the
//               constraints form closed loops), so the even-odd `inside`
//               classification is fully meaningful.
//   ok        — false (with `reason` set, `triangles` empty) when the input
//               cannot yield a CDT: fewer than 3 unique points, all unique
//               points collinear, a constraint endpoint out of range, a
//               degenerate (zero-length) constraint, or self-intersecting
//               constraints. We NEVER emit a partial / garbage mesh on failure.
struct CDTResult {
    bool ok{false};
    std::vector<Point2>            points;          // unique points, mesh-local
    std::vector<int>               inputIndex;      // points[i] -> original index
    std::vector<std::array<int,3>> triangles;       // CCW index triples
    std::vector<char>              inside;           // 1 == inside even-odd region
    std::vector<std::array<int,2>> constraintEdges;  // undirected (u<v) into points
    bool        closedLoops{false};
    const char* reason{""};                          // why ok==false
};

// Compute the constrained Delaunay triangulation of `pts` with required
// `constraints` (edges referencing ORIGINAL `pts` indices).
//
// Deterministic for a given input (the internal randomized insertion order uses
// a fixed seed). A custom `seed` only changes the (still valid) diagonal choice
// on cocircular sets and the unconstrained-region triangulation; the constrained
// guarantee and the constrained-Delaunay property hold for every seed.
CDTResult constrainedDelaunay2D(const std::vector<Point2>& pts,
                                const std::vector<ConstraintEdge>& constraints,
                                std::uint64_t seed = 0x9E3779B97F4A7C15ull);

// ---------------------------------------------------------------------------
// Verification helpers (used by the gate; also useful to downstream callers).
// All re-use the EXACT predicates, so they are themselves robust.
// ---------------------------------------------------------------------------

// True iff every constraint edge in `r.constraintEdges` appears as an edge of
// some triangle in `r.triangles`.
bool allConstraintsPresent(const CDTResult& r);

// True iff the CONSTRAINED Delaunay property holds: for every NON-constrained
// interior edge shared by two triangles (a,b,c) and (b,a,d), the apex d is NOT
// strictly inside the circumcircle of (a,b,c) (equivalently the local Delaunay /
// flip-free condition). Constrained edges are exempt (they may be non-Delaunay,
// that is the whole point of a CDT).
bool isConstrainedDelaunay(const CDTResult& r);

// Sum of the (exact-sign-consistent, double-magnitude) areas of the triangles
// flagged `inside`. Used by the gate to compare against the known polygon area.
double insideArea(const CDTResult& r);

// Sum of areas of ALL triangles (the whole triangulated convex hull).
double totalArea(const CDTResult& r);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_CONSTRAINEDDELAUNAY2D_HPP
