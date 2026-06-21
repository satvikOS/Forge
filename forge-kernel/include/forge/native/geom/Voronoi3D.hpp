// forge/native/geom/Voronoi3D.hpp
//
// In-house 3D Voronoi diagram — forge::native::geom.
//
// CGAL-class increment (one slice of a multi-year program). What ships here is
// REAL and VALIDATED against the standalone gate in
// test/native/geom/voronoi3d_test.cpp.
//
//   voronoi3D — the Voronoi diagram of a 3D point set, extracted as the EXACT
//               COMBINATORIAL DUAL of the Delaunay tetrahedralization produced
//               by forge::native::geom::delaunay3D (reused verbatim — this file
//               does NOT re-implement any triangulation). The geometry is built
//               from that dual:
//
//                 * Voronoi VERTICES are the circumcenters of the Delaunay
//                   tetrahedra. The circumcenter of a tet is the unique point
//                   equidistant from its four vertices; it is the corner of the
//                   Voronoi cells of all four sites of that tet. (Computed in
//                   plain double by solving the 3x3 linear system of the three
//                   perpendicular-bisector planes; the COMBINATORICS that decide
//                   which circumcenters belong to which cell come from the EXACT
//                   Delaunay dual, never from a tolerance.)
//
//                 * The Voronoi CELL of an input site s is the convex polyhedron
//                   of points closer to s than to any other site. Its corners are
//                   the circumcenters of the Delaunay tets incident to s (the
//                   duality below). For an INTERIOR site (not on the convex hull
//                   of the cloud) this polyhedron is BOUNDED; for a HULL site at
//                   least one incident Voronoi face runs to infinity, so its cell
//                   is UNBOUNDED — those cells are reported as unbounded and are
//                   NOT assigned a finite volume (we never fabricate a clipped
//                   volume to make a number).
//
//                   The bounded cell is built ROBUSTLY as the intersection of the
//                   perpendicular-bisector half-spaces between s and each of its
//                   Delaunay neighbours: starting from a large box, each bisector
//                   half-space (the side closer to s) is clipped off the convex
//                   polyhedron in turn. This always contains s (s is on the closer
//                   side of every bisector by construction), so the cell is a
//                   watertight convex polyhedron about its site — unlike the naive
//                   "convex hull of incident circumcenters", which a single far
//                   sliver-tet circumcenter from the robust-in-practice (not
//                   proven-exact) Delaunay can distort enough to exclude the site.
//                   The corners of the clipped polyhedron coincide with the
//                   incident circumcenters whenever the Delaunay star is clean; the
//                   clip construction is what keeps the cell correct when it is not.
//                   Boundedness is decided combinatorially (hull membership) and
//                   corroborated geometrically (a bounded cell never reaches the
//                   box); if the clip still touches the box the cell is reported
//                   UNBOUNDED rather than returning the box-clipped volume.
//
// DUALITY (why this is the Voronoi diagram, not an approximation):
//   The Delaunay tetrahedralization and the Voronoi diagram are combinatorial
//   duals: each Delaunay tet <-> one Voronoi vertex (its circumcenter); each
//   Delaunay triangle (shared by two tets) <-> one Voronoi edge (joining the two
//   circumcenters); each Delaunay edge (incident to a ring of tets) <-> one
//   Voronoi facet; each Delaunay vertex (site) <-> one Voronoi cell. Because the
//   underlying Delaunay structure is decided by the EXACT insphere / orient3d
//   predicates (see Delaunay3D.hpp), the SET of tets incident to each site — and
//   hence the SET of corners of each Voronoi cell — is exact. Only the corner
//   COORDINATES (the circumcenters) are ordinary doubles.
//
// BOUNDEDNESS (decided combinatorially, no tolerance):
//   A site's Voronoi cell is bounded iff the site does not lie on the convex
//   hull of the cloud. We read that straight off the Delaunay result: a site is
//   a hull vertex iff it appears in any triangle of Delaunay3DResult::hullFaces.
//   Sites absent from every hull face are interior; their cells are bounded. The
//   bounded cell's polyhedron is then the bisector half-space intersection
//   described above (a far clip box clipped by every neighbour bisector); its
//   volume is the divergence-theorem volume of that polyhedron. The clip also
//   corroborates boundedness geometrically: if the final polyhedron still has a
//   face on the box, the bisectors did not bound the cell and it is reported
//   unbounded. If a cloud has NO interior site (e.g. fewer than 5 points, or
//   every site on the hull) the result still reports ok=true with an EMPTY
//   bounded set and says so honestly via `reason`.
//
// POINT LOCATION (nearest-site query, the defining Voronoi property):
//   nearestSite(v, query) returns the index of the input site closest to a query
//   point — i.e. the site whose Voronoi cell contains the query. The shipped
//   query is an exact linear scan (squared distance, no sqrt) that BY DEFINITION
//   returns the site whose Voronoi cell contains the query (a Voronoi cell is
//   exactly the locus of points for which its site is nearest). The gate cross-
//   checks, for points inside a bounded cell, that this nearest site equals the
//   owner of that cell (the Voronoi-containment <=> nearest-site equivalence),
//   over >= 40 queries, against an independent brute-force nearest.
//
// ROBUSTNESS POSTURE (honest, per KERNEL_INHOUSE_ROADMAP.md §0 / Bible §0):
//   "robust-in-practice with exact predicates", NOT proven-exact (rational /
//   EPECK). The DUAL combinatorics (which tets touch a site, which sites are on
//   the hull, which cells are bounded) are exact because Delaunay3D is. The
//   Voronoi-vertex COORDINATES (circumcenters) and the cell VOLUMES are ordinary
//   doubles; they are not claimed bit-exact. Degenerate / cospherical inputs are
//   handled by the exact-predicate Delaunay underneath (a cube's 8 cospherical
//   corners triangulate into a valid mesh; the dual is built from whatever valid
//   diagonalization that yields). Inputs with no 3D Delaunay (fewer than 4
//   unique points, or all-coplanar / all-collinear) are reported via ok=false,
//   carrying the Delaunay reason forward (no geometry is fabricated to pass).
//
// CONVENTIONS: pure C++20, standard library only. No OCCT, no WASM, no
// third-party libs. Reuses forge/native/geom/Geom.hpp (Point3, convexHull3D),
// forge/native/geom/Delaunay3D.hpp (the dual triangulation), and the exact
// predicates in forge/native/Predicates.hpp. It does NOT re-declare Point3 nor
// re-implement any predicate or triangulation.

#ifndef FORGE_NATIVE_GEOM_VORONOI3D_HPP
#define FORGE_NATIVE_GEOM_VORONOI3D_HPP

#include <vector>
#include <array>
#include <cstddef>
#include <cstdint>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"        // reuse Point3, convexHull3D
#include "forge/native/geom/Delaunay3D.hpp"  // reuse the Delaunay dual

namespace forge {
namespace native {
namespace geom {

// One Voronoi cell — the region of space closer to its site than to any other.
//
//   site        — index into Voronoi3DResult::sites of the generating point.
//   bounded     — true iff this cell is a finite convex polyhedron (the site is
//                 interior to the cloud, not on its convex hull). An unbounded
//                 cell (hull site) has `bounded == false`, `volume == 0`, and
//                 `hullFaces` empty — we never assign it a fabricated volume.
//   vertexCount — number of incident Voronoi vertices (circumcenters of the
//                 tets incident to the site). Reported for both bounded and
//                 unbounded cells, so a caller can see a cell's complexity even
//                 when its extent is infinite.
//   vertices    — for a BOUNDED cell, the corner points of the cell polyhedron
//                 (the vertices of the bisector half-space intersection; for a
//                 clean Delaunay star these coincide with the incident
//                 circumcenters). `hullFaces` index INTO this array. Empty for an
//                 unbounded cell (whose corners are not all finite).
//   hullFaces   — for a BOUNDED cell, the triangular faces of the cell polyhedron,
//                 each wound counter-clockwise as seen from OUTSIDE the cell (its
//                 outward normal points away from the cell interior). Empty for an
//                 unbounded cell.
//   volume      — the polyhedron volume of a BOUNDED cell (divergence theorem).
//                 0 for an unbounded cell.
struct VoronoiCell {
    int  site{-1};
    bool bounded{false};
    int  vertexCount{0};
    std::vector<Point3>            vertices;
    std::vector<std::array<int,3>> hullFaces;  // CCW-outward, indices into vertices
    double volume{0.0};
};

// Result of a 3D Voronoi diagram.
//
//   ok            — false iff the cloud has no 3D Delaunay (fewer than 4 unique
//                   points, or all-coplanar / all-collinear). Then `cells` is
//                   empty and `reason` carries the Delaunay diagnosis forward.
//                   NOTE: ok==true even when there is NO bounded cell (e.g. a
//                   single tetrahedron: 4 points, all on the hull). That case is
//                   honest — the diagram exists, it just has no finite cell — and
//                   is flagged by `boundedCellCount == 0` plus `reason`.
//   sites         — the surviving UNIQUE input points (Delaunay-deduped), in the
//                   same order/indexing as Delaunay3DResult::points. Cell `site`
//                   and the nearestSite() return index reference THIS array.
//   inputIndex[i] — original caller index that sites[i] came from (first
//                   occurrence for duplicates), forwarded from the Delaunay.
//   voronoiVertices — the circumcenter of each Delaunay tet, in tet order (one
//                   per tet of the underlying Delaunay). These are the diagram's
//                   vertices; each cell's `vertices` are a subset of these.
//   cells         — one VoronoiCell per site (size == sites.size()), in site
//                   order. Cells for hull sites are present but `bounded==false`.
//   boundedCellCount — number of cells with `bounded == true`.
//   reason        — diagnostic string (why ok==false, or why no bounded cells).
struct Voronoi3DResult {
    bool ok{false};
    std::vector<Point3> sites;
    std::vector<int>    inputIndex;
    std::vector<Point3> voronoiVertices;   // one circumcenter per Delaunay tet
    std::vector<VoronoiCell> cells;        // one per site
    int  boundedCellCount{0};
    const char* reason{""};
};

// Compute the Voronoi diagram of `pts` as the dual of its Delaunay
// tetrahedralization. Deterministic for a given input (the underlying Delaunay
// uses a fixed seed); `seed` is forwarded to delaunay3D and only changes the
// (still valid) diagonalization on cospherical sets, which can change the dual's
// vertex coordinates but not the bounded/unbounded classification.
Voronoi3DResult voronoi3D(const std::vector<Point3>& pts,
                          std::uint64_t seed = 0x9E3779B97F4A7C15ull);

// ---------------------------------------------------------------------------
// Geometry helpers (also useful to downstream callers).
// ---------------------------------------------------------------------------

// Circumcenter of the tetrahedron (a,b,c,d): the unique point equidistant from
// all four vertices. `ok` is false iff the tet is degenerate (coplanar, no
// finite circumcenter). The COMBINATORICS upstream guarantee non-degenerate tets
// (every Delaunay tet is POSITIVE-oriented), so this never fails on Delaunay
// input; the flag exists for direct callers.
struct Circumcenter { bool ok{false}; Point3 center{}; };
Circumcenter tetCircumcenter(const Point3& a, const Point3& b,
                             const Point3& c, const Point3& d);

// Index of the input site nearest to `query` (smallest squared Euclidean
// distance) — BY DEFINITION the site whose Voronoi cell contains the query.
// Returns -1 if there are no sites. Ties (query exactly on a Voronoi facet)
// resolve to the smallest site index deterministically.
int nearestSite(const Voronoi3DResult& v, const Point3& query);

// ---------------------------------------------------------------------------
// Verification helpers (used by the gate; re-usable by downstream callers).
// ---------------------------------------------------------------------------

// Sum of the volumes of all BOUNDED cells. For a valid diagram this is <= the
// convex-hull volume of the sites (the bounded cells nest inside the hull and do
// not overlap), which the gate asserts.
double totalBoundedCellVolume(const Voronoi3DResult& v);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_VORONOI3D_HPP
