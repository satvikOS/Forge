// forge/native/geom/MinkowskiSum3D.hpp
//
// In-house 3D Minkowski sum of two CONVEX point sets — forge::native::geom.
//
// Pure C++20, standard library only. NO OCCT, NO WASM, NO third-party libs.
// Builds ONLY on the existing native headers (Predicates.hpp via geom/Geom.hpp).
// This is an additive module: it does not modify any existing file. It REUSES
// the validated forge::native::geom::convexHull3D (incremental, robust-orient3d)
// for the construction step rather than re-deriving a hull here.
//
// WHAT THIS IS (CGAL-class, stated honestly per Bible §0):
//   The Minkowski sum A (+) B of two point sets is the set { a + b : a in A,
//   b in B }. For two CONVEX sets, the Minkowski sum is itself convex and is
//   exactly the convex hull of the pairwise sums of their VERTICES:
//
//       A (+) B  =  conv( { a_i + b_j : a_i in V(A), b_j in V(B) } )
//
//   So for convex inputs the operation is exact (up to the double-precision
//   coordinate placement and the robustness ceiling of convexHull3D): we form
//   the |A|*|B| pairwise sums and take their 3D convex hull. The returned hull
//   triangulation is the boundary of the true Minkowski sum solid.
//
// WHAT THIS IS NOT (no overclaiming — 0 FAKES):
//   * NON-CONVEX inputs. For non-convex A and/or B the true Minkowski sum is
//     NOT the hull of pairwise sums (it can have concavities and even tunnels).
//     We DO still expose the hull-of-pairwise-sums for such input, but it is
//     reported HONESTLY as `convexHullOfSums` — an OUTER convex bound, not the
//     exact non-convex sum. The `exact` flag on the result is false in that case
//     (the caller passes whether the inputs are known-convex; we do not silently
//     pretend a non-convex sum was computed). No geometry is fabricated to pass.
//   * Quadratic blow-up beyond small/medium sets: we form all |A|*|B| sums, so
//     this is for the convex-vertex-set regime, not million-point clouds.
//
// ROBUSTNESS POSTURE: the hull's COMBINATORIAL decisions go through the adaptive-
// exact orient3d predicate (via convexHull3D). Coordinate placement of the summed
// points is plain double. This is the same robust-in-practice ceiling the rest of
// the native geom increment ships — NOT a rational/EPECK construction.

#ifndef FORGE_NATIVE_GEOM_MINKOWSKISUM3D_HPP
#define FORGE_NATIVE_GEOM_MINKOWSKISUM3D_HPP

#include <vector>
#include <array>
#include <cstddef>

#include "forge/native/geom/Geom.hpp"  // Point3, convexHull3D, Hull3D

namespace forge {
namespace native {
namespace geom {

// ---------------------------------------------------------------------------
// Result of a 3D Minkowski sum.
//
//   ok        : true if a non-degenerate hull was produced. false (with a
//               diagnostic `reason`) when the summed point set is degenerate
//               for a 3D hull (< 4 sums, all coplanar, all collinear, all
//               coincident) or when an input was empty.
//   exact     : true ONLY when BOTH inputs were declared convex (so the
//               hull-of-pairwise-sums IS the true Minkowski sum). false means
//               the result is the convex OUTER bound (hull of sums) of a
//               possibly non-convex true sum — honest, not a silent fake.
//   points    : the summed point cloud { a_i + b_j } (all pairwise sums).
//   faces     : CCW-outward triangle index triples INTO `points` (the hull
//               boundary). Same convention as geom::convexHull3D.
//   reason    : populated when ok==false, for diagnostics.
// ---------------------------------------------------------------------------
struct MinkowskiResult {
    bool ok{false};
    bool exact{false};
    std::vector<Point3>            points;  // all pairwise sums a_i + b_j
    std::vector<std::array<int,3>> faces;   // CCW-outward hull triangles
    const char* reason{""};
};

// ---------------------------------------------------------------------------
// Minkowski sum of two point sets A, B.
//
//   A, B          : vertex sets. For an EXACT result both must be the vertex
//                   sets of CONVEX bodies (interior/redundant points are
//                   harmless — convexHull3D drops them — but concavities are
//                   NOT represented by the hull).
//   aConvex,bConvex : caller's honest assertion that each input is convex.
//                   Both true  -> result.exact = true (true Minkowski sum).
//                   Either false -> result.exact = false (hull-of-sums OUTER
//                   bound, documented, never claimed as the exact sum).
//
// On empty A or B the result is ok=false (the Minkowski sum with the empty set
// is empty — we report it rather than fabricate points).
// ---------------------------------------------------------------------------
MinkowskiResult minkowskiSum3D(const std::vector<Point3>& A,
                               const std::vector<Point3>& B,
                               bool aConvex = true,
                               bool bConvex = true);

// ---------------------------------------------------------------------------
// Volume enclosed by a closed, CCW-outward triangulated hull (divergence
// theorem: sum over faces of the signed tetra (origin, v0, v1, v2) / 6).
// Positive for an outward-wound closed surface. Returns 0 for an empty face
// set. This is exposed so callers (and the validation gate) can measure the
// Minkowski-sum volume directly from the result without re-deriving it.
// ---------------------------------------------------------------------------
double hullVolume(const std::vector<Point3>& points,
                  const std::vector<std::array<int,3>>& faces);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_MINKOWSKISUM3D_HPP
