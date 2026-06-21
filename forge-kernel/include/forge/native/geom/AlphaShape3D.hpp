// forge/native/geom/AlphaShape3D.hpp
//
// In-house 3D alpha shape / alpha complex — forge::native::geom.
//
// CGAL-class increment (one slice of the multi-year in-house kernel program).
// What ships here is REAL and VALIDATED against the standalone gate in
// test/native/geom/alphashape3d_test.cpp:
//
//   alphaShape3D — the (fixed-alpha) 3D alpha complex of a point set, built on
//                  TOP of the in-house Delaunay tetrahedralization
//                  (forge/native/geom/Delaunay3D.hpp, reused by #include). For a
//                  given real parameter `alpha >= 0`, an "alpha-interior" tet is
//                  a Delaunay tetrahedron whose CIRCUMRADIUS r satisfies
//                  r <= alpha. The boundary of the alpha shape is the set of
//                  triangular Delaunay faces that bound exactly one alpha-interior
//                  tet (a face shared by an interior tet and either the unbounded
//                  exterior or a non-interior tet). The returned boundary
//                  triangles reconstruct the surface of the point cloud at scale
//                  `alpha`.
//
// RELATION TO CGAL'S Alpha_shape_3
// --------------------------------
//   This is the SOLID (regularized) alpha shape in the "general mode" sense
//   restricted to the FULL-DIMENSIONAL part: we keep a tet when its circumsphere
//   radius <= alpha and report the boundary of that union of tets. For a dense
//   sample of a solid (or of a closed surface with interior support points), the
//   union of alpha-interior tets is a solid ball-like region and its boundary is
//   the reconstructed closed surface. Lower-dimensional alpha faces/edges/vertices
//   that hang off the solid (CGAL's "singular" / "regular" simplices on isolated
//   features) are intentionally NOT emitted in this increment — see TARGETED
//   REMAINDER. This keeps the contract simple and verifiable: the boundary is
//   always a set of oriented triangles bounding a union of kept tets.
//
// KEY GUARANTEES (each asserted by the gate)
// -------------------------------------------
//   * alpha = +inf (or any alpha >= the largest circumradius) keeps EVERY
//     Delaunay tet, so the boundary is exactly the convex-hull boundary — the
//     SAME undirected triangle set as Delaunay3DResult::hullFaces.
//   * Every emitted boundary triangle belongs to a kept tet, hence is a face of
//     a tet whose circumradius <= alpha (the alpha-membership invariant).
//   * For points sampled on a sphere of radius R (plus interior support so the
//     ball is tetrahedralized solid), a suitable alpha reconstructs a CLOSED,
//     orientable surface whose enclosed volume ~ (4/3) pi R^3.
//   * alpha too small keeps no tet -> EMPTY boundary, reported honestly (ok=true,
//     boundary empty) — never fabricated geometry.
//   * Fewer than 4 points / all-coplanar / all-collinear input -> ok=false with
//     the Delaunay `reason` propagated (no zero-volume simplices invented).
//
// CIRCUMRADIUS (the one load-bearing double, by design)
// -----------------------------------------------------
//   The circumcenter of a tet (a,b,c,d) is the solution of the 3x3 linear system
//       2 (b-a) . x = |b|^2 - |a|^2,  etc.
//   and the circumradius is |center - a|. The COMBINATORIAL skeleton (which tets
//   exist, which faces are shared) is taken from the EXACT Delaunay predicates;
//   the circumradius VALUE that is compared against alpha is an ordinary double.
//   That is the honest robustness posture (per KERNEL_INHOUSE_ROADMAP.md §0 /
//   Bible §0): "robust-in-practice with exact predicates", NOT proven-exact. A
//   point exactly at r == alpha is INCLUDED (closed alpha complex, r <= alpha).
//
// TARGETED REMAINDER (intentionally absent from this increment):
//   * The full alpha-SPECTRUM (the sorted set of critical alpha values at which
//     simplices enter/leave) and per-simplex classification
//     (singular/regular/interior) as in CGAL's Alpha_shape_3.
//   * Lower-dimensional dangling alpha simplices (edges/faces/vertices not on the
//     boundary of any kept tet).
//   * Weighted (regular) alpha shapes and the alpha-shape of a moving alpha.
//
// CONVENTIONS: pure C++20, standard library only. No OCCT, no WASM, no
// third-party libs. Reuses forge/native/Predicates.hpp (exact orient3d) and
// forge/native/geom/Delaunay3D.hpp (the tetrahedralization + Point3). It does
// NOT re-declare Point3 nor re-run any predicate by hand.

#ifndef FORGE_NATIVE_GEOM_ALPHASHAPE3D_HPP
#define FORGE_NATIVE_GEOM_ALPHASHAPE3D_HPP

#include <array>
#include <cstdint>
#include <vector>

#include "forge/native/Predicates.hpp"
#include "forge/native/geom/Geom.hpp"        // Point3 (no duplicate type)
#include "forge/native/geom/Delaunay3D.hpp"  // delaunay3D + Delaunay3DResult

namespace forge {
namespace native {
namespace geom {

// A sentinel "alpha = +infinity" — any alpha >= this is treated as unbounded and
// recovers the convex-hull boundary. (Callers may also pass an actual
// std::numeric_limits<double>::infinity(); both are handled.)
double alphaInfinity();

// Result of a fixed-alpha 3D alpha shape.
//
//   boundary   — index triples into `points`, the oriented boundary triangles of
//                the alpha shape. Each triangle is wound so its normal points OUT
//                of the kept-tet region (CCW seen from outside the solid), exactly
//                like a hull face. Empty when no tet is kept (alpha too small) —
//                that is a HONEST result, not a failure.
//   keptTets   — index quads into `points`: the alpha-interior tets
//                (circumradius <= alpha), POSITIVE-oriented, copied from the
//                Delaunay mesh. Useful for volume / connectivity checks.
//   points     — the surviving UNIQUE input points (mesh-local), as produced by
//                the underlying Delaunay; boundary/keptTets index THIS array.
//   inputIndex[i] — original caller index that points[i] came from.
//   alpha      — the alpha value actually used (echoed for diagnostics).
//   maxCircumradius — the largest tet circumradius in the Delaunay mesh; any
//                alpha >= this keeps every tet (== convex hull). 0 when no tets.
//   ok         — false ONLY when the underlying Delaunay fails (degenerate input:
//                < 4 unique points, all coplanar, all collinear). On ok==false
//                boundary/keptTets are empty and `reason` is propagated from
//                Delaunay. ok==true with an EMPTY boundary is the legitimate
//                "alpha too small" outcome.
struct AlphaShape3DResult {
    bool ok{false};
    std::vector<Point3>            points;       // unique points, mesh-local
    std::vector<int>               inputIndex;   // points[i] -> original index
    std::vector<std::array<int,3>> boundary;     // outward-oriented boundary tris
    std::vector<std::array<int,4>> keptTets;     // alpha-interior tets
    double alpha{0.0};                           // alpha used
    double maxCircumradius{0.0};                 // largest tet circumradius
    const char* reason{""};                      // why ok==false, for diagnostics
};

// Compute the alpha shape of `pts` at parameter `alpha` (>= 0). `alpha` larger
// than `maxCircumradius` (or alphaInfinity(), or +inf) recovers the convex-hull
// boundary. A negative `alpha` is clamped to 0 (keeps only zero-radius tets,
// i.e. none for real input) and reported via the empty-but-ok path.
//
// `seed` is forwarded to the underlying Delaunay (only changes the diagonal
// choice on cospherical cells; the alpha-membership of a face is decided per tet
// and is invariant to that choice for non-cospherical alpha thresholds).
AlphaShape3DResult alphaShape3D(const std::vector<Point3>& pts,
                                double alpha,
                                std::uint64_t seed = 0x9E3779B97F4A7C15ull);

// Build directly from an EXISTING Delaunay result (avoids re-tetrahedralizing
// when several alphas are probed against the same point set). `del` must be the
// result of delaunay3D on the desired points; its `points`/`inputIndex` are
// carried into the AlphaShape3DResult. If `del.ok` is false the alpha shape is
// ok==false with the same reason.
AlphaShape3DResult alphaShape3DFromDelaunay(const Delaunay3DResult& del,
                                            double alpha);

// ---------------------------------------------------------------------------
// Verification helpers (used by the gate; also useful to downstream callers).
// ---------------------------------------------------------------------------

// Circumradius of the tet (a,b,c,d). Returns a non-negative double; for a
// degenerate (near-coplanar) tet whose circumcenter is ill-conditioned it
// returns +inf so such a tet is only ever kept by an unbounded alpha.
double tetCircumradius(const Point3& a, const Point3& b,
                       const Point3& c, const Point3& d);

// True iff `R.boundary` is a closed, orientable triangle surface (every directed
// edge appears exactly once and its reverse is also present). For a closed alpha
// shape (e.g. a well-sampled solid) this holds; for an EMPTY boundary it returns
// false (an empty surface is not "closed" — callers test emptiness separately).
bool alphaBoundaryIsClosed(const AlphaShape3DResult& R);

// Signed volume enclosed by `R.boundary` (outward-CCW triangles) via the
// divergence theorem: (1/6) sum dot(a, cross(b,c)). For a closed outward boundary
// this is the volume of the kept-tet union; it must equal the summed volume of
// `R.keptTets`. Zero for an empty boundary.
double alphaEnclosedVolume(const AlphaShape3DResult& R);

// Sum of the (positive) volumes of `R.keptTets`. Equals alphaEnclosedVolume(R)
// for a valid closed alpha shape.
double alphaKeptTetVolume(const AlphaShape3DResult& R);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_ALPHASHAPE3D_HPP
