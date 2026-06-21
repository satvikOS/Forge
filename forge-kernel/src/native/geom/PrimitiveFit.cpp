// forge/native/geom/PrimitiveFit.cpp
//
// Implementation of forge::native::geom::PrimitiveFit — see PrimitiveFit.hpp for
// the scope/honesty statement. Pure C++20, standard library only. NO external
// dependencies, no OCCT, no WASM.
//
// All four fitters share three self-contained numerical primitives implemented
// below: a symmetric 3x3 Jacobi eigensolver (for the PCA / normal-covariance
// directions), a small symmetric linear solver (Gaussian elimination with
// partial pivoting, used for the algebraic sphere seed and the Gauss-Newton
// normal equations), and local-normal estimation for the cylinder axis.

#include "forge/native/geom/PrimitiveFit.hpp"

// CI portability: explicitly include EVERY standard header used. A missing one
// can compile on Mac libc++ via transitive includes yet FAIL on CI's libstdc++.
#include <algorithm>   // std::min, std::max, std::clamp, std::sort, std::nth_element
#include <array>       // std::array
#include <cmath>       // std::fabs, std::sqrt, std::sin, std::cos, std::atan2, std::isfinite
#include <cstddef>     // std::size_t
#include <cstdint>     // std::uint32_t
#include <limits>      // std::numeric_limits
#include <numeric>     // std::accumulate, std::iota
#include <vector>      // std::vector

namespace forge {
namespace native {
namespace geom {

// ===========================================================================
// Small fixed-size vector helpers (Vec3 over double).
// ===========================================================================
namespace {

using V3 = std::array<double, 3>;

inline V3   v3(double x, double y, double z) { return V3{{x, y, z}}; }
inline V3   sub(const V3& a, const V3& b)    { return v3(a[0]-b[0], a[1]-b[1], a[2]-b[2]); }
inline V3   add(const V3& a, const V3& b)    { return v3(a[0]+b[0], a[1]+b[1], a[2]+b[2]); }
inline V3   scale(const V3& a, double s)     { return v3(a[0]*s, a[1]*s, a[2]*s); }
inline double dot(const V3& a, const V3& b)  { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
inline V3   cross(const V3& a, const V3& b) {
    return v3(a[1]*b[2] - a[2]*b[1],
              a[2]*b[0] - a[0]*b[2],
              a[0]*b[1] - a[1]*b[0]);
}
inline double norm(const V3& a)  { return std::sqrt(dot(a, a)); }

// Normalize; returns false (and leaves out untouched) if the vector is ~zero.
inline bool normalize(const V3& a, V3& out) {
    const double n = norm(a);
    if (!(n > 0.0) || !std::isfinite(n)) return false;
    out = scale(a, 1.0 / n);
    return true;
}

inline bool finitePoint(const Point3& p) {
    return std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z);
}

// Build any unit vector perpendicular to a unit `axis` (numerically safe choice).
inline V3 anyPerp(const V3& axis) {
    const V3 ref = (std::fabs(axis[0]) < 0.9) ? v3(1, 0, 0) : v3(0, 1, 0);
    V3 p = cross(axis, ref);
    V3 u;
    if (!normalize(p, u)) {
        // axis was (near) parallel to ref — try the other basis vector.
        p = cross(axis, v3(0, 0, 1));
        normalize(p, u);
    }
    return u;
}

} // namespace

// ===========================================================================
// Symmetric 3x3 eigen-decomposition — cyclic Jacobi rotations.
//
// Input `m` packs the symmetric matrix as [m00, m11, m22, m01, m02, m12].
// Output: eigenvalues in ASCENDING order, eigenvectors as the ROWS of `evec`
// (evec[i] is the unit eigenvector for eval[i]). Jacobi converges quadratically
// and to machine accuracy on a 3x3 symmetric matrix.
// ===========================================================================
bool symmetricEigen3(const std::array<double, 6>& m,
                     std::array<double, 3>& eval,
                     std::array<std::array<double, 3>, 3>& evec) {
    for (double v : m)
        if (!std::isfinite(v)) return false;

    // Working symmetric matrix A (full 3x3) and accumulated rotation V.
    double A[3][3] = {
        { m[0], m[3], m[4] },
        { m[3], m[1], m[5] },
        { m[4], m[5], m[2] },
    };
    double V[3][3] = { {1,0,0}, {0,1,0}, {0,0,1} };

    for (int sweep = 0; sweep < 100; ++sweep) {
        // Sum of off-diagonal magnitudes; stop when negligible.
        const double off = std::fabs(A[0][1]) + std::fabs(A[0][2]) + std::fabs(A[1][2]);
        if (off < 1e-300) break;

        for (int p = 0; p < 2; ++p) {
            for (int q = p + 1; q < 3; ++q) {
                if (std::fabs(A[p][q]) <= 0.0) continue;
                const double app = A[p][p], aqq = A[q][q], apq = A[p][q];
                // Jacobi rotation angle (Golub & Van Loan symmetric Schur).
                const double tau = (aqq - app) / (2.0 * apq);
                double t;
                if (tau >= 0.0) t =  1.0 / (tau + std::sqrt(1.0 + tau * tau));
                else            t = -1.0 / (-tau + std::sqrt(1.0 + tau * tau));
                const double c = 1.0 / std::sqrt(1.0 + t * t);
                const double s = t * c;

                // Apply rotation to A: A' = J^T A J.
                A[p][p] = app - t * apq;
                A[q][q] = aqq + t * apq;
                A[p][q] = A[q][p] = 0.0;
                for (int i = 0; i < 3; ++i) {
                    if (i != p && i != q) {
                        const double aip = A[i][p], aiq = A[i][q];
                        A[i][p] = A[p][i] = c * aip - s * aiq;
                        A[i][q] = A[q][i] = s * aip + c * aiq;
                    }
                }
                // Accumulate eigenvectors: V' = V J.
                for (int i = 0; i < 3; ++i) {
                    const double vip = V[i][p], viq = V[i][q];
                    V[i][p] = c * vip - s * viq;
                    V[i][q] = s * vip + c * viq;
                }
            }
        }
    }

    // Eigenvalues are the diagonal; eigenvectors are the columns of V.
    std::array<int, 3> idx{{0, 1, 2}};
    const double d[3] = { A[0][0], A[1][1], A[2][2] };
    std::sort(idx.begin(), idx.end(), [&](int a, int b) { return d[a] < d[b]; });

    for (int k = 0; k < 3; ++k) {
        const int j = idx[k];
        eval[k] = d[j];
        // Column j of V is the eigenvector; store as a unit row of evec.
        V3 col = v3(V[0][j], V[1][j], V[2][j]);
        V3 u;
        if (!normalize(col, u)) u = v3(0, 0, 0);
        evec[k] = u;
    }
    return true;
}

namespace {

// Solve a small dense linear system A x = b (n<=4) by Gaussian elimination with
// partial pivoting. Returns false if (near-)singular.
bool solveLinear(std::vector<std::vector<double>> A, std::vector<double> b,
                 std::vector<double>& x) {
    const std::size_t n = b.size();
    x.assign(n, 0.0);
    for (std::size_t col = 0; col < n; ++col) {
        // Partial pivot.
        std::size_t piv = col;
        double best = std::fabs(A[col][col]);
        for (std::size_t r = col + 1; r < n; ++r) {
            const double v = std::fabs(A[r][col]);
            if (v > best) { best = v; piv = r; }
        }
        if (best < 1e-300) return false;
        if (piv != col) { std::swap(A[piv], A[col]); std::swap(b[piv], b[col]); }
        // Eliminate.
        const double diag = A[col][col];
        for (std::size_t r = col + 1; r < n; ++r) {
            const double f = A[r][col] / diag;
            if (f == 0.0) continue;
            for (std::size_t c = col; c < n; ++c) A[r][c] -= f * A[col][c];
            b[r] -= f * b[col];
        }
    }
    // Back-substitution.
    for (std::size_t ii = n; ii-- > 0;) {
        double s = b[ii];
        for (std::size_t c = ii + 1; c < n; ++c) s -= A[ii][c] * x[c];
        if (std::fabs(A[ii][ii]) < 1e-300) return false;
        x[ii] = s / A[ii][ii];
    }
    for (double v : x)
        if (!std::isfinite(v)) return false;
    return true;
}

// Centroid + 3x3 covariance (packed [c00,c11,c22,c01,c02,c12]) of a point set.
// Returns the number of finite points consumed; non-finite points abort (n=0).
std::size_t covariance(const std::vector<Point3>& pts, V3& centroid,
                       std::array<double, 6>& cov) {
    for (const Point3& p : pts)
        if (!finitePoint(p)) { return 0; }
    const std::size_t n = pts.size();
    if (n == 0) return 0;
    V3 c = v3(0, 0, 0);
    for (const Point3& p : pts) { c[0] += p.x; c[1] += p.y; c[2] += p.z; }
    c = scale(c, 1.0 / static_cast<double>(n));
    centroid = c;
    cov = {{0, 0, 0, 0, 0, 0}};
    for (const Point3& p : pts) {
        const double dx = p.x - c[0], dy = p.y - c[1], dz = p.z - c[2];
        cov[0] += dx * dx; cov[1] += dy * dy; cov[2] += dz * dz;
        cov[3] += dx * dy; cov[4] += dx * dz; cov[5] += dy * dz;
    }
    return n;
}

// Count distinct points (within an absolute tolerance scaled by the spread).
std::size_t countDistinct(const std::vector<Point3>& pts) {
    const std::size_t n = pts.size();
    if (n == 0) return 0;
    double spread = 0.0;
    for (std::size_t i = 1; i < n; ++i) {
        spread = std::max(spread, std::fabs(pts[i].x - pts[0].x));
        spread = std::max(spread, std::fabs(pts[i].y - pts[0].y));
        spread = std::max(spread, std::fabs(pts[i].z - pts[0].z));
    }
    const double tol = 1e-12 * (1.0 + spread);
    std::size_t distinct = 0;
    for (std::size_t i = 0; i < n; ++i) {
        bool dup = false;
        for (std::size_t j = 0; j < i; ++j) {
            if (std::fabs(pts[i].x - pts[j].x) <= tol &&
                std::fabs(pts[i].y - pts[j].y) <= tol &&
                std::fabs(pts[i].z - pts[j].z) <= tol) { dup = true; break; }
        }
        if (!dup) ++distinct;
    }
    return distinct;
}

} // namespace

// ===========================================================================
// fitPlane — total-least-squares plane via PCA (smallest-eigenvalue normal).
// ===========================================================================
PlaneFit fitPlane(const std::vector<Point3>& pts) {
    PlaneFit r;
    if (pts.size() < 3)             { r.reason = "need >= 3 points"; return r; }
    if (countDistinct(pts) < 3)     { r.reason = "fewer than 3 distinct points"; return r; }

    V3 centroid;
    std::array<double, 6> cov;
    if (covariance(pts, centroid, cov) == 0) { r.reason = "non-finite or empty"; return r; }

    std::array<double, 3> eval;
    std::array<std::array<double, 3>, 3> evec;
    if (!symmetricEigen3(cov, eval, evec)) { r.reason = "eigensolve failed"; return r; }

    // The plane normal is the smallest-eigenvalue direction. It is well-defined
    // only if that eigenvalue is clearly separated from the next: collinear data
    // has TWO near-zero eigenvalues (the normal is not unique).
    const double l0 = eval[0], l1 = eval[1], l2 = eval[2];
    if (!(l2 > 0.0))                { r.reason = "all points coincident"; return r; }
    // Degenerate (collinear) for a PLANE: middle and smallest eigenvalues are
    // both tiny relative to the largest -> the perpendicular plane is ambiguous.
    if (l1 <= 1e-9 * l2)            { r.reason = "collinear (plane normal ambiguous)"; return r; }

    r.normal = evec[0];
    r.point  = centroid;

    double ss = 0.0;
    for (const Point3& p : pts) {
        const double dd = dot(r.normal, sub(v3(p.x, p.y, p.z), centroid));
        ss += dd * dd;
    }
    r.rms = std::sqrt(ss / static_cast<double>(pts.size()));
    (void)l0;
    r.ok = true;
    return r;
}

// ===========================================================================
// fitLine — total-least-squares line via PCA (largest-eigenvalue direction).
// ===========================================================================
LineFit fitLine(const std::vector<Point3>& pts) {
    LineFit r;
    if (pts.size() < 2)             { r.reason = "need >= 2 points"; return r; }
    if (countDistinct(pts) < 2)     { r.reason = "fewer than 2 distinct points"; return r; }

    V3 centroid;
    std::array<double, 6> cov;
    if (covariance(pts, centroid, cov) == 0) { r.reason = "non-finite or empty"; return r; }

    std::array<double, 3> eval;
    std::array<std::array<double, 3>, 3> evec;
    if (!symmetricEigen3(cov, eval, evec)) { r.reason = "eigensolve failed"; return r; }

    const double l2 = eval[2], l1 = eval[1];
    if (!(l2 > 0.0))                { r.reason = "all points coincident"; return r; }
    // A genuine line needs a DOMINANT axis: the second eigenvalue must be small
    // relative to the largest, else the cloud is a planar/isotropic blob with no
    // unique direction.
    if (l1 > 1e-3 * l2 && l1 > 1e-12) {
        // Still allow it if l1 is tiny in absolute terms (perfect line); reject
        // only when the spread off-axis is a real fraction of the on-axis spread.
        if (l1 > 1e-6 * l2) { r.reason = "no dominant axis (not a line)"; return r; }
    }

    r.direction = evec[2];   // largest-eigenvalue eigenvector
    r.point     = centroid;

    // RMS of perpendicular distances to the line.
    double ss = 0.0;
    for (const Point3& p : pts) {
        const V3 d = sub(v3(p.x, p.y, p.z), centroid);
        const double along = dot(d, r.direction);
        const V3 perp = sub(d, scale(r.direction, along));
        ss += dot(perp, perp);
    }
    r.rms = std::sqrt(ss / static_cast<double>(pts.size()));
    r.ok = true;
    return r;
}

// ===========================================================================
// fitSphere — algebraic (Pratt-style) seed + geometric Gauss-Newton refine.
//
// Algebraic seed: minimize sum ( |p - c|^2 - r^2 )^2 over (c, r). Writing
//   |p|^2 = 2 c . p + (r^2 - |c|^2)
// gives a LINEAR system in (cx, cy, cz, gamma) with gamma = r^2 - |c|^2:
//   [2x 2y 2z 1] [cx cy cz gamma]^T = x^2+y^2+z^2.
// Solve the normal equations, then r = sqrt(gamma + |c|^2).
// ===========================================================================
SphereFit fitSphere(const std::vector<Point3>& pts) {
    SphereFit r;
    if (pts.size() < 4)             { r.reason = "need >= 4 points"; return r; }
    if (countDistinct(pts) < 4)     { r.reason = "fewer than 4 distinct points"; return r; }
    for (const Point3& p : pts)
        if (!finitePoint(p))        { r.reason = "non-finite coordinate"; return r; }

    const std::size_t n = pts.size();

    // Work in centroid-shifted coordinates for conditioning.
    V3 mean = v3(0, 0, 0);
    for (const Point3& p : pts) { mean[0] += p.x; mean[1] += p.y; mean[2] += p.z; }
    mean = scale(mean, 1.0 / static_cast<double>(n));

    // Build 4x4 normal equations A^T A x = A^T b with row [2x 2y 2z 1].
    std::vector<std::vector<double>> AtA(4, std::vector<double>(4, 0.0));
    std::vector<double> Atb(4, 0.0);
    for (const Point3& p : pts) {
        const double x = p.x - mean[0], y = p.y - mean[1], z = p.z - mean[2];
        const double row[4] = { 2.0 * x, 2.0 * y, 2.0 * z, 1.0 };
        const double rhs = x * x + y * y + z * z;
        for (int i = 0; i < 4; ++i) {
            for (int j = 0; j < 4; ++j) AtA[i][j] += row[i] * row[j];
            Atb[i] += row[i] * rhs;
        }
    }
    std::vector<double> sol;
    if (!solveLinear(AtA, Atb, sol)) { r.reason = "coplanar (sphere system singular)"; return r; }

    V3 c = v3(sol[0], sol[1], sol[2]);   // center in shifted frame
    const double r2 = sol[3] + dot(c, c);
    if (!(r2 > 0.0) || !std::isfinite(r2)) { r.reason = "no real sphere (degenerate)"; return r; }
    double rad = std::sqrt(r2);

    // Gauss-Newton refinement on the GEOMETRIC residual f_i = |p_i - c| - r.
    // Parameters (cx, cy, cz, r). Jacobian row: d f / d c = -(p-c)/|p-c|,
    // d f / d r = -1. Solve (J^T J) dx = -J^T f each iteration.
    for (int iter = 0; iter < 50; ++iter) {
        std::vector<std::vector<double>> H(4, std::vector<double>(4, 0.0));
        std::vector<double> g(4, 0.0);
        double maxStepNeed = 0.0;
        for (const Point3& p : pts) {
            const V3 d = sub(v3(p.x - mean[0], p.y - mean[1], p.z - mean[2]), c);
            const double dist = norm(d);
            if (dist < 1e-300) continue;     // point at the center: skip (rare)
            const double f = dist - rad;
            const double J[4] = { -d[0] / dist, -d[1] / dist, -d[2] / dist, -1.0 };
            for (int i = 0; i < 4; ++i) {
                for (int j = 0; j < 4; ++j) H[i][j] += J[i] * J[j];
                g[i] += J[i] * f;
            }
            maxStepNeed = std::max(maxStepNeed, std::fabs(f));
        }
        std::vector<double> dx;
        // Solve H dx = -g.
        for (double& gv : g) gv = -gv;
        if (!solveLinear(H, g, dx)) break;   // keep the algebraic seed if singular
        c[0] += dx[0]; c[1] += dx[1]; c[2] += dx[2]; rad += dx[3];
        if (rad < 0.0) rad = std::fabs(rad);
        const double step = std::fabs(dx[0]) + std::fabs(dx[1]) + std::fabs(dx[2]) + std::fabs(dx[3]);
        if (step < 1e-14 * (1.0 + rad)) break;
        (void)maxStepNeed;
    }

    r.center = add(c, mean);   // back to world frame
    r.radius = rad;

    double ss = 0.0;
    for (const Point3& p : pts) {
        const double dd = norm(sub(v3(p.x, p.y, p.z), r.center)) - rad;
        ss += dd * dd;
    }
    r.rms = std::sqrt(ss / static_cast<double>(n));
    r.ok = true;
    return r;
}

namespace {

// Estimate a unit surface normal at each point from its k nearest neighbours
// (the smallest-eigenvalue direction of the local covariance). Returns false if
// the cloud is too small or degenerate. Normals are NOT consistently oriented —
// the cylinder axis estimate squares them so sign is irrelevant.
bool estimateNormals(const std::vector<Point3>& pts, std::vector<V3>& normals) {
    const std::size_t n = pts.size();
    if (n < 6) return false;
    const std::size_t k = std::min<std::size_t>(n - 1, std::max<std::size_t>(8, n / 10));
    normals.assign(n, v3(0, 0, 0));

    std::vector<double> d2(n);
    std::vector<std::size_t> order(n);
    for (std::size_t i = 0; i < n; ++i) {
        const Point3& pi = pts[i];
        for (std::size_t j = 0; j < n; ++j) {
            const double dx = pts[j].x - pi.x, dy = pts[j].y - pi.y, dz = pts[j].z - pi.z;
            d2[j] = dx * dx + dy * dy + dz * dz;
        }
        std::iota(order.begin(), order.end(), std::size_t{0});
        // Partial sort: the k+1 nearest (including self at distance 0).
        std::nth_element(order.begin(), order.begin() + static_cast<std::ptrdiff_t>(k), order.end(),
                         [&](std::size_t a, std::size_t b) { return d2[a] < d2[b]; });

        V3 c = v3(0, 0, 0);
        for (std::size_t t = 0; t <= k; ++t) {
            const Point3& q = pts[order[t]];
            c[0] += q.x; c[1] += q.y; c[2] += q.z;
        }
        c = scale(c, 1.0 / static_cast<double>(k + 1));
        std::array<double, 6> cov = {{0, 0, 0, 0, 0, 0}};
        for (std::size_t t = 0; t <= k; ++t) {
            const Point3& q = pts[order[t]];
            const double dx = q.x - c[0], dy = q.y - c[1], dz = q.z - c[2];
            cov[0] += dx * dx; cov[1] += dy * dy; cov[2] += dz * dz;
            cov[3] += dx * dy; cov[4] += dx * dz; cov[5] += dy * dz;
        }
        std::array<double, 3> ev;
        std::array<std::array<double, 3>, 3> evec;
        if (!symmetricEigen3(cov, ev, evec)) return false;
        normals[i] = evec[0];   // smallest-eigenvalue direction = surface normal
    }
    return true;
}

} // namespace

// ===========================================================================
// fitCylinder — axis from normal covariance, radius from circle fit, then
// geometric Gauss-Newton on (axisPoint-in-plane, direction angles, radius).
//
// Step 1: estimate per-point surface normals (local PCA). For points on a
//         cylinder every normal is perpendicular to the axis, so the axis is the
//         direction d minimizing sum (n_i . d)^2 — the SMALLEST eigenvector of
//         the normal covariance matrix N = sum n_i n_i^T.
// Step 2: project points into the plane perpendicular to that axis and fit a 2D
//         circle (same algebraic seed as the sphere, in 2D) -> axis point + radius.
// Step 3: Gauss-Newton refine on residual r_i = dist(p_i, axis) - radius over a
//         5-parameter model (axis direction via 2 tangent offsets + 2 in-plane
//         center offsets + radius), re-orthonormalizing the axis each step.
// ===========================================================================
CylinderFit fitCylinder(const std::vector<Point3>& pts) {
    CylinderFit r;
    if (pts.size() < 6)             { r.reason = "need >= 6 points"; return r; }
    if (countDistinct(pts) < 6)     { r.reason = "fewer than 6 distinct points"; return r; }
    for (const Point3& p : pts)
        if (!finitePoint(p))        { r.reason = "non-finite coordinate"; return r; }

    const std::size_t n = pts.size();

    // --- Step 1: axis direction from the normal distribution. ---
    std::vector<V3> normals;
    if (!estimateNormals(pts, normals)) { r.reason = "normal estimation failed"; return r; }
    std::array<double, 6> N = {{0, 0, 0, 0, 0, 0}};
    for (const V3& nrm : normals) {
        N[0] += nrm[0] * nrm[0]; N[1] += nrm[1] * nrm[1]; N[2] += nrm[2] * nrm[2];
        N[3] += nrm[0] * nrm[1]; N[4] += nrm[0] * nrm[2]; N[5] += nrm[1] * nrm[2];
    }
    std::array<double, 3> nev;
    std::array<std::array<double, 3>, 3> nevec;
    if (!symmetricEigen3(N, nev, nevec)) { r.reason = "axis eigensolve failed"; return r; }
    // The axis is the smallest-eigenvalue direction of the NORMAL covariance:
    // for a real cylinder the normals span a plane (the two large eigenvalues)
    // and vanish along the axis (the smallest). If the smallest is NOT clearly
    // separated, the normals don't lie in a plane -> not a cylinder.
    if (nev[1] <= 1e-9 * (nev[2] + 1e-300)) { r.reason = "no axis (normals not planar)"; return r; }
    V3 axis = nevec[0];
    if (!normalize(axis, axis))     { r.reason = "degenerate axis"; return r; }

    // --- Step 2: 2D circle fit in the plane perpendicular to the axis. ---
    V3 u = anyPerp(axis);
    V3 w = cross(axis, u);
    normalize(w, w);

    // Project, shift to projected centroid for conditioning.
    std::vector<std::array<double, 2>> uv(n);
    std::array<double, 2> uvMean{{0.0, 0.0}};
    for (std::size_t i = 0; i < n; ++i) {
        const V3 p = v3(pts[i].x, pts[i].y, pts[i].z);
        uv[i] = {{ dot(p, u), dot(p, w) }};
        uvMean[0] += uv[i][0]; uvMean[1] += uv[i][1];
    }
    uvMean[0] /= static_cast<double>(n); uvMean[1] /= static_cast<double>(n);

    std::vector<std::vector<double>> AtA(3, std::vector<double>(3, 0.0));
    std::vector<double> Atb(3, 0.0);
    for (std::size_t i = 0; i < n; ++i) {
        const double a = uv[i][0] - uvMean[0], b = uv[i][1] - uvMean[1];
        const double row[3] = { 2.0 * a, 2.0 * b, 1.0 };
        const double rhs = a * a + b * b;
        for (int ii = 0; ii < 3; ++ii) {
            for (int jj = 0; jj < 3; ++jj) AtA[ii][jj] += row[ii] * row[jj];
            Atb[ii] += row[ii] * rhs;
        }
    }
    std::vector<double> sol;
    if (!solveLinear(AtA, Atb, sol)) { r.reason = "circle fit singular"; return r; }
    const double cu = sol[0], cw = sol[1];
    const double rr2 = sol[2] + cu * cu + cw * cw;
    if (!(rr2 > 0.0) || !std::isfinite(rr2)) { r.reason = "no real radius (degenerate)"; return r; }
    double rad = std::sqrt(rr2);

    // Axis point in world: centroid-of-projection plane center mapped back.
    const double cuW = cu + uvMean[0], cwW = cw + uvMean[1];
    V3 axisPoint = add(scale(u, cuW), scale(w, cwW));

    // --- Step 3: Gauss-Newton on geometric residual dist_to_axis - radius. ---
    // Parameterize small updates: axis direction perturbed in the (u,w) tangent
    // plane by (a_u, a_w); center perturbed in (u,w) by (d_u, d_w); radius by dr.
    for (int iter = 0; iter < 60; ++iter) {
        // Re-derive an orthonormal tangent frame each iteration.
        u = anyPerp(axis);
        w = cross(axis, u); normalize(w, w);

        std::vector<std::vector<double>> H(5, std::vector<double>(5, 0.0));
        std::vector<double> g(5, 0.0);
        for (std::size_t i = 0; i < n; ++i) {
            const V3 p = v3(pts[i].x, pts[i].y, pts[i].z);
            const V3 dp = sub(p, axisPoint);
            const double along = dot(dp, axis);
            const V3 perp = sub(dp, scale(axis, along));   // component perp to axis
            const double dist = norm(perp);
            if (dist < 1e-300) continue;
            const V3 e = scale(perp, 1.0 / dist);          // unit radial direction
            const double f = dist - rad;

            // d(dist)/d(center along u) = -(e . u); along w = -(e . w).
            const double dC_u = -dot(e, u);
            const double dC_w = -dot(e, w);
            // Axis tilt by a_u rotates axis toward u: daxis = u * a_u (small).
            // d(perp)/d(a_u) = -( (dp.u) axis + along u ) ; project onto e.
            const double dpU = dot(dp, u), dpW = dot(dp, w);
            const double dA_u = -( e[0]*(dpU*axis[0] + along*u[0])
                                 + e[1]*(dpU*axis[1] + along*u[1])
                                 + e[2]*(dpU*axis[2] + along*u[2]) );
            const double dA_w = -( e[0]*(dpW*axis[0] + along*w[0])
                                 + e[1]*(dpW*axis[1] + along*w[1])
                                 + e[2]*(dpW*axis[2] + along*w[2]) );
            const double J[5] = { dC_u, dC_w, dA_u, dA_w, -1.0 };
            for (int a = 0; a < 5; ++a) {
                for (int b = 0; b < 5; ++b) H[a][b] += J[a] * J[b];
                g[a] += J[a] * f;
            }
        }
        // Tiny Levenberg damping for conditioning.
        for (int a = 0; a < 5; ++a) H[a][a] += 1e-12 * (H[a][a] + 1.0);
        std::vector<double> dx;
        for (double& gv : g) gv = -gv;
        if (!solveLinear(H, g, dx)) break;

        axisPoint = add(axisPoint, add(scale(u, dx[0]), scale(w, dx[1])));
        V3 newAxis = add(axis, add(scale(u, dx[2]), scale(w, dx[3])));
        if (!normalize(newAxis, newAxis)) break;
        axis = newAxis;
        rad += dx[4];
        if (rad < 0.0) rad = std::fabs(rad);

        const double step = std::fabs(dx[0]) + std::fabs(dx[1]) + std::fabs(dx[2])
                          + std::fabs(dx[3]) + std::fabs(dx[4]);
        if (step < 1e-14 * (1.0 + rad)) break;
    }

    // Project axisPoint to the closest point on the axis to the cloud centroid
    // (canonical, removes the free slide along the axis).
    V3 centroid = v3(0, 0, 0);
    for (const Point3& p : pts) { centroid[0] += p.x; centroid[1] += p.y; centroid[2] += p.z; }
    centroid = scale(centroid, 1.0 / static_cast<double>(n));
    {
        const V3 dpC = sub(centroid, axisPoint);
        axisPoint = add(axisPoint, scale(axis, dot(dpC, axis)));
    }

    r.axisPoint = axisPoint;
    r.axisDir   = axis;
    r.radius    = rad;

    double ss = 0.0;
    for (const Point3& p : pts) {
        const V3 dp = sub(v3(p.x, p.y, p.z), axisPoint);
        const double along = dot(dp, axis);
        const V3 perp = sub(dp, scale(axis, along));
        const double dd = norm(perp) - rad;
        ss += dd * dd;
    }
    r.rms = std::sqrt(ss / static_cast<double>(n));
    r.ok = true;
    return r;
}

} // namespace geom
} // namespace native
} // namespace forge
