// forge/native/geom/MinEnclosingSphere.hpp
//
// In-house smallest enclosing sphere (minimum enclosing ball) of a 3D point set
// — forge::native::geom. Pure C++20, standard library only. NO external
// dependencies, no OCCT, no WASM, no third-party libs.
//
// WHAT SHIPS HERE (REAL and VALIDATED against the standalone gate in
// test/native/geom/minenclosingsphere_test.cpp):
//
//   minEnclosingSphere(points) -> MinSphere
//     The UNIQUE smallest sphere that contains every input point, computed by
//     Welzl's randomized incremental algorithm with the "move-to-front"
//     heuristic. This is exactly the construction behind CGAL's
//     `Min_sphere_of_points_d` / `Min_sphere_of_spheres_d` (the smallest
//     enclosing ball of a point set): expected LINEAR time in the number of
//     points (the move-to-front reordering keeps the recursion shallow and the
//     basis small — at most 4 support points in 3D).
//
//     The sphere is determined by its boundary support set of 1..4 points:
//       * 1 point  -> degenerate sphere of radius 0 at that point,
//       * 2 points -> the diametral sphere (center = midpoint),
//       * 3 points -> the circumsphere of the triangle, projected so the center
//                     lies in the triangle's plane (smallest sphere through 3),
//       * 4 points -> the circumsphere of the tetrahedron.
//     The exact base cases (the sphere through up to 4 points) are solved in
//     closed form and are exact up to floating-point round-off.
//
// ROBUSTNESS POSTURE (honest, per KERNEL_INHOUSE_ROADMAP.md §0 / Bible §0):
//   The combinatorial structure (which points end up on the boundary) is decided
//   by Welzl's exact "is p inside the current ball?" test. The construction
//   arithmetic (solving the 1..4-point base sphere) is ordinary double precision:
//   it converges to machine accuracy but we do NOT claim bit-exact (no rational /
//   EPECK kernel). To absorb the round-off of the membership test the algorithm
//   inflates the containment check by a tiny relative tolerance so a point that
//   defines the boundary is never spuriously re-expanded; the RETURNED radius is
//   the true (un-inflated) support radius. The result is validated to enclose
//   every input point (max distance to center <= radius + 1e-9).
//
//   Degenerate / unsupported input is reported HONESTLY via `ok=false` (never
//   fabricated):
//     * empty set (no sphere exists),
//     * any non-finite coordinate.
//   A single point is a VALID input: radius 0 at that point (ok=true).
//
// This file deliberately does NOT re-implement the point type; it reuses
// forge::native::geom::Point3 from Geom.hpp by #include.

#ifndef FORGE_NATIVE_GEOM_MINENCLOSINGSPHERE_HPP
#define FORGE_NATIVE_GEOM_MINENCLOSINGSPHERE_HPP

#include <array>
#include <vector>

#include "forge/native/geom/Geom.hpp"   // Point3 (reused, not redefined)

namespace forge {
namespace native {
namespace geom {

// Result of minEnclosingSphere. On success (`ok==true`):
//   * `center` is the sphere center (x,y,z),
//   * `radius` is the sphere radius (>= 0; exactly 0 for a single input point),
//   * `support` lists the 1..4 input points that lie on the boundary and
//     uniquely determine the sphere (the Welzl basis).
// On failure (`ok==false`) `reason` explains why and every numeric field is left
// zero / empty — NOTHING is fabricated.
struct MinSphere {
    bool        ok{false};
    const char* reason{""};

    std::array<double, 3>              center{{0.0, 0.0, 0.0}};
    double                             radius{0.0};
    std::vector<std::array<double, 3>> support;   // 1..4 boundary points
};

// Compute the smallest enclosing sphere of a 3D point set (Welzl, move-to-front).
MinSphere minEnclosingSphere(const std::vector<Point3>& pts);

// Convenience overload: flat xyz triples (length must be a multiple of 3).
// A ragged array (length % 3 != 0) is reported as ok=false.
MinSphere minEnclosingSphere(const std::vector<double>& flatXYZ);

// ---------------------------------------------------------------------------
// Exact base-case constructors (the sphere through up to 4 points), exposed so
// callers/tests can validate the closed-form sub-solvers directly. Each returns
// ok=false (no sphere) when the points are degenerate for that arity:
//   * sphere3: the 3 points are collinear (no finite circumcircle),
//   * sphere4: the 4 points are coplanar (no finite circumsphere).
// sphere1/sphere2 are always well-defined for finite input.
// ---------------------------------------------------------------------------
MinSphere sphere1(const Point3& a);
MinSphere sphere2(const Point3& a, const Point3& b);
MinSphere sphere3(const Point3& a, const Point3& b, const Point3& c);
MinSphere sphere4(const Point3& a, const Point3& b, const Point3& c, const Point3& d);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_MINENCLOSINGSPHERE_HPP
