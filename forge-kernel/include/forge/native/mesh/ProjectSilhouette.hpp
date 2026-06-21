// forge/native/mesh/ProjectSilhouette.hpp
//
// forge::native::mesh::ProjectSilhouette — project a triangle mesh onto a plane
// along a view / pull direction and extract the OUTER SILHOUETTE outline (the
// boundary of the UNION of all projected triangles) as closed 2D polygon(s),
// for 2D drawings / drafting / nesting / draft-pull analysis. Pure C++20, ZERO
// external dependencies: standard library plus the existing forge/native headers
// only. NO OCCT, NO WASM, NO third-party libs.
//
// WHAT THIS MODULE DOES (honest scope — Bible §0/§9)
// --------------------------------------------------
// Given a triangle mesh (indexed soup) and a view/pull DIRECTION D, every
// triangle is orthographically projected onto a plane whose normal is D, into
// the plane's own 2D (u,v) frame. The 2D region covered is the UNION of all
// those projected triangles (their shadow). We return the BOUNDARY of that union
// as a set of closed, consistently-wound 2D contours:
//   * the OUTER outline (the actual silhouette), wound CCW (signed area > 0), and
//   * any interior HOLE loops, wound CW (signed area < 0) — e.g. a torus viewed
//     along its axis projects to an ANNULUS: one outer circle + one inner circle
//     (2 contours), the inner one a hole.
// Concave inputs keep their concavity (this is the true union boundary, NOT a
// convex hull). A box projects to a rectangle or a hexagon depending on D.
//
// PROJECTION DIRECTION CONVENTION (stated precisely, per task brief)
// ------------------------------------------------------------------
//   `dir` D is the VIEW / PULL direction: the direction you look ALONG (the
//   direction of the parallel projection rays). The projection plane has normal
//   N = normalize(D). Each 3D point p maps to 2D coordinates
//       u = (p - origin) · U,   v = (p - origin) · V
//   where (U, V, N) is a right-handed orthonormal frame (U × V = N) built from N,
//   and `origin` is any chosen plane point (default: the mesh-bbox centre — the
//   choice of origin only translates the output, never changes its shape). The
//   silhouette is the shadow cast by rays travelling along +D onto that plane.
//   D and -D give the SAME silhouette shape (a shadow is direction-symmetric);
//   only the U-axis handedness (and hence the 2D mirroring) differs, which is why
//   the convention fixes a definite right-handed (U,V,N) frame.
//
// METHOD (robust-in-practice raster union + marching-squares boundary trace)
// --------------------------------------------------------------------------
// Computing the EXACT boundary of a union of arbitrarily many overlapping 2D
// triangles is a full 2D-arrangement / polygon-union problem (snap-rounding,
// coincident-coplanar stacks — the same hard core as a general mesh boolean).
// Rather than fake an exact arrangement, this module uses the standard, honestly
// convergent rasterization approach that real nesting / drafting silhouette
// tools use:
//   1. Project every triangle to the plane's (u,v) frame.
//   2. Rasterize the UNION onto a uniform occupancy grid sized to the projected
//      bbox at a caller-chosen resolution (cells across the longer axis). A cell
//      is OCCUPIED iff its centre lies inside ANY projected triangle (robust
//      point-in-triangle by orient2d sign agreement — exact combinatorial test).
//   3. Trace the boundary between occupied and empty cells with marching squares,
//      producing closed contour loops (outer boundary CCW, holes CW). This
//      naturally yields MULTIPLE contours: disjoint shadows and interior holes
//      (the torus annulus) each become their own loop, and concavities are kept.
//
// HONEST ENVELOPE (do NOT overclaim — Bible §0)
// ---------------------------------------------
//   The returned outline is accurate to ~ONE grid cell; its enclosed area and a
//   fitted circle radius CONVERGE to the analytic value as the resolution rises
//   (the gate asserts the residual SHRINKS under refinement and lands within a
//   resolution-set tolerance). The CONTOUR TOPOLOGY (number of separate loops,
//   outer-vs-hole nesting) is exact for features resolved by the grid — a hole or
//   gap THINNER than ~2 cells can be missed (under-resolved), which is reported,
//   never silently wrong. Cell-centre inside-tests use the robust orient2d
//   predicate so a cell's occupancy cannot be corrupted by float rounding; the
//   contour VERTEX coordinates are ordinary doubles at cell-edge midpoints (the
//   same robust-in-practice ceiling as the rest of the mesh engine). This is NOT
//   a proven-exact 2D-arrangement union — that remains TARGETED.
//
// 0 FAKES (Bible §0): ok==true is returned ONLY when the silhouette was actually
// rasterized and traced into closed loops (or is legitimately empty — a mesh with
// no positive-area projected coverage). Malformed input (ragged arrays,
// out-of-range indices, non-finite coordinates, a zero / non-finite direction, a
// non-positive resolution) yields ok==false with a human-readable reason;
// geometry is NEVER fabricated to pass a test.

#ifndef FORGE_NATIVE_MESH_PROJECTSILHOUETTE_HPP
#define FORGE_NATIVE_MESH_PROJECTSILHOUETTE_HPP

#include <cstdint>
#include <vector>

#include "forge/native/Predicates.hpp"          // robust orient2d (exact cell-in-tri)
#include "forge/native/geom/Geom.hpp"            // Point2 / Point3 (geom interop)
#include "forge/native/mesh/HalfEdgeMesh.hpp"    // Vec3 / HalfEdgeMesh / toSoup

namespace forge {
namespace native {
namespace mesh {

// A 2D point in the projection plane's (u,v) frame.
struct Point2D {
    double u = 0.0;
    double v = 0.0;
};

// One closed silhouette contour: an ordered ring of 2D points in the (u,v) frame.
// The ring is NOT explicitly closed (points.back() -> points.front() is implied).
//   * An OUTER boundary is wound counter-clockwise: signedArea > 0.
//   * A HOLE loop is wound clockwise: signedArea < 0.
struct SilhouetteContour {
    std::vector<Point2D> points;   // ordered ring (>= 3 points for a real loop)
    double signedArea = 0.0;       // 2D signed area; >0 == CCW outer, <0 == CW hole
    double perimeter  = 0.0;       // total ring length
    bool   isHole     = false;     // true iff this loop bounds a hole (signedArea<0)
};

// The 2D frame the silhouette lives in: (U, V, N) right-handed, N = normalize(dir),
// `origin` the chosen plane point. Returned so the caller can lift 2D points back
// to 3D:  p3 = origin + u*U + v*V.
struct ProjectionFrame {
    Vec3 origin{};   // plane point used as the 2D origin
    Vec3 U{};        // 2D +u axis (unit, ⟂ N)
    Vec3 V{};        // 2D +v axis (unit, ⟂ N and U); U × V = N
    Vec3 N{};        // plane normal = normalize(dir) (the view/pull direction)
};

// Outcome of a silhouette projection.
struct SilhouetteResult {
    bool ok = false;                            // true ONLY for an honest trace
    std::vector<SilhouetteContour> contours;    // outer + hole loops
    ProjectionFrame frame{};                    // the (U,V,N,origin) used
    const char* reason = "";                    // why ok==false ("" on ok)

    // Diagnostics (populated whenever the input parsed, regardless of ok):
    std::uint32_t numContours    = 0;           // contours.size()
    std::uint32_t numOuter       = 0;           // contours with signedArea > 0
    std::uint32_t numHoles       = 0;           // contours with signedArea < 0
    std::uint32_t gridW          = 0;           // occupancy grid width  (cells)
    std::uint32_t gridH          = 0;           // occupancy grid height (cells)
    std::uint32_t occupiedCells  = 0;           // # cells inside the union
    double        cellSize       = 0.0;         // grid cell edge length (u/v units)
    double        netArea        = 0.0;         // sum of signedArea = outer - holes
    double        totalPerimeter = 0.0;         // sum of contour.perimeter
};

// Project a triangle mesh (indexed triangle soup) along view/pull direction `dir`
// and extract the outer-silhouette outline (union boundary) as closed contours.
//
//   positions   : flat xyz triples, length == 3 * numVertices
//   indices     : flat triangle indices, length == 3 * numTriangles
//   dir         : view / pull direction (need NOT be unit; normalised internally).
//                 The projection plane normal is N = normalize(dir). See the
//                 PROJECTION DIRECTION CONVENTION in the header doc above.
//   resolution  : number of grid cells across the LONGER projected-bbox axis
//                 (>= 2). Higher = finer outline; area/radius converge as this
//                 rises. A typical drafting value is 256–1024.
//
// Returns ok==false (with `reason` set) when:
//   * positions.size() or indices.size() is not a multiple of 3, OR
//   * any triangle index is out of range, OR
//   * any coordinate (mesh or dir) is non-finite, OR
//   * `dir` is zero / non-finite (no projection plane), OR
//   * resolution < 2, OR
//   * the projected mesh has zero 2D extent (degenerate — every triangle projects
//     to a line/point along `dir`; no silhouette area to bound).
SilhouetteResult projectSilhouette(const std::vector<double>& positions,
                                   const std::vector<std::uint32_t>& indices,
                                   const Vec3& dir,
                                   std::uint32_t resolution = 256);

// Convenience overload: an explicit plane `origin` (otherwise the mesh-bbox
// centre is used). The origin only translates the 2D output; it never changes
// the silhouette's shape.
SilhouetteResult projectSilhouette(const std::vector<double>& positions,
                                   const std::vector<std::uint32_t>& indices,
                                   const Vec3& dir,
                                   const Vec3& origin,
                                   std::uint32_t resolution);

// Convenience overload: silhouette of an already-built HalfEdgeMesh. Exports to a
// soup and forwards. (The mesh need not be closed — a silhouette is defined for
// any triangle set, watertight or not.)
SilhouetteResult projectSilhouette(const HalfEdgeMesh& mesh,
                                   const Vec3& dir,
                                   std::uint32_t resolution = 256);

// Helper (exposed for testing / reuse): least-squares best-fit circle through a
// set of 2D contour points, returning the fitted radius. `ok` is false for fewer
// than 3 points or a degenerate (collinear) fit. Kåsa algebraic circle fit.
double fitCircleRadius2D(const std::vector<Point2D>& pts, bool& ok);

} // namespace mesh
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_MESH_PROJECTSILHOUETTE_HPP
