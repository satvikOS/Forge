// forge/native/geom/PrimitiveFit.hpp
//
// In-house least-squares fitting of geometric PRIMITIVES to a 3D point set —
// forge::native::geom::PrimitiveFit. Pure C++20, standard library only. NO
// external dependencies, no OCCT, no WASM, no third-party libs.
//
// PURPOSE (reverse-engineering / CAD): given a cloud of measured 3D points that
// were sampled from a known geometric primitive (a machined plane, a turned
// cylinder, a ball, a straight edge), RECOVER the primitive's parameters in the
// least-squares sense, together with an honest RMS residual so the caller can
// judge the quality of the fit.
//
// WHAT SHIPS HERE (REAL and VALIDATED against the standalone gate in
// test/native/geom/primitivefit_test.cpp):
//
//   fitPlane(points)    -> PlaneFit
//     Total-least-squares plane through the centroid via the eigen-decomposition
//     of the 3x3 point covariance matrix (principal component analysis). The
//     normal is the eigenvector of the SMALLEST eigenvalue; the orthogonal
//     (perpendicular) distance of every point to that plane is minimized — this
//     is the correct TLS plane, NOT an ordinary "z = a x + b y" regression which
//     would be biased by the choice of dependent axis. Degenerate when the points
//     are collinear (two covariance eigenvalues coincide near zero -> the normal
//     direction is not unique) or there are fewer than 3 distinct points.
//
//   fitLine(points)     -> LineFit
//     Total-least-squares line through the centroid: the direction is the
//     eigenvector of the LARGEST covariance eigenvalue (the principal axis).
//     Minimizes the sum of squared perpendicular distances to the line.
//     Degenerate when the points are non-collinear with no dominant axis (all
//     three eigenvalues comparable, i.e. an isotropic blob) or fewer than 2
//     distinct points.
//
//   fitSphere(points)   -> SphereFit
//     Algebraic seed (the linear "Pratt-style" system that minimizes the
//     algebraic distance |p - c|^2 - r^2 in closed form) followed by a small
//     Gauss-Newton refinement that minimizes the GEOMETRIC residual
//     (|p - c| - r). Recovers center + radius; at 1% noise the center and radius
//     are recovered within 1%. Degenerate when the points are coplanar (no finite
//     sphere — the normal equations are singular) or fewer than 4 distinct points.
//
//   fitCylinder(points) -> CylinderFit
//     Axis direction estimated from the point-NORMAL distribution: for points on
//     a cylinder, every surface normal is perpendicular to the axis, so the axis
//     is the eigenvector of the SMALLEST eigenvalue of the normal covariance
//     (equivalently the direction d minimizing sum (n . d)^2). Surface normals
//     are estimated locally; the axis point and radius then follow from a 2D
//     circle fit in the plane perpendicular to the axis, and the whole estimate
//     is polished by Gauss-Newton on the geometric residual
//     (dist_to_axis - radius). Degenerate when fewer than 6 distinct points or the
//     normal distribution has no clear perpendicular direction (e.g. a flat patch).
//
// ROBUSTNESS POSTURE (honest, per KERNEL_INHOUSE_ROADMAP.md §0 / Bible §0):
//   These are FLOATING-POINT least-squares estimators, not exact-predicate
//   combinatorial constructions. The eigen-solves use a self-contained symmetric
//   3x3 Jacobi rotation (converges to machine accuracy on a 3x3). The reported
//   parameters minimize the stated geometric residual to the precision of double
//   arithmetic and the conditioning of the input. We do NOT claim bit-exactness.
//   What IS guaranteed and validated: on points sampled from a known primitive
//   with small Gaussian noise of magnitude sigma, the recovered parameters match
//   the ground truth within a noise-scaled tolerance and the RMS residual tracks
//   sigma; a sphere is recovered to within 1% of center+radius at 1% noise.
//
//   Degenerate / unsupported input is reported HONESTLY via `ok=false` (never
//   fabricated): too few points, non-finite coordinates, and the rank-deficient
//   configurations noted per-primitive above. NOTHING is invented on failure.
//
// This file deliberately does NOT re-implement the point type; it reuses
// forge::native::geom::Point3 from Geom.hpp by #include.

#ifndef FORGE_NATIVE_GEOM_PRIMITIVEFIT_HPP
#define FORGE_NATIVE_GEOM_PRIMITIVEFIT_HPP

#include <array>
#include <vector>

#include "forge/native/geom/Geom.hpp"   // Point3 (reused, not redefined)

namespace forge {
namespace native {
namespace geom {

// ---------------------------------------------------------------------------
// Plane fit (TLS / PCA). On success the plane is { x : normal . (x - point) = 0 }.
//   * `normal` is a UNIT vector (the smallest-eigenvalue eigenvector),
//   * `point`  is the centroid of the input (a point guaranteed ON the plane),
//   * `rms`    is sqrt(mean of squared perpendicular distances).
// On failure every field is zero / the reason is set.
// ---------------------------------------------------------------------------
struct PlaneFit {
    bool                  ok{false};
    const char*           reason{""};
    std::array<double, 3> normal{{0.0, 0.0, 0.0}};
    std::array<double, 3> point{{0.0, 0.0, 0.0}};   // centroid (on the plane)
    double                rms{0.0};
};

// ---------------------------------------------------------------------------
// Line fit (TLS / PCA). On success the line is { point + t * direction }.
//   * `direction` is a UNIT vector (the largest-eigenvalue eigenvector),
//   * `point`     is the centroid (on the line),
//   * `rms`       is sqrt(mean of squared perpendicular distances to the line).
// ---------------------------------------------------------------------------
struct LineFit {
    bool                  ok{false};
    const char*           reason{""};
    std::array<double, 3> direction{{0.0, 0.0, 0.0}};
    std::array<double, 3> point{{0.0, 0.0, 0.0}};   // centroid (on the line)
    double                rms{0.0};
};

// ---------------------------------------------------------------------------
// Sphere fit (algebraic seed + geometric Gauss-Newton refine).
//   * `center` is the sphere center,
//   * `radius` is the sphere radius (>= 0),
//   * `rms`    is sqrt(mean of squared geometric residuals (|p - c| - r)).
// ---------------------------------------------------------------------------
struct SphereFit {
    bool                  ok{false};
    const char*           reason{""};
    std::array<double, 3> center{{0.0, 0.0, 0.0}};
    double                radius{0.0};
    double                rms{0.0};
};

// ---------------------------------------------------------------------------
// Cylinder fit (normal-covariance axis + circle fit + geometric Gauss-Newton).
//   * `axisPoint` is a point ON the axis (the closest axis point to the centroid),
//   * `axisDir`   is a UNIT vector along the axis,
//   * `radius`    is the cylinder radius (>= 0),
//   * `rms`       is sqrt(mean of squared residuals (dist_to_axis - radius)).
// ---------------------------------------------------------------------------
struct CylinderFit {
    bool                  ok{false};
    const char*           reason{""};
    std::array<double, 3> axisPoint{{0.0, 0.0, 0.0}};
    std::array<double, 3> axisDir{{0.0, 0.0, 0.0}};
    double                radius{0.0};
    double                rms{0.0};
};

// ---------------------------------------------------------------------------
// The four fitters. Each reports ok=false honestly on degenerate / unsupported
// input (too few points, non-finite coordinates, rank-deficient configuration).
// ---------------------------------------------------------------------------
PlaneFit    fitPlane(const std::vector<Point3>& pts);
LineFit     fitLine(const std::vector<Point3>& pts);
SphereFit   fitSphere(const std::vector<Point3>& pts);
CylinderFit fitCylinder(const std::vector<Point3>& pts);

// ---------------------------------------------------------------------------
// Exposed building block (used by the fitters and validated directly by the
// gate): symmetric 3x3 eigen-decomposition via cyclic Jacobi rotation. On
// success returns true; `eval` holds the eigenvalues in ASCENDING order and the
// columns of `evec` are the corresponding UNIT eigenvectors (evec[i][j] is the
// j-th component of the i-th eigenvector). `m` is the symmetric input given by
// its 6 distinct entries [m00,m11,m22,m01,m02,m12].
// ---------------------------------------------------------------------------
bool symmetricEigen3(const std::array<double, 6>& m,
                     std::array<double, 3>& eval,
                     std::array<std::array<double, 3>, 3>& evec);

} // namespace geom
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_GEOM_PRIMITIVEFIT_HPP
