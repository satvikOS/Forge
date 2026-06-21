// forge/native/geom/PointCloudNormals.hpp
//
// In-house per-point surface-normal estimation for unstructured 3D point
// clouds — forge::native::geom. Pure C++20, standard library only. NO OCCT,
// NO WASM, NO third-party libs. Reuses forge::native::geom::KdTree3D and
// forge::native::geom::Point3 (Geom.hpp) by #include only — no re-implemented
// point type, no re-implemented kd-tree.
//
// WHAT THIS IS (honest — KERNEL_INHOUSE_ROADMAP.md §0 / Bible §0):
//   The textbook PCA / local-tangent-plane normal estimator, the same algorithm
//   PCL's NormalEstimation and CGAL's pca_estimate_normals ship:
//
//     For each input point p_i:
//       (1) Find its k nearest neighbours (INCLUDING p_i itself) with the
//           in-house KdTree3D (exact k-NN, branch-and-bound).
//       (2) Form the 3x3 covariance matrix C of those neighbours about their
//           own centroid:  C = (1/m) * sum_j (q_j - mu)(q_j - mu)^T .
//       (3) Symmetric-eigen-decompose C with a classical cyclic Jacobi rotation
//           sweep (3x3, converges in a handful of sweeps; we run to a strict
//           off-diagonal tolerance or a hard sweep cap, both honest).
//       (4) The eigenvector belonging to the SMALLEST eigenvalue is the surface
//           normal (the direction of least variance = perpendicular to the
//           best-fit tangent plane). It is returned UNIT length.
//
//   ORIENTATION (the sign of each normal) is resolved by ONE of two documented
//   strategies, selectable per call:
//
//     OrientMode::AwayFromCentroid (default) — flip each normal so it points
//       from the cloud's global centroid toward its point (n · (p_i - centroid)
//       >= 0). This is exact and O(n) and is CORRECT for a star-shaped / convex
//       sampling such as a sphere (the spec's primary validation): every point
//       is "outward" of the centre, so the outward radial normal is recovered.
//       It is NOT globally correct for a non-star-shaped surface (e.g. the
//       inside of a bowl) — we say so rather than pretend otherwise.
//
//     OrientMode::MstPropagation — build a Riemannian/neighbour graph (each
//       point linked to its k-NN), take a minimum spanning tree weighted by
//       (1 - |n_a · n_b|) so nearly-parallel normals are cheapest to connect,
//       seed the orientation at the point of largest +Z (forced n·+Z >= 0, the
//       Hoppe et al. 1992 convention) and flood-propagate the sign across the
//       MST, flipping n_b whenever n_a · n_b < 0. This yields a *consistent*
//       (all-same-side) field for a connected, well-sampled surface, including
//       planes and locally-developable patches, WITHOUT needing a centroid to
//       be "inside". On a single connected component it is consistent; across
//       disconnected components each component is independently seeded (and that
//       limitation is stated, not hidden).
//
//   For the plane validation in the test BOTH modes agree (all normals already
//   parallel); for the sphere validation AwayFromCentroid gives the textbook
//   outward field and MstPropagation gives a globally-consistent field whose
//   |dot| with the radial direction is still > 0.97 (sign may be globally
//   inward or outward — consistency, not outward-ness, is its contract).
//
// HONEST EDGE CASES (return ok=false rather than fabricate):
//   * empty cloud                       -> ok=false, no normals.
//   * any non-finite coordinate         -> ok=false (we do NOT sanitize).
//   * k < 2                             -> ok=false (a tangent plane needs >= 2
//                                          distinct neighbours; 1 point has no
//                                          definable normal).
//   * k > n                             -> CLAMPED to n (honest: you cannot have
//                                          more neighbours than points). Reported
//                                          via result.kEffective; not a failure.
//   * a point whose k-neighbourhood is  -> that point's normal is the LEAST-
//     rank-deficient (all coincident,      variance eigenvector still, but it is
//     or perfectly collinear) so the       FLAGGED degenerate (see `degenerate`
//     covariance has a (near-)zero          mask) AND counted in
//     second eigenvalue                     result.numDegenerate. We never claim
//                                           a confident normal where the local
//                                           geometry does not define one; the
//                                           returned vector is the honest least-
//                                           variance direction (unit, or {0,0,0}
//                                           if even that is undefined, e.g. all
//                                           neighbours coincident).
//
// The estimate is double-precision throughout. The covariance eigenproblem is
// solved exactly-symmetric (Jacobi preserves symmetry); this is a numerical
// estimator, NOT an exact-predicate construction — and it does not pretend to be.

#ifndef FORGE_NATIVE_GEOM_POINTCLOUDNORMALS_HPP
#define FORGE_NATIVE_GEOM_POINTCLOUDNORMALS_HPP

#include <vector>
#include <cstddef>

#include "forge/native/geom/Geom.hpp"      // forge::native::geom::Point3
#include "forge/native/geom/KdTree3D.hpp"  // forge::native::geom::KdTree3D

namespace forge {
namespace native {
namespace geom {

// A unit normal estimate (or {0,0,0} for a fully-undefined point — see header).
struct Normal3 {
    double x{0.0};
    double y{0.0};
    double z{0.0};
};

// How to resolve the global SIGN of the estimated normals. See header for the
// exact contract and limitations of each.
enum class OrientMode {
    AwayFromCentroid,  // outward of the global centroid (correct for sphere-like)
    MstPropagation     // MST flood sign-consistency (correct for connected surfaces)
};

// Result envelope. `ok` is false ONLY for a genuinely unanswerable request
// (empty / non-finite / k<2). A well-formed request always fills `normals` with
// one entry per input point, in input order.
struct NormalEstimation {
    bool                 ok{false};
    std::vector<Normal3> normals;        // one per input point, input order
    // Per-point flag: true where the local neighbourhood did not define a
    // confident tangent plane (rank-deficient covariance). The corresponding
    // normal is the honest least-variance direction (possibly {0,0,0}).
    std::vector<bool>    degenerate;
    std::size_t          numDegenerate{0};
    int                  kEffective{0};   // neighbours actually used (k clamped to n)
    const char*          reason{""};      // why ok==false, for diagnostics
};

// Estimate per-point normals over `points` using `k` nearest neighbours
// (k counts the point itself). See header for full semantics and edge cases.
NormalEstimation estimatePointCloudNormals(
    const std::vector<Point3>& points,
    int k,
    OrientMode mode = OrientMode::AwayFromCentroid);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_POINTCLOUDNORMALS_HPP
