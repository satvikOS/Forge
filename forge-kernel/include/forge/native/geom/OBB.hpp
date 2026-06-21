// forge/native/geom/OBB.hpp
//
// In-house oriented bounding box (OBB) — forge::native::geom. Pure C++20,
// standard library only. NO external dependencies, no OCCT, no WASM, no
// third-party libs.
//
// WHAT SHIPS HERE (REAL and VALIDATED against the standalone gate in
// test/native/geom/obb_test.cpp):
//
//   computeOBB(points) -> Obb
//     A CGAL-class PCA oriented bounding box of a 3D point set:
//       (1) the mean (centroid) of the points,
//       (2) the 3x3 covariance matrix of the de-meaned coordinates,
//       (3) its eigenvectors via the classical cyclic Jacobi eigenvalue
//           algorithm for a symmetric 3x3 matrix — these orthonormal
//           eigenvectors become the box axes,
//       (4) the box extents = the per-axis [min,max] of the points projected
//           onto each axis; the OBB center sits at the midpoint of those spans.
//     Returns center, three orthonormal axes (right-handed), three half-extents,
//     the eight corners, and the box volume.
//
// ROBUSTNESS POSTURE (honest, per KERNEL_INHOUSE_ROADMAP.md §0 / Bible §0):
//   This is the standard PCA / covariance OBB used by CGAL's
//   `oriented_bounding_box` in its default (fast, PCA) mode. It is NOT the
//   optimal minimum-volume OBB (that needs the rotating-calipers / O'Rourke
//   exact-minimal construction, which is TARGETED, not in this increment). The
//   PCA box is a tight, axis-aligned-in-eigenspace box; for an oblong cloud it
//   is provably <= the world AABB, but it is not guaranteed globally minimal.
//   The eigendecomposition is plain double (Jacobi converges to machine
//   precision for symmetric matrices); we do NOT claim bit-exactness.
//
//   Degenerate input is reported HONESTLY via `ok=false` (never fabricated):
//     * fewer than 1 point,
//     * any non-finite coordinate,
//     * a fully collinear or coincident cloud whose covariance is rank-deficient
//       (no well-defined 3D box) — reported, not papered over with a fake axis.
//
// This file deliberately does NOT re-implement the point types; it reuses
// forge::native::geom::Point3 from Geom.hpp by #include.

#ifndef FORGE_NATIVE_GEOM_OBB_HPP
#define FORGE_NATIVE_GEOM_OBB_HPP

#include <array>
#include <vector>

#include "forge/native/geom/Geom.hpp"   // Point3 (reused, not redefined)

namespace forge {
namespace native {
namespace geom {

// Result of computeOBB. On success (`ok==true`):
//   * `axis[0..2]` are orthonormal, right-handed (axis[0] x axis[1] == axis[2]),
//     each a 3-vector (x,y,z), ordered by DESCENDING eigenvalue (axis[0] is the
//     direction of greatest spread).
//   * `half[i]` is the half-extent of the box along `axis[i]` (>= 0).
//   * `center` is the geometric center of the box.
//   * `corner[0..7]` are the 8 box corners, ordered by the bit pattern of the
//     sign combination: corner k uses sign s_i = (k>>i & 1 ? +1 : -1) on axis i,
//     i.e. corner = center + sum_i s_i * half[i] * axis[i].
//   * `volume` = 8 * half[0]*half[1]*half[2] (the box volume).
// On failure `ok==false`, `reason` explains why and every numeric field is left
// zero — NOTHING is fabricated.
struct Obb {
    bool ok{false};
    const char* reason{""};

    std::array<double, 3>                center{{0.0, 0.0, 0.0}};
    std::array<std::array<double, 3>, 3> axis{{}};   // axis[i] = {x,y,z}
    std::array<double, 3>                half{{0.0, 0.0, 0.0}};
    std::array<std::array<double, 3>, 8> corner{{}}; // corner[k] = {x,y,z}
    double                               volume{0.0};
};

// Compute the PCA oriented bounding box of a 3D point set.
Obb computeOBB(const std::vector<Point3>& pts);

// Convenience overload: flat xyz triples (length must be a multiple of 3).
// A ragged array (length % 3 != 0) is reported as ok=false.
Obb computeOBB(const std::vector<double>& flatXYZ);

// The volume of the WORLD axis-aligned bounding box (AABB) of the same points,
// for the OBB <= AABB comparison the spec validates. Returns 0 for an empty or
// non-finite set (and sets ok=false). Provided so callers / tests need not
// re-derive the AABB by hand.
struct AabbVolume {
    bool   ok{false};
    double volume{0.0};
    std::array<double, 3> min{{0.0, 0.0, 0.0}};
    std::array<double, 3> max{{0.0, 0.0, 0.0}};
};
AabbVolume aabbVolume(const std::vector<Point3>& pts);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_OBB_HPP
