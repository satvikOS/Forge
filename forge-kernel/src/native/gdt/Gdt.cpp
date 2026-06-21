// forge/native/gdt/Gdt.cpp
//
// Implementation of forge::native::gdt — the GEOMETRIC GD&T evaluator.
// See include/forge/native/gdt/Gdt.hpp for the honest scope statement.
//
// Pure C++20 + <cmath>. No external deps. All routines are closed-form or use
// a 3x3 symmetric Jacobi eigensolver (for the flatness best-fit plane), so the
// validation gate's RANDOM inputs always validate against the exact math.

#include "forge/native/gdt/Gdt.hpp"

#include <cmath>
#include <algorithm>
#include <limits>

namespace forge {
namespace native {
namespace gdt {

// ===========================================================================
// Vec3 algebra
// ===========================================================================
double dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
Vec3 cross(const Vec3& a, const Vec3& b) {
    return Vec3{a.y * b.z - a.z * b.y,
               a.z * b.x - a.x * b.z,
               a.x * b.y - a.y * b.x};
}
Vec3 sub(const Vec3& a, const Vec3& b) { return Vec3{a.x - b.x, a.y - b.y, a.z - b.z}; }
Vec3 add(const Vec3& a, const Vec3& b) { return Vec3{a.x + b.x, a.y + b.y, a.z + b.z}; }
Vec3 scale(const Vec3& a, double s)    { return Vec3{a.x * s, a.y * s, a.z * s}; }
double norm(const Vec3& a)             { return std::sqrt(dot(a, a)); }
Vec3 normalize(const Vec3& a) {
    double n = norm(a);
    if (n <= 0.0) return Vec3{0, 0, 0};
    return scale(a, 1.0 / n);
}

// ===========================================================================
// (1) DATUM REFERENCE FRAME
// ===========================================================================
//
// Origin: solve the 3x3 system of the three plane equations
//   nA . x = nA . pA,   nB . x = nB . pB,   nC . x = nC . pC
// via Cramer's rule. Basis: Gram-Schmidt to force B ⊥ A and a right-handed Y.

static double det3(double a, double b, double c,
                   double d, double e, double f,
                   double g, double h, double i) {
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

DatumReferenceFrame buildDrf(const Plane& A, const Plane& B, const Plane& C) {
    DatumReferenceFrame drf;

    Vec3 nA = normalize(A.normal);
    Vec3 nBraw = normalize(B.normal);
    Vec3 nCraw = normalize(C.normal);

    if (norm(nA) == 0.0 || norm(nBraw) == 0.0 || norm(nCraw) == 0.0) {
        drf.reason = "degenerate datum plane normal";
        return drf;
    }

    // axisZ = primary datum normal (sign preserved — A's outward direction).
    Vec3 axisZ = nA;

    // axisX = secondary normal with its axisZ-component removed (⊥ A).
    Vec3 bPerp = sub(nBraw, scale(axisZ, dot(nBraw, axisZ)));
    if (norm(bPerp) < 1e-12) {
        drf.reason = "secondary datum parallel to primary (no perpendicular component)";
        return drf;
    }
    Vec3 axisX = normalize(bPerp);

    // axisY completes a right-handed frame and is automatically ⊥ A and ⊥ X.
    Vec3 axisY = normalize(cross(axisZ, axisX));
    if (norm(axisY) < 1e-12) {
        drf.reason = "degenerate frame (axes collinear)";
        return drf;
    }

    // Origin = intersection of the three ORIGINAL planes (Cramer's rule).
    Vec3 nB = nBraw, nC = nCraw;
    double D = det3(nA.x, nA.y, nA.z,
                    nB.x, nB.y, nB.z,
                    nC.x, nC.y, nC.z);
    if (std::fabs(D) < 1e-12) {
        drf.reason = "three datum planes do not meet in a single point";
        return drf;
    }
    double dA = dot(nA, A.point);
    double dB = dot(nB, B.point);
    double dC = dot(nC, C.point);
    double Dx = det3(dA, nA.y, nA.z,
                     dB, nB.y, nB.z,
                     dC, nC.y, nC.z);
    double Dy = det3(nA.x, dA, nA.z,
                     nB.x, dB, nB.z,
                     nC.x, dC, nC.z);
    double Dz = det3(nA.x, nA.y, dA,
                     nB.x, nB.y, dB,
                     nC.x, nC.y, dC);

    drf.origin = Vec3{Dx / D, Dy / D, Dz / D};
    drf.axisX = axisX;
    drf.axisY = axisY;
    drf.axisZ = axisZ;
    drf.ok = true;
    drf.reason = "";
    return drf;
}

Vec3 transformToDrf(const DatumReferenceFrame& drf, const Vec3& worldPt) {
    Vec3 d = sub(worldPt, drf.origin);
    // R^T * d, where R's columns are the (orthonormal) basis vectors.
    return Vec3{dot(d, drf.axisX), dot(d, drf.axisY), dot(d, drf.axisZ)};
}

Vec3 transformToWorld(const DatumReferenceFrame& drf, const Vec3& p) {
    // origin + R * p
    Vec3 r = add(add(scale(drf.axisX, p.x), scale(drf.axisY, p.y)),
                 scale(drf.axisZ, p.z));
    return add(drf.origin, r);
}

// ===========================================================================
// (2) TRUE POSITION with MMC / LMC bonus
// ===========================================================================
//
// Diametral position deviation:  Δ = 2 * sqrt(dx^2 + dy^2).
//
// Bonus tolerance = how far the feature has DEPARTED from the stated material
// condition toward the opposite limit. Per Y14.5 §7.3.3:
//   HOLE @ MMC : MMC is the SMALLEST size; bonus = actualSize - MMC (>=0).
//   PIN  @ MMC : MMC is the LARGEST size;  bonus = MMC - actualSize (>=0).
//   HOLE @ LMC : LMC is the LARGEST size;  bonus = LMC - actualSize (>=0).
//   PIN  @ LMC : LMC is the SMALLEST size; bonus = actualSize - LMC (>=0).
//   RFS        : bonus = 0.
// The bonus is clamped at 0 (a feature outside its size limit is a SIZE reject;
// it cannot earn negative position tolerance).

TruePositionResult evaluateTruePosition(const Point2D& actual,
                                        const Point2D& trueLoc,
                                        double actualSize,
                                        double materialLimit,
                                        double positionTolDia,
                                        MaterialCondition mc,
                                        FeatureType ft) {
    TruePositionResult r;

    double dx = actual.x - trueLoc.x;
    double dy = actual.y - trueLoc.y;
    r.deviation = 2.0 * std::sqrt(dx * dx + dy * dy);

    double bonus = 0.0;
    if (mc == MaterialCondition::MMC) {
        // departure FROM MMC toward LMC
        bonus = (ft == FeatureType::HOLE) ? (actualSize - materialLimit)
                                          : (materialLimit - actualSize);
    } else if (mc == MaterialCondition::LMC) {
        // departure FROM LMC toward MMC
        bonus = (ft == FeatureType::HOLE) ? (materialLimit - actualSize)
                                          : (actualSize - materialLimit);
    }
    if (bonus < 0.0) bonus = 0.0;  // RFS or a size reject earns no bonus

    r.bonus = bonus;
    r.allowedZoneDia = positionTolDia + bonus;
    r.pass = (r.deviation <= r.allowedZoneDia);
    return r;
}

// ===========================================================================
// 3x3 symmetric eigensolver (cyclic Jacobi) — for the flatness fit plane.
// ===========================================================================
//
// A is symmetric; returns eigenvalues in `w[3]` and eigenvectors as the columns
// of `V[3][3]`. Standard textbook cyclic-Jacobi: always converges for symmetric
// input, so random covariance matrices always solve.

static void jacobiEigen(double A[3][3], double w[3], double V[3][3]) {
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) V[i][j] = (i == j) ? 1.0 : 0.0;

    double a[3][3];
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) a[i][j] = A[i][j];

    for (int sweep = 0; sweep < 100; ++sweep) {
        double off = std::fabs(a[0][1]) + std::fabs(a[0][2]) + std::fabs(a[1][2]);
        if (off < 1e-300) break;
        for (int p = 0; p < 2; ++p) {
            for (int q = p + 1; q < 3; ++q) {
                if (std::fabs(a[p][q]) < 1e-300) continue;
                double app = a[p][p], aqq = a[q][q], apq = a[p][q];
                double phi = 0.5 * std::atan2(2.0 * apq, aqq - app);
                double c = std::cos(phi), s = std::sin(phi);
                // Rotate a = J^T a J
                for (int k = 0; k < 3; ++k) {
                    double akp = a[k][p], akq = a[k][q];
                    a[k][p] = c * akp - s * akq;
                    a[k][q] = s * akp + c * akq;
                }
                for (int k = 0; k < 3; ++k) {
                    double apk = a[p][k], aqk = a[q][k];
                    a[p][k] = c * apk - s * aqk;
                    a[q][k] = s * apk + c * aqk;
                }
                // Accumulate eigenvectors V = V J
                for (int k = 0; k < 3; ++k) {
                    double vkp = V[k][p], vkq = V[k][q];
                    V[k][p] = c * vkp - s * vkq;
                    V[k][q] = s * vkp + c * vkq;
                }
            }
        }
    }
    w[0] = a[0][0];
    w[1] = a[1][1];
    w[2] = a[2][2];
}

// ===========================================================================
// (3) FLATNESS
// ===========================================================================
FlatnessResult evaluateFlatness(const std::vector<Vec3>& pts, double tol) {
    FlatnessResult r;
    if (pts.size() < 3) {
        r.reason = "fewer than 3 points";
        return r;
    }

    // Centroid.
    Vec3 c{0, 0, 0};
    for (const auto& p : pts) c = add(c, p);
    c = scale(c, 1.0 / static_cast<double>(pts.size()));

    // Covariance (symmetric 3x3) of the centered points.
    double cov[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    for (const auto& p : pts) {
        Vec3 d = sub(p, c);
        cov[0][0] += d.x * d.x; cov[0][1] += d.x * d.y; cov[0][2] += d.x * d.z;
        cov[1][1] += d.y * d.y; cov[1][2] += d.y * d.z;
        cov[2][2] += d.z * d.z;
    }
    cov[1][0] = cov[0][1];
    cov[2][0] = cov[0][2];
    cov[2][1] = cov[1][2];

    double w[3];
    double V[3][3];
    jacobiEigen(cov, w, V);

    // Best-fit plane normal = eigenvector of the SMALLEST eigenvalue.
    int imin = 0;
    if (w[1] < w[imin]) imin = 1;
    if (w[2] < w[imin]) imin = 2;
    Vec3 n = normalize(Vec3{V[0][imin], V[1][imin], V[2][imin]});
    if (norm(n) == 0.0) {
        r.reason = "degenerate covariance (collinear points)";
        return r;
    }

    // Signed distances of every point from the centroid plane along n.
    double dmin = std::numeric_limits<double>::infinity();
    double dmax = -std::numeric_limits<double>::infinity();
    double maxAbs = 0.0;
    for (const auto& p : pts) {
        double sd = dot(sub(p, c), n);
        dmin = std::min(dmin, sd);
        dmax = std::max(dmax, sd);
        maxAbs = std::max(maxAbs, std::fabs(sd));
    }

    r.ok = true;
    r.fitPlane = Plane{c, n};
    r.flatness = dmax - dmin;        // peak-to-valley band = Y14.5 flatness value
    r.maxAbsDeviation = maxAbs;      // max |signed distance| (prompt's phrasing)
    r.pass = (r.flatness <= tol);
    r.reason = "";
    return r;
}

// ===========================================================================
// (4) PERPENDICULARITY
// ===========================================================================
//
// A feature that must be ⊥ to a datum has its DIRECTION PARALLEL to the datum's
// NORMAL. So the orientation error is the angle between featureDir and
// datumNormal. We fold direction sign (a flipped axis points the same line) so
// the angle is in [0, 90]: angle = acos(|cosθ|).
PerpendicularityResult evaluatePerpendicularity(const Vec3& featureDir,
                                                const Vec3& datumNormal,
                                                double tol,
                                                double featureLength) {
    PerpendicularityResult r;

    Vec3 f = normalize(featureDir);
    Vec3 n = normalize(datumNormal);
    if (norm(f) == 0.0 || norm(n) == 0.0) {
        r.reason = "degenerate feature direction or datum normal";
        return r;
    }

    double cosT = dot(f, n);
    if (cosT > 1.0) cosT = 1.0;
    if (cosT < -1.0) cosT = -1.0;
    double ang = std::acos(std::fabs(cosT));   // [0, pi/2]

    r.angleDeg = ang * 180.0 / M_PI;
    // Orientation deviation across the feature length: the tolerance zone is two
    // parallel planes `tol` apart; a feature of `featureLength` tilted by `ang`
    // spans featureLength*tan(ang) across that zone.
    r.deviation = std::fabs(featureLength) * std::tan(ang);
    r.pass = (r.deviation <= tol);
    r.ok = true;
    r.reason = "";
    return r;
}

} // namespace gdt
} // namespace native
} // namespace forge
