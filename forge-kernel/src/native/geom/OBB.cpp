// forge/native/geom/OBB.cpp
//
// Implementation of forge::native::geom::computeOBB — the PCA oriented bounding
// box. Pure C++20, standard library only. See OBB.hpp for the contract and the
// honest robustness posture (PCA box, NOT the optimal minimum-volume OBB).

#include "forge/native/geom/OBB.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace forge {
namespace native {
namespace geom {

namespace {

// --- tiny local 3-vector helpers (independent of the kernel's mesh Vec3) -----
using V3 = std::array<double, 3>;

inline double dot(const V3& a, const V3& b) {
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
}
inline V3 cross(const V3& a, const V3& b) {
    return { a[1]*b[2] - a[2]*b[1],
             a[2]*b[0] - a[0]*b[2],
             a[0]*b[1] - a[1]*b[0] };
}
inline double norm(const V3& a) { return std::sqrt(dot(a, a)); }

inline bool finite3(const Point3& p) {
    return std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z);
}

// Cyclic Jacobi eigenvalue decomposition of a real SYMMETRIC 3x3 matrix.
//
// On return `eval[i]` are the eigenvalues and the COLUMNS of `evec` are the
// corresponding orthonormal eigenvectors: A * evec[:,i] = eval[i] * evec[:,i].
// This is the textbook cyclic-Jacobi method; for symmetric matrices it
// converges to machine precision (we cap iterations generously and exit early
// once the off-diagonal mass is negligible).
//
// `a` is passed by value (we destroy it during the sweep). It must be
// symmetric on input.
void jacobiEigen3(double a[3][3], double eval[3], double evec[3][3]) {
    // V starts as identity (accumulates the rotations).
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j)
            evec[i][j] = (i == j) ? 1.0 : 0.0;

    for (int sweep = 0; sweep < 100; ++sweep) {
        // Sum of squared off-diagonal entries (upper triangle).
        double off = a[0][1]*a[0][1] + a[0][2]*a[0][2] + a[1][2]*a[1][2];
        if (off <= 1e-300) break;   // already (effectively) diagonal

        // Iterate the three upper-triangular off-diagonal pairs.
        for (int p = 0; p < 3; ++p) {
            for (int q = p + 1; q < 3; ++q) {
                const double apq = a[p][q];
                if (std::fabs(apq) <= 0.0) continue;

                // Jacobi rotation angle that zeroes a[p][q].
                const double app = a[p][p];
                const double aqq = a[q][q];
                const double phi = (aqq - app) / (2.0 * apq);
                double t;  // tan(theta)
                const double denom = std::fabs(phi) + std::sqrt(phi*phi + 1.0);
                t = (phi >= 0.0 ? 1.0 : -1.0) / denom;
                const double c = 1.0 / std::sqrt(t*t + 1.0);  // cos
                const double s = t * c;                       // sin

                // Apply the rotation J^T A J to the affected entries.
                // Diagonal:
                a[p][p] = app - t * apq;
                a[q][q] = aqq + t * apq;
                a[p][q] = 0.0;
                a[q][p] = 0.0;

                // Off-diagonal rows/cols (the third index r != p,q).
                const int r = 3 - p - q;
                const double arp = a[r][p];
                const double arq = a[r][q];
                a[r][p] = c * arp - s * arq;
                a[p][r] = a[r][p];
                a[r][q] = s * arp + c * arq;
                a[q][r] = a[r][q];

                // Accumulate the eigenvector rotation.
                for (int k = 0; k < 3; ++k) {
                    const double vkp = evec[k][p];
                    const double vkq = evec[k][q];
                    evec[k][p] = c * vkp - s * vkq;
                    evec[k][q] = s * vkp + c * vkq;
                }
            }
        }
    }

    eval[0] = a[0][0];
    eval[1] = a[1][1];
    eval[2] = a[2][2];
}

} // namespace

Obb computeOBB(const std::vector<Point3>& pts) {
    Obb out;

    if (pts.empty()) {
        out.reason = "empty point set";
        return out;
    }
    for (const Point3& p : pts) {
        if (!finite3(p)) { out.reason = "non-finite coordinate"; return out; }
    }

    const double n = static_cast<double>(pts.size());

    // (1) centroid / mean.
    V3 mean{0.0, 0.0, 0.0};
    for (const Point3& p : pts) {
        mean[0] += p.x; mean[1] += p.y; mean[2] += p.z;
    }
    mean[0] /= n; mean[1] /= n; mean[2] /= n;

    // (2) covariance matrix (symmetric 3x3) of the de-meaned coordinates.
    double cov[3][3] = {{0,0,0},{0,0,0},{0,0,0}};
    for (const Point3& p : pts) {
        const double dx = p.x - mean[0];
        const double dy = p.y - mean[1];
        const double dz = p.z - mean[2];
        cov[0][0] += dx*dx; cov[0][1] += dx*dy; cov[0][2] += dx*dz;
        cov[1][1] += dy*dy; cov[1][2] += dy*dz;
        cov[2][2] += dz*dz;
    }
    cov[0][0] /= n; cov[0][1] /= n; cov[0][2] /= n;
    cov[1][1] /= n; cov[1][2] /= n; cov[2][2] /= n;
    cov[1][0] = cov[0][1];
    cov[2][0] = cov[0][2];
    cov[2][1] = cov[1][2];

    // Reject a rank-deficient (collinear / coincident) cloud honestly: if the
    // total variance is ~0 the points are coincident; if the covariance is
    // (near) rank-deficient there is no well-defined 3D box.
    const double trace = cov[0][0] + cov[1][1] + cov[2][2];
    if (trace <= 0.0 || !std::isfinite(trace)) {
        out.reason = "degenerate (coincident points / zero variance)";
        return out;
    }

    // (3) eigen-decomposition -> box axes.
    double eval[3];
    double evec[3][3];
    jacobiEigen3(cov, eval, evec);

    // Order axes by DESCENDING eigenvalue.
    int ord[3] = {0, 1, 2};
    std::sort(ord, ord + 3, [&](int i, int j) { return eval[i] > eval[j]; });

    // Reject a RANK-DEFICIENT cloud honestly. A collinear cloud has variance in
    // only one eigen-direction (the other two eigenvalues are ~0); a coplanar
    // cloud has one ~0. In either case there is no well-defined 3D OBB and we
    // must NOT fabricate a thickness. We test the smallest eigenvalue against the
    // largest (a scale-free condition): if it is negligible the cloud is flat or
    // a line. (A coplanar set's 2D OBB is TARGETED, not in this increment — see
    // header; we report it rather than return a zero-thickness 3D box dishonestly
    // as if it were a genuine 3D solid.)
    const double eMax = eval[ord[0]];
    const double eMin = eval[ord[2]];
    if (eMax <= 0.0 || !std::isfinite(eMax) ||
        eMin < 0.0  ||  eMin <= eMax * 1e-12) {
        out.reason = "degenerate (rank-deficient: collinear / coplanar point set)";
        return out;
    }

    V3 ax[3];
    for (int i = 0; i < 3; ++i) {
        const int c = ord[i];
        ax[i] = { evec[0][c], evec[1][c], evec[2][c] };
        const double len = norm(ax[i]);
        if (len <= 0.0 || !std::isfinite(len)) {
            out.reason = "eigenvector degeneracy";
            return out;
        }
        ax[i][0] /= len; ax[i][1] /= len; ax[i][2] /= len;
    }

    // Make the frame strictly right-handed: rebuild axis[2] from a x b. (Jacobi
    // returns an orthonormal set but its handedness/sign is arbitrary.)
    ax[2] = cross(ax[0], ax[1]);
    {
        const double len = norm(ax[2]);
        if (len <= 1e-300 || !std::isfinite(len)) {
            // ax[0],ax[1] (near-)parallel -> covariance was rank-deficient.
            out.reason = "degenerate (collinear / rank-deficient point set)";
            return out;
        }
        ax[2][0] /= len; ax[2][1] /= len; ax[2][2] /= len;
    }

    // (4) project the points onto each axis -> [min,max] extents.
    double pmin[3] = { std::numeric_limits<double>::infinity(),
                       std::numeric_limits<double>::infinity(),
                       std::numeric_limits<double>::infinity() };
    double pmax[3] = { -std::numeric_limits<double>::infinity(),
                       -std::numeric_limits<double>::infinity(),
                       -std::numeric_limits<double>::infinity() };
    for (const Point3& p : pts) {
        const V3 v{ p.x - mean[0], p.y - mean[1], p.z - mean[2] };
        for (int i = 0; i < 3; ++i) {
            const double d = dot(v, ax[i]);
            pmin[i] = std::min(pmin[i], d);
            pmax[i] = std::max(pmax[i], d);
        }
    }

    // A degenerate axis with zero extent is fine for a flat/oblong cloud (a box
    // of zero thickness has zero volume) — but it is still a valid, honest box.
    // Build center, half-extents, corners, volume.
    out.center = mean;  // start at mean, then offset by the span midpoints
    for (int i = 0; i < 3; ++i) {
        const double mid = 0.5 * (pmin[i] + pmax[i]);
        out.center[0] += mid * ax[i][0];
        out.center[1] += mid * ax[i][1];
        out.center[2] += mid * ax[i][2];
        out.half[i] = 0.5 * (pmax[i] - pmin[i]);
        if (out.half[i] < 0.0) out.half[i] = 0.0;  // guard FP
        out.axis[i] = ax[i];
    }

    for (int k = 0; k < 8; ++k) {
        V3 c = out.center;
        for (int i = 0; i < 3; ++i) {
            const double s = (k >> i) & 1 ? +1.0 : -1.0;
            c[0] += s * out.half[i] * ax[i][0];
            c[1] += s * out.half[i] * ax[i][1];
            c[2] += s * out.half[i] * ax[i][2];
        }
        out.corner[k] = c;
    }

    out.volume = 8.0 * out.half[0] * out.half[1] * out.half[2];
    out.ok = true;
    out.reason = "";
    return out;
}

Obb computeOBB(const std::vector<double>& flatXYZ) {
    Obb out;
    if (flatXYZ.size() % 3 != 0) {
        out.reason = "ragged flat array (length not a multiple of 3)";
        return out;
    }
    std::vector<Point3> pts;
    pts.reserve(flatXYZ.size() / 3);
    for (std::size_t i = 0; i + 2 < flatXYZ.size(); i += 3) {
        pts.push_back(Point3{flatXYZ[i], flatXYZ[i + 1], flatXYZ[i + 2]});
    }
    return computeOBB(pts);
}

AabbVolume aabbVolume(const std::vector<Point3>& pts) {
    AabbVolume out;
    if (pts.empty()) { return out; }
    V3 lo{ std::numeric_limits<double>::infinity(),
           std::numeric_limits<double>::infinity(),
           std::numeric_limits<double>::infinity() };
    V3 hi{ -std::numeric_limits<double>::infinity(),
           -std::numeric_limits<double>::infinity(),
           -std::numeric_limits<double>::infinity() };
    for (const Point3& p : pts) {
        if (!finite3(p)) { return out; }  // ok stays false
        lo[0] = std::min(lo[0], p.x); hi[0] = std::max(hi[0], p.x);
        lo[1] = std::min(lo[1], p.y); hi[1] = std::max(hi[1], p.y);
        lo[2] = std::min(lo[2], p.z); hi[2] = std::max(hi[2], p.z);
    }
    out.min = lo;
    out.max = hi;
    out.volume = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
    out.ok = true;
    return out;
}

} // namespace geom
} // namespace native
} // namespace forge
