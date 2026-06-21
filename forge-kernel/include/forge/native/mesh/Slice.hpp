// forge/native/mesh/Slice.hpp
//
// forge::native::mesh::Slice — planar cross-section (CAM / 3D-print layering) of
// a closed 2-manifold triangle mesh by a plane, for the in-house Forge native
// kernel. Pure C++20, ZERO external dependencies: standard library plus the
// existing forge/native headers only. No OCCT, no WASM, no third-party libs.
//
// WHAT THIS MODULE DOES (honest scope — Bible §0/§9)
// --------------------------------------------------
// Given a closed, 2-manifold triangle mesh and an oriented plane (a point on the
// plane + a unit normal), compute the set of CLOSED contour polylines where the
// plane cuts the surface. This is exactly the per-layer outline a slicer hands a
// CAM tool-path generator or an FDM extruder.
//
// HOW (the standard, robust-in-practice slicing pipeline):
//   1.  Signed distance of every vertex to the plane,  s(v) = N · (v - P).
//   2.  Every mesh EDGE whose two endpoints straddle the plane (one strictly
//       above, one strictly below) carries exactly ONE intersection point, found
//       by linear interpolation. Because that point is keyed by the UNORDERED
//       endpoint-vertex pair, the two triangles sharing the edge get the SAME
//       contour vertex — this is what lets us stitch.
//   3.  Each crossed triangle contributes ONE oriented segment between its two
//       crossing points; the segment is oriented so the SOLID interior (the
//       N·(x-P) < 0 half-space) stays on its left in the plane's CCW frame — so
//       every output loop is consistently wound (CCW about +N for an outer
//       boundary of solid material).
//   4.  Segments sharing a contour vertex are walked into closed loops.
//
// TANGENT / GRAZING CASES (handled WITHOUT duplicate or degenerate loops):
//   A vertex or edge lying exactly ON the plane is the degenerate heart of any
//   slicer. We classify each vertex's side by the EXACT sign of s(v) computed
//   through a consistent rule, and we only emit a crossing for an edge whose
//   endpoints are STRICTLY on opposite sides. A triangle that merely touches the
//   plane at one vertex, or lies flat in the plane, contributes NO segment — so a
//   plane grazing the silhouette produces no spurious zero-length loops. A plane
//   that is fully tangent (touches at isolated points only) yields zero contours,
//   ok=true. (A face lying exactly coplanar with the plane is reported as the
//   honest unsupported case — see SliceResult::reason — because its outline is the
//   face boundary, not a transversal cut; ok stays true with that face skipped,
//   and `coplanarFaces` counts them so the caller is never silently misled.)
//
// VALIDATED (test/native/mesh/slice_test.cpp, fresh random seed each run):
//   * Sphere radius R sliced at height h -> ONE loop; fitted radius ~ sqrt(R²-h²)
//     and enclosed area ~ π(R²-h²) within a coarse-mesh tolerance.
//   * Box sliced at mid-height -> its rectangular cross-section: correct area and
//     exactly 4 corners.
//   * A plane missing the mesh entirely -> 0 contours, ok=true, empty.
//   * Tangent / grazing plane -> no duplicate / degenerate loops.
//
// ROBUSTNESS POSTURE (stated up front, do NOT overclaim):
//   The COMBINATORIAL crossing decision (which edges cross, loop connectivity) is
//   driven by the sign of the signed distance, made consistent so that an edge
//   and its two endpoints agree; the intersection COORDINATE is an ordinary
//   double from linear interpolation (the same honest ceiling the rest of the
//   mesh engine ships). This is "robust-in-practice", NOT a proven-exact
//   construction kernel.
//
// 0 FAKES (Bible §0): ok==true is returned ONLY when the contour set was actually
// stitched into closed loops (or is legitimately empty). Malformed input
// (ragged arrays, out-of-range indices, non-finite coords, a non-unit / zero
// normal) and a stitch that could not close a loop yield ok==false with a
// human-readable reason; geometry is NEVER fabricated to pass a test.

#ifndef FORGE_NATIVE_MESH_SLICE_HPP
#define FORGE_NATIVE_MESH_SLICE_HPP

#include <cstdint>
#include <vector>

#include "forge/native/mesh/HalfEdgeMesh.hpp"

namespace forge {
namespace native {
namespace mesh {

// A single closed contour: an ordered ring of 3D points lying on the cut plane.
// The ring is NOT explicitly closed (the last point is not a duplicate of the
// first); the closing edge is implicit (points.back() -> points.front()).
struct Contour {
    std::vector<Vec3> points;       // ordered ring (>= 3 points for a real loop)

    // 2D measures in the plane's own (u,v) frame (u,v,N right-handed):
    double area = 0.0;              // signed area in the plane; >0 == CCW about +N
    double perimeter = 0.0;         // total ring length
};

// Outcome of a planar slice.
struct SliceResult {
    bool ok = false;                       // true ONLY for an honestly-closed set
    std::vector<Contour> contours;         // the closed cross-section loops
    const char* reason = "";               // why ok==false (diagnostic; "" on ok)

    // Diagnostics (populated whenever the input parsed, regardless of ok):
    std::uint32_t numContours    = 0;      // contours.size()
    std::uint32_t crossedTris    = 0;      // triangles that produced a segment
    std::uint32_t coplanarFaces  = 0;      // faces lying exactly in the plane (skipped)
    double        totalArea      = 0.0;    // sum of |contour.area| over all loops
    double        totalPerimeter = 0.0;    // sum of contour.perimeter
};

// The cutting plane: a point P that lies on the plane and a normal N. N need not
// be pre-normalised by the caller — it is normalised internally — but it must be
// non-zero / finite (else ok=false, "degenerate plane normal").
struct Plane {
    Vec3 point;     // any point on the plane
    Vec3 normal;    // plane normal (interior of solid is the N·(x-P) < 0 side)
};

// Slice a closed 2-manifold triangle mesh (given as an indexed triangle soup) by
// `plane`, returning the set of closed contour loops.
//
//   positions : flat xyz triples, length == 3 * numVertices
//   indices   : flat CCW-wound triangle indices, length == 3 * numTriangles
//   plane     : the cutting plane (see Plane)
//
// Returns ok==false (with `reason` set) when:
//   * positions.size() or indices.size() is not a multiple of 3, OR
//   * any triangle index is out of range, OR
//   * any coordinate (mesh or plane) is non-finite, OR
//   * the plane normal is zero / non-finite, OR
//   * a crossing chain could not be stitched into a closed loop (open contour —
//     impossible on a watertight mesh, surfaced honestly if it ever occurs).
SliceResult slice(const std::vector<double>& positions,
                  const std::vector<std::uint32_t>& indices,
                  const Plane& plane);

// Convenience overload: slice an already-built HalfEdgeMesh. Exports to a soup
// and forwards to slice() above. The mesh need not be re-validated here; an open
// mesh simply yields open chains that fail to close -> ok=false with a reason.
SliceResult slice(const HalfEdgeMesh& mesh, const Plane& plane);

// Helper (exposed for testing / reuse): least-squares best-fit circle through a
// set of coplanar contour points, returning the fitted radius. `ok` is false for
// fewer than 3 points or a degenerate (collinear) fit. The fit is done in the
// plane's (u,v) frame derived from `normal`.
double fitCircleRadius(const std::vector<Vec3>& pts, const Vec3& normal, bool& ok);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_SLICE_HPP
