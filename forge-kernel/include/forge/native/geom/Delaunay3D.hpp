// forge/native/geom/Delaunay3D.hpp
//
// In-house 3D Delaunay tetrahedralization — forge::native::geom.
//
// CGAL-class increment (one slice of a multi-year program; the remainder is
// TARGETED — see "TARGETED REMAINDER" below). What ships here is REAL and
// VALIDATED against the standalone gate in
// test/native/geom/delaunay3d_test.cpp:
//
//   delaunay3D — Bowyer-Watson incremental Delaunay tetrahedralization of a 3D
//                point set. Every decision that determines the COMBINATORIAL
//                structure of the tetrahedralization (point-in-circumsphere, and
//                the orientation of each tetrahedron / cavity face) is taken
//                from the ROBUST adaptive-exact predicates in
//                forge/native/Predicates.hpp — orient3d and insphere — never
//                from a floating-point tolerance. The result is a set of
//                tetrahedra, as index quads into the input point array, each
//                wound with POSITIVE orientation (orient3d(a,b,c,d) > 0),
//                satisfying the empty-circumsphere Delaunay property: no input
//                point lies STRICTLY inside the circumsphere of any output
//                tetrahedron (insphere <= 0 for every tet / point pair). The
//                outward-oriented triangles of the CONVEX HULL of the point set
//                are returned alongside (the boundary faces of the tet mesh).
//
// ALGORITHM
// ---------
// Classic Bowyer-Watson in 3D:
//   1. Build a "super-tetrahedron" large enough to contain every input point in
//      its interior. Its four vertices are kept as virtual indices.
//   2. Insert input points one at a time. For each point p:
//        a. Find every existing tetrahedron whose circumsphere STRICTLY
//           contains p (insphere(tet, p) == POSITIVE). These are the "bad"
//           tetrahedra; their union is a star-shaped cavity around p.
//        b. The boundary of that cavity (triangular faces incident to exactly
//           one bad tetrahedron) forms a closed surface. Delete the bad
//           tetrahedra and re-tetrahedralize the cavity by connecting p to every
//           boundary face.
//   3. After all points are inserted, drop every tetrahedron that still
//      references a super-tetrahedron vertex. The remainder is the Delaunay
//      tetrahedralization of the input; its boundary faces are the convex hull.
//
// Insertion order is randomized (deterministic LCG seed) so the expected cavity
// size stays O(1) and the structure does not degrade on sorted input. The
// internal seed is fixed so the gate is reproducible; a custom seed only changes
// the (still valid) diagonal choice on cospherical sets — the empty-sphere
// property holds for EVERY seed.
//
// ROBUSTNESS POSTURE (honest, per KERNEL_INHOUSE_ROADMAP.md §0 / Bible §0):
//   "robust-in-practice with exact predicates", NOT proven-exact (rational /
//   EPECK). The cavity / bad-tet decisions are EXACT (driven by the exact
//   insphere / orient3d signs), which is precisely what makes Bowyer-Watson
//   robust on cospherical and near-degenerate sets: with a perturbation-free
//   exact insphere, the set of bad tetrahedra is always a single connected
//   star-shaped region, so no overlapping or inverted tetrahedron can be
//   produced. The ONE place a double is still load-bearing is the construction
//   of the super-tetrahedron coordinates from the input bounding box; this only
//   has to be "large enough", and is checked by the gate (the final mesh
//   contains no super vertex and its tet volumes sum to the hull volume).
//   Duplicate input points are removed up front (exact equality) because a
//   duplicate has an undefined circumsphere membership; the returned index quads
//   reference the surviving unique points (see Delaunay3DResult::points).
//
// COSPHERICAL / DEGENERATE HANDLING (load-bearing case for robust insphere):
//   On a cospherical set (e.g. the 8 corners of a cube, or points on a common
//   sphere) a NAIVE float insphere would flip sign unpredictably and can carve a
//   non-star-shaped or disconnected cavity, yielding overlapping / inverted
//   tetrahedra. Because insphere here returns the EXACT sign, a point exactly ON
//   a circumsphere is ZERO (not "bad"), the cavity stays exactly the connected
//   set of tetrahedra that strictly contain p, and the output is a valid
//   tetrahedralization (some valid diagonalization of each cospherical cell).
//
// TARGETED REMAINDER (intentionally absent from this increment):
//   * Constrained / conforming Delaunay (forced facets / edges).
//   * Delaunay refinement / quality meshing (no sliver removal here).
//   * Voronoi / power-diagram dual extraction.
//   * Regular (weighted) triangulations.
//   * A symbolic perturbation (SoS) to make the diagonalization on cospherical
//     cells canonical (currently any VALID diagonalization is accepted).
//   * DEGENERATE INPUTS that have no 3D tetrahedralization (fewer than 4 unique
//     points, or ALL points coplanar) are reported via ok=false rather than
//     producing zero-volume tetrahedra or falling back to a 2D triangulation;
//     the 2D-projection fallback is a later slice.
//
// CONVENTIONS: pure C++20, standard library only. No OCCT, no WASM, no
// third-party libs. Reuses forge/native/geom/Geom.hpp (Point3) and the exact
// predicates in forge/native/Predicates.hpp. It does NOT re-declare Point3 nor
// re-implement any predicate.

#ifndef FORGE_NATIVE_GEOM_DELAUNAY3D_HPP
#define FORGE_NATIVE_GEOM_DELAUNAY3D_HPP

#include <vector>
#include <array>
#include <cstddef>
#include <cstdint>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"  // reuse Point3 (no duplicate type)

namespace forge {
namespace native {
namespace geom {

// Result of a 3D Delaunay tetrahedralization.
//
//   tetrahedra — index quads into `points` (see below). Each tetrahedron is
//                wound with POSITIVE orientation: orient3d(a,b,c,d) > 0, so its
//                signed volume det[(a-d),(b-d),(c-d)]/6 is positive.
//   hullFaces  — index triples into `points` for the triangular faces of the
//                convex hull of the point set (the boundary of the tet mesh).
//                Each triangle is wound COUNTER-CLOCKWISE as seen from OUTSIDE
//                the hull (its outward normal points away from the interior),
//                matching the convexHull3D convention in Geom.hpp.
//   points     — the surviving UNIQUE input points, in their original input
//                order with exact duplicates removed. Tet/face indices reference
//                THIS array (so a self-contained mesh travels in the result).
//   inputIndex[i] — the index in the ORIGINAL caller array that point i came
//                from (the first occurrence, for duplicates).
//   ok         — false when the input cannot be tetrahedralized into nonzero-
//                volume tetrahedra: fewer than 4 unique points, or all unique
//                points coplanar. In those cases tetrahedra/hullFaces are empty
//                and `reason` explains why (no geometry is fabricated to pass).
struct Delaunay3DResult {
    bool ok{false};
    std::vector<Point3>             points;       // unique points, mesh-local
    std::vector<int>                inputIndex;   // points[i] -> original index
    std::vector<std::array<int,4>>  tetrahedra;   // POSITIVE-orient index quads
    std::vector<std::array<int,3>>  hullFaces;    // CCW-outward hull triangles
    const char* reason{""};                       // why ok==false, for diagnostics
};

// Compute the Delaunay tetrahedralization of `pts`.
//
// Deterministic for a given input (the internal randomized insertion order uses
// a fixed seed), so the gate is reproducible. Passing a custom `seed` only
// changes the (still valid) diagonalization on cospherical cells; the empty-
// circumsphere property holds for every seed.
Delaunay3DResult delaunay3D(const std::vector<Point3>& pts,
                            std::uint64_t seed = 0x9E3779B97F4A7C15ull);

// ---------------------------------------------------------------------------
// Verification helpers (used by the gate; also useful to downstream callers
// that want to assert the invariants on a tetrahedralization they were handed).
// These re-use the EXACT predicates, so they are themselves robust.
// ---------------------------------------------------------------------------

// True iff every tetrahedron is POSITIVE-oriented and NO point of
// `result.points` lies strictly inside any tet's circumsphere (the empty-
// circumsphere Delaunay property, decided exactly by insphere).
bool isDelaunay3D(const Delaunay3DResult& result);

// True iff the tetrahedra form a valid (non-overlapping, non-inverted) cell
// complex: every tetrahedron is POSITIVE-oriented and every triangular face is
// shared by exactly one (boundary) or two (interior) tetrahedra — an overlap
// would force a face to be used 3+ times. (Combinatorial check, no tolerance.)
bool isValidTetrahedralization(const Delaunay3DResult& result);

// Sum of the (positive) volumes of all tetrahedra. For a valid Delaunay mesh of
// a point set this equals the volume of the convex hull of the points. Computed
// from the exact-oriented tets in plain double (the VALUE is a double; the
// orientation that fixes its sign is exact).
double totalTetVolume(const Delaunay3DResult& result);

// Volume enclosed by `result.hullFaces` (outward-CCW triangles) via the
// divergence theorem: sum over faces of dot(a, cross(b,c))/6. For a closed,
// outward-oriented hull this is the convex-hull volume; it must equal
// totalTetVolume(result) for a valid mesh.
double hullVolume(const Delaunay3DResult& result);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_DELAUNAY3D_HPP
