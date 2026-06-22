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

// ===========================================================================
// (5) GEOMETRIC GD&T / FCF VALIDATOR (task #26)
// ===========================================================================
//
// Reuses the Vec3 algebra, the DRF transforms, the MMC/LMC bonus branch (via
// evaluateTruePosition / the new mmcBonus), and the jacobiEigen LS-plane/axis
// machinery declared above. No new eigensolver is exported. All zone metrics
// follow the ASME Y14.5-2018 clauses cited in the header.

// ---------------------------------------------------------------------------
// (c) MMC / LMC geometric bonus — numerically identical to
//     evaluateTruePosition's bonus branch (Y14.5 §7.3.3).
// ---------------------------------------------------------------------------
double mmcBonus(double actualSize, double materialLimit,
                MaterialCondition mc, FeatureType ft) {
    double bonus = 0.0;
    if (mc == MaterialCondition::MMC) {
        bonus = (ft == FeatureType::HOLE) ? (actualSize - materialLimit)
                                          : (materialLimit - actualSize);
    } else if (mc == MaterialCondition::LMC) {
        bonus = (ft == FeatureType::HOLE) ? (materialLimit - actualSize)
                                          : (actualSize - materialLimit);
    }
    if (bonus < 0.0) bonus = 0.0;
    return bonus;
}

// ---------------------------------------------------------------------------
// (a) POSITION of an axis — cylindrical Ø zone, RFS + MMC/LMC bonus.
// ---------------------------------------------------------------------------
ToleranceZoneVerdict validatePositionPointSet(
    const std::vector<Vec3>& axisSamplesDrf, const Point2D& trueLoc,
    double actualSize, double materialLimit, double positionTolDia,
    MaterialCondition mc, FeatureType ft) {
    ToleranceZoneVerdict v;
    v.characteristic = Characteristic::POSITION;
    v.zoneType = ZoneType::CYLINDRICAL;

    if (axisSamplesDrf.empty()) {
        v.ok = false;
        v.reason = "no axis samples";
        return v;
    }

    v.bonus = mmcBonus(actualSize, materialLimit, mc, ft);
    v.allowedZone = positionTolDia + v.bonus;  // Ø zone at the material condition

    // Each sample's radial distance r from the basic axis (DRF Z line through
    // trueLoc) gives a DIAMETRAL deviation 2r (Y14.5 §7.3).
    double worst = 0.0;
    std::size_t inside = 0;
    for (const auto& p : axisSamplesDrf) {
        double dx = p.x - trueLoc.x;
        double dy = p.y - trueLoc.y;
        double dia = 2.0 * std::sqrt(dx * dx + dy * dy);
        if (dia > worst) worst = dia;
        if (dia <= v.allowedZone) ++inside;
    }
    v.worstDeviationMm = worst;
    v.conformingFraction =
        static_cast<double>(inside) / static_cast<double>(axisSamplesDrf.size());
    v.pass = (worst <= v.allowedZone);
    v.ok = true;
    v.reason = "";
    return v;
}

// ---------------------------------------------------------------------------
// (a) FLATNESS — two parallel planes `tol` apart (reuses evaluateFlatness).
// ---------------------------------------------------------------------------
ToleranceZoneVerdict validateFlatnessPointSet(
    const std::vector<Vec3>& pts, double tol) {
    ToleranceZoneVerdict v;
    v.characteristic = Characteristic::FLATNESS;
    v.zoneType = ZoneType::TWO_PARALLEL_PLANES;
    v.allowedZone = tol;
    v.bonus = 0.0;  // a form control never carries a bonus

    FlatnessResult fr = evaluateFlatness(pts, tol);
    if (!fr.ok) {
        v.ok = false;
        v.reason = fr.reason;
        return v;
    }

    v.worstDeviationMm = fr.flatness;  // peak-to-valley band

    // Per-point conformance: a point conforms iff it sits inside a tol-wide band
    // centred on the LS plane (|signed distance| <= tol/2).
    const Vec3 c = fr.fitPlane.point;
    const Vec3 n = normalize(fr.fitPlane.normal);
    std::size_t inside = 0;
    for (const auto& p : pts) {
        if (std::fabs(dot(sub(p, c), n)) <= 0.5 * tol + 1e-12) ++inside;
    }
    v.conformingFraction =
        static_cast<double>(inside) / static_cast<double>(pts.size());
    v.pass = (fr.flatness <= tol);
    v.ok = true;
    v.reason = "";
    return v;
}

// ---------------------------------------------------------------------------
// (a) PERPENDICULARITY / PARALLELISM / ANGULARITY of a planar surface.
//
// ASME Y14.5-2018 §6.7–6.9: the zone is two parallel planes `tol` apart oriented
// at the basic angle to the DATUM. The conformance band is the spread of the
// feature points measured along the NOMINAL DATUM-RELATIVE zone normal — a FIXED
// direction the datum normal + basic angle define — NOT the points' own best-fit
// normal. That fixed-direction band is what makes a flat-but-MIS-ORIENTED plate
// FAIL: along its own LS normal a flat plate's band is ~0 regardless of how it is
// tilted to the datum (the prior bug), but along the fixed nominal normal a θ
// tilt opens a band ≈ span·sin(θ).
//
// Nominal zone normal `zn` (the band is measured along it):
//   parallelism  (0°)   : zn = datum normal (feature nominally ∥ datum).
//   perpendicularity(90°): the feature is nominally ⊥ the datum, so its nominal
//                          surface normal lies IN the datum plane (⊥ datumNormal);
//                          zn = the caller-supplied `nominalFeatureNormal`,
//                          projected into the datum plane (Gram-Schmidt). Never
//                          guessed — if absent/parallel-to-datum it is an error.
//   angularity   (θ)    : zn = datum normal rotated by θ toward the in-plane
//                          reference (Rodrigues): 0°→datumNormal, 90°→in-plane.
// ---------------------------------------------------------------------------
ToleranceZoneVerdict validateOrientationPointSet(
    const std::vector<Vec3>& pts, const Vec3& datumNormal,
    Characteristic c, double basicAngleDeg, double tol,
    const Vec3& nominalFeatureNormal) {
    ToleranceZoneVerdict v;
    v.characteristic = c;
    v.zoneType = ZoneType::TWO_PARALLEL_PLANES;
    v.allowedZone = tol;
    v.bonus = 0.0;

    if (pts.size() < 2) {
        v.ok = false;
        v.reason = "fewer than 2 points";
        return v;
    }
    Vec3 dn = normalize(datumNormal);
    if (norm(dn) == 0.0) {
        v.ok = false;
        v.reason = "degenerate datum normal";
        return v;
    }

    // The basic angle the FEATURE SURFACE makes with the DATUM plane:
    //   parallelism 0°, perpendicularity 90°, angularity = basicAngleDeg.
    double thetaDeg = (c == Characteristic::PARALLELISM)      ? 0.0
                    : (c == Characteristic::PERPENDICULARITY) ? 90.0
                                                              : basicAngleDeg;
    double theta = thetaDeg * M_PI / 180.0;

    // Build the nominal zone normal `zn`. Parallelism needs only the datum
    // normal; perpendicularity/angularity need the in-plane reference direction
    // derived from the caller-supplied nominal feature normal (Gram-Schmidt:
    // remove its datum-normal component, leaving the part that lies IN the datum
    // plane). We do NOT fabricate a direction.
    Vec3 zn;
    if (std::fabs(theta) < 1e-12) {
        // parallelism: zone planes parallel to the datum -> zn = datum normal.
        zn = dn;
    } else {
        Vec3 ref = normalize(nominalFeatureNormal);
        if (norm(ref) == 0.0) {
            v.ok = false;
            v.reason = "perpendicularity/angularity needs a nominal feature normal";
            return v;
        }
        // In-plane reference = ref with its datum-normal component removed.
        Vec3 inPlane = sub(ref, scale(dn, dot(ref, dn)));
        if (norm(inPlane) < 1e-12) {
            v.ok = false;
            v.reason = "nominal feature normal parallel to datum normal "
                       "(no in-plane reference)";
            return v;
        }
        Vec3 ip = normalize(inPlane);
        // Rotate dn toward ip by theta: at 0° -> dn, at 90° -> ip. dn and ip are
        // orthonormal, so this is a planar rotation in their span.
        zn = normalize(add(scale(dn, std::cos(theta)),
                           scale(ip, std::sin(theta))));
        if (norm(zn) == 0.0) {
            v.ok = false;
            v.reason = "degenerate nominal zone normal";
            return v;
        }
    }

    // Conformance band = peak-to-valley of the points projected onto the FIXED
    // nominal zone normal `zn` (datum-relative — independent of the points' own
    // best-fit normal). A correctly-oriented flat feature has a tiny band; a
    // tilted/mis-oriented one opens a large band and FAILS.
    Vec3 cen{0, 0, 0};
    for (const auto& p : pts) cen = add(cen, p);
    cen = scale(cen, 1.0 / static_cast<double>(pts.size()));

    double lo = std::numeric_limits<double>::infinity();
    double hi = -std::numeric_limits<double>::infinity();
    for (const auto& p : pts) {
        double sd = dot(sub(p, cen), zn);
        lo = std::min(lo, sd);
        hi = std::max(hi, sd);
    }
    double band = hi - lo;
    double mid = 0.5 * (hi + lo);
    std::size_t inside = 0;
    for (const auto& p : pts) {
        double sd = dot(sub(p, cen), zn);
        if (std::fabs(sd - mid) <= 0.5 * tol + 1e-12) ++inside;
    }
    v.worstDeviationMm = band;
    v.conformingFraction =
        static_cast<double>(inside) / static_cast<double>(pts.size());
    v.pass = (band <= tol);
    v.ok = true;
    v.reason = "";
    return v;
}

// ---------------------------------------------------------------------------
// LS circle fit in a plane (algebraic / Kåsa fit): minimise
// sum (x^2+y^2 - 2*a*x - 2*b*y - c)^2 -> linear normal equations for (a,b,c),
// center (a,b), radius sqrt(c + a^2 + b^2). Closed-form 3x3 solve.
// ---------------------------------------------------------------------------
static bool lsCircleXY(const std::vector<Point2D>& P, double& cx, double& cy) {
    const std::size_t n = P.size();
    if (n < 3) return false;
    double Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
    for (const auto& p : P) {
        double z = p.x * p.x + p.y * p.y;
        Sx += p.x; Sy += p.y;
        Sxx += p.x * p.x; Syy += p.y * p.y; Sxy += p.x * p.y;
        Sxz += p.x * z; Syz += p.y * z; Sz += z;
    }
    double N = static_cast<double>(n);
    // Solve for (a,b,c): [Sxx Sxy Sx; Sxy Syy Sy; Sx Sy N] [2a;2b;c] = [Sxz;Syz;Sz]
    double M[3][3] = {{Sxx, Sxy, Sx}, {Sxy, Syy, Sy}, {Sx, Sy, N}};
    double rhs[3] = {Sxz, Syz, Sz};
    double D = det3(M[0][0], M[0][1], M[0][2],
                    M[1][0], M[1][1], M[1][2],
                    M[2][0], M[2][1], M[2][2]);
    if (std::fabs(D) < 1e-15) return false;
    double Dx = det3(rhs[0], M[0][1], M[0][2],
                     rhs[1], M[1][1], M[1][2],
                     rhs[2], M[2][1], M[2][2]);
    double Dy = det3(M[0][0], rhs[0], M[0][2],
                     M[1][0], rhs[1], M[1][2],
                     M[2][0], rhs[2], M[2][2]);
    double twoA = Dx / D;  // = 2a
    double twoB = Dy / D;  // = 2b
    cx = 0.5 * twoA;
    cy = 0.5 * twoB;
    return true;
}

// ---------------------------------------------------------------------------
// (a) CIRCULARITY — two coaxial circles radially `tol` apart (one section).
// ---------------------------------------------------------------------------
ToleranceZoneVerdict validateCircularityPointSet(
    const std::vector<Vec3>& sectionPtsDrf, double tol) {
    ToleranceZoneVerdict v;
    v.characteristic = Characteristic::CIRCULARITY;
    v.zoneType = ZoneType::TWO_COAXIAL_CYL;
    v.allowedZone = tol;
    v.bonus = 0.0;

    if (sectionPtsDrf.size() < 3) {
        v.ok = false;
        v.reason = "fewer than 3 section points";
        return v;
    }
    std::vector<Point2D> P;
    P.reserve(sectionPtsDrf.size());
    for (const auto& p : sectionPtsDrf) P.push_back(Point2D{p.x, p.y});

    double cx = 0, cy = 0;
    if (!lsCircleXY(P, cx, cy)) {
        v.ok = false;
        v.reason = "degenerate circle fit (collinear points)";
        return v;
    }
    double rmin = std::numeric_limits<double>::infinity();
    double rmax = -std::numeric_limits<double>::infinity();
    for (const auto& p : P) {
        double r = std::sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
        rmin = std::min(rmin, r);
        rmax = std::max(rmax, r);
    }
    double radialBand = rmax - rmin;  // Y14.5 §5.4.3 circularity value
    // Conformance: each point within the tol-wide radial band about the mean R.
    double rmid = 0.5 * (rmin + rmax);
    std::size_t inside = 0;
    for (const auto& p : P) {
        double r = std::sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
        if (std::fabs(r - rmid) <= 0.5 * tol + 1e-12) ++inside;
    }
    v.worstDeviationMm = radialBand;
    v.conformingFraction =
        static_cast<double>(inside) / static_cast<double>(P.size());
    v.pass = (radialBand <= tol);
    v.ok = true;
    v.reason = "";
    return v;
}

// ---------------------------------------------------------------------------
// Fit a cylinder's radial band about a GIVEN axis direction `axis` through the
// centroid `cen`: project the points onto the plane ⊥ axis, LS-fit the circle
// there, return (R_max − R_min) about that circle (and the per-point inside
// count for a tol-wide band). Returns false on a degenerate in-plane fit.
// ---------------------------------------------------------------------------
static bool radialBandAboutAxis(const std::vector<Vec3>& pts, const Vec3& cen,
                                const Vec3& axis, double tol,
                                double& bandOut, std::size_t& insideOut) {
    Vec3 a = normalize(axis);
    if (norm(a) == 0.0) return false;
    Vec3 helper = (std::fabs(a.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
    Vec3 e1 = normalize(cross(a, helper));
    Vec3 e2 = normalize(cross(a, e1));
    if (norm(e1) == 0.0 || norm(e2) == 0.0) return false;
    std::vector<Point2D> P;
    P.reserve(pts.size());
    for (const auto& p : pts) {
        Vec3 d = sub(p, cen);
        P.push_back(Point2D{dot(d, e1), dot(d, e2)});
    }
    double cu = 0, cv = 0;
    if (!lsCircleXY(P, cu, cv)) return false;
    double rmin = std::numeric_limits<double>::infinity();
    double rmax = -std::numeric_limits<double>::infinity();
    for (const auto& p : P) {
        double r = std::sqrt((p.x - cu) * (p.x - cu) + (p.y - cv) * (p.y - cv));
        rmin = std::min(rmin, r);
        rmax = std::max(rmax, r);
    }
    double rmid = 0.5 * (rmin + rmax);
    std::size_t inside = 0;
    for (const auto& p : P) {
        double r = std::sqrt((p.x - cu) * (p.x - cu) + (p.y - cv) * (p.y - cv));
        if (std::fabs(r - rmid) <= 0.5 * tol + 1e-12) ++inside;
    }
    bandOut = rmax - rmin;
    insideOut = inside;
    return true;
}

// ---------------------------------------------------------------------------
// (a) CYLINDRICITY — two coaxial cylinders radially `tol` apart (full surface).
//
// The cylinder axis is recovered from the covariance eigenvectors. Aspect ratio
// is NOT assumed: for a tall cylinder the axis is the largest-eigenvalue vector,
// but for a short/fat one it is NOT, so we evaluate the radial band about each of
// the three principal directions and KEEP THE TIGHTEST — that is the true axis
// (any non-axis direction inflates the projected radial scatter). The radial band
// R_max−R_min about that axis is the Y14.5 §5.4.4 cylindricity value.
// ---------------------------------------------------------------------------
ToleranceZoneVerdict validateCylindricityPointSet(
    const std::vector<Vec3>& surfacePtsDrf, double tol) {
    ToleranceZoneVerdict v;
    v.characteristic = Characteristic::CYLINDRICITY;
    v.zoneType = ZoneType::TWO_COAXIAL_CYL;
    v.allowedZone = tol;
    v.bonus = 0.0;

    if (surfacePtsDrf.size() < 6) {
        v.ok = false;
        v.reason = "fewer than 6 surface points";
        return v;
    }

    // Centroid + covariance.
    Vec3 cen{0, 0, 0};
    for (const auto& p : surfacePtsDrf) cen = add(cen, p);
    cen = scale(cen, 1.0 / static_cast<double>(surfacePtsDrf.size()));
    double cov[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    for (const auto& p : surfacePtsDrf) {
        Vec3 d = sub(p, cen);
        cov[0][0] += d.x * d.x; cov[0][1] += d.x * d.y; cov[0][2] += d.x * d.z;
        cov[1][1] += d.y * d.y; cov[1][2] += d.y * d.z;
        cov[2][2] += d.z * d.z;
    }
    cov[1][0] = cov[0][1]; cov[2][0] = cov[0][2]; cov[2][1] = cov[1][2];
    double w[3]; double V[3][3];
    jacobiEigen(cov, w, V);

    // Try each principal direction as the candidate axis; the true cylinder axis
    // gives the SMALLEST radial band (off-axis projections smear the circle into
    // an ellipse and widen R_max−R_min).
    double bestBand = std::numeric_limits<double>::infinity();
    std::size_t bestInside = 0;
    bool any = false;
    for (int k = 0; k < 3; ++k) {
        Vec3 axis{V[0][k], V[1][k], V[2][k]};
        double band; std::size_t inside;
        if (radialBandAboutAxis(surfacePtsDrf, cen, axis, tol, band, inside)) {
            if (band < bestBand) { bestBand = band; bestInside = inside; any = true; }
            else if (!any)       { bestInside = inside; any = true; }
        }
    }
    if (!any) {
        v.ok = false;
        v.reason = "degenerate axis / circle fit";
        return v;
    }

    v.worstDeviationMm = bestBand;  // Y14.5 §5.4.4 cylindricity value
    v.conformingFraction =
        static_cast<double>(bestInside) / static_cast<double>(surfacePtsDrf.size());
    v.pass = (bestBand <= tol);
    v.ok = true;
    v.reason = "";
    return v;
}

// ---------------------------------------------------------------------------
// (a) PROFILE-OF-A-SURFACE — band of width `tol` about the true profile, normal
//     to it. Bilateral ±tol/2; unilateral 0..tol on the outward side.
// ---------------------------------------------------------------------------
ToleranceZoneVerdict validateProfilePointSet(
    const std::vector<Vec3>& measuredPts,
    const std::vector<Vec3>& trueProfilePts,
    const std::vector<Vec3>& trueProfileNormals,
    double profileTol, bool unilateral) {
    ToleranceZoneVerdict v;
    v.characteristic = Characteristic::PROFILE_SURFACE;
    v.zoneType = unilateral ? ZoneType::UNILATERAL_PROFILE
                            : ZoneType::BILATERAL_PROFILE;
    v.allowedZone = profileTol;
    v.bonus = 0.0;

    if (measuredPts.empty() ||
        measuredPts.size() != trueProfilePts.size() ||
        measuredPts.size() != trueProfileNormals.size()) {
        v.ok = false;
        v.reason = "empty or mismatched profile arrays";
        return v;
    }

    const double half = 0.5 * profileTol;
    double worstAbs = 0.0;
    std::size_t inside = 0;
    for (std::size_t i = 0; i < measuredPts.size(); ++i) {
        Vec3 nrm = normalize(trueProfileNormals[i]);
        if (norm(nrm) == 0.0) {
            v.ok = false;
            v.reason = "degenerate true-profile normal";
            return v;
        }
        // Signed deviation of the measured point from the true profile, along the
        // outward normal (positive = outside the true surface).
        double sd = dot(sub(measuredPts[i], trueProfilePts[i]), nrm);
        if (std::fabs(sd) > worstAbs) worstAbs = std::fabs(sd);
        bool conf = unilateral ? (sd >= -1e-12 && sd <= profileTol + 1e-12)
                               : (std::fabs(sd) <= half + 1e-12);
        if (conf) ++inside;
    }

    v.worstDeviationMm = worstAbs;  // max |signed normal deviation|
    v.conformingFraction =
        static_cast<double>(inside) / static_cast<double>(measuredPts.size());
    // Pass iff EVERY point conforms (conformingFraction == 1).
    v.pass = (inside == measuredPts.size());
    v.ok = true;
    v.reason = "";
    return v;
}

// ---------------------------------------------------------------------------
// (a') Unified dispatcher.
// ---------------------------------------------------------------------------
ToleranceZoneVerdict validatePointSetAgainstZone(
    Characteristic c, const std::vector<Vec3>& pts,
    const Point2D& featureCenter, const Vec3& featureAxis,
    double tol, double basicAngleDeg,
    MaterialCondition mc, FeatureType ft, double actualSize, double mmcSize,
    const std::vector<Vec3>& trueProfilePts,
    const std::vector<Vec3>& trueProfileNormals,
    bool unilateralProfile,
    const Vec3& nominalFeatureNormal) {
    switch (c) {
        case Characteristic::POSITION:
            return validatePositionPointSet(pts, featureCenter, actualSize,
                                            mmcSize, tol, mc, ft);
        case Characteristic::FLATNESS:
            return validateFlatnessPointSet(pts, tol);
        case Characteristic::PERPENDICULARITY:
        case Characteristic::PARALLELISM:
        case Characteristic::ANGULARITY:
            return validateOrientationPointSet(pts, featureAxis, c,
                                               basicAngleDeg, tol,
                                               nominalFeatureNormal);
        case Characteristic::CIRCULARITY:
            return validateCircularityPointSet(pts, tol);
        case Characteristic::CYLINDRICITY:
            return validateCylindricityPointSet(pts, tol);
        case Characteristic::PROFILE_SURFACE:
            return validateProfilePointSet(pts, trueProfilePts,
                                           trueProfileNormals, tol,
                                           unilateralProfile);
    }
    ToleranceZoneVerdict v;
    v.ok = false;
    v.reason = "unknown characteristic";
    return v;
}

// ---------------------------------------------------------------------------
// (b) FCF LEGALITY checker (geometric feasibility, not string grammar).
// ---------------------------------------------------------------------------
static bool isFormControl(Characteristic c) {
    return c == Characteristic::FLATNESS ||
           c == Characteristic::CIRCULARITY ||
           c == Characteristic::CYLINDRICITY;
}
static bool isOrientation(Characteristic c) {
    return c == Characteristic::PERPENDICULARITY ||
           c == Characteristic::PARALLELISM ||
           c == Characteristic::ANGULARITY;
}

FcfLegality checkFcfLegality(
    Characteristic c, ControlledFeature feat, MaterialCondition mc,
    const std::vector<char>& datumRefs, const std::vector<char>& availableDatums) {
    FcfLegality r;

    // --- datum count & duplicate checks (max 3 datum references) ---
    if (datumRefs.size() > 3) {
        r.reason = "more than three datum references";
        return r;
    }
    for (std::size_t i = 0; i < datumRefs.size(); ++i) {
        for (std::size_t j = i + 1; j < datumRefs.size(); ++j) {
            if (datumRefs[i] == datumRefs[j]) {
                r.reason = "duplicate datum reference";
                return r;
            }
        }
    }
    // --- every referenced datum must exist on the part ---
    for (char d : datumRefs) {
        bool found = false;
        for (char a : availableDatums) {
            if (a == d) { found = true; break; }
        }
        if (!found) {
            r.reason = "referenced datum does not exist on the part";
            return r;
        }
    }

    // --- characteristic-vs-datum legality ---
    // Form controls (flatness, circularity, cylindricity) take NO datum.
    if (isFormControl(c) && !datumRefs.empty()) {
        r.reason = "form control cannot reference a datum";
        return r;
    }
    // Position requires at least one datum (it locates a FoS to a frame).
    if (c == Characteristic::POSITION && datumRefs.empty()) {
        r.reason = "position requires at least one datum reference";
        return r;
    }
    // Orientation controls require at least one datum (the thing to orient to).
    if (isOrientation(c) && datumRefs.empty()) {
        r.reason = "orientation control requires a datum reference";
        return r;
    }

    // --- characteristic-vs-feature legality ---
    if (c == Characteristic::POSITION && feat != ControlledFeature::FEATURE_OF_SIZE &&
        feat != ControlledFeature::CYLINDER_AXIS) {
        r.reason = "position applies only to a feature of size / its axis";
        return r;
    }
    if (c == Characteristic::FLATNESS &&
        feat != ControlledFeature::PLANAR_SURFACE &&
        feat != ControlledFeature::FEATURE_OF_SIZE) {
        r.reason = "flatness applies to a planar surface (or a FoS derived median)";
        return r;
    }
    if (c == Characteristic::CIRCULARITY &&
        feat != ControlledFeature::CYLINDER_SURFACE &&
        feat != ControlledFeature::LINE_ELEMENT) {
        r.reason = "circularity applies to a round surface / line element";
        return r;
    }
    if (c == Characteristic::CYLINDRICITY &&
        feat != ControlledFeature::CYLINDER_SURFACE) {
        r.reason = "cylindricity applies only to a cylindrical surface";
        return r;
    }

    // --- material-condition modifier legality (Y14.5 §7) ---
    // MMC/LMC are legal ONLY on a feature-of-size characteristic applied to a
    // feature of size: position, and the FoS forms of orientation. Form controls
    // and surface profile CANNOT carry MMC/LMC.
    if (mc != MaterialCondition::RFS) {
        bool fosCharacteristic =
            (c == Characteristic::POSITION) ||
            (isOrientation(c) && (feat == ControlledFeature::FEATURE_OF_SIZE ||
                                  feat == ControlledFeature::CYLINDER_AXIS));
        if (!fosCharacteristic) {
            r.reason = "MMC/LMC modifier valid only on a feature-of-size control";
            return r;
        }
        // A material modifier needs a feature of size to draw the bonus from.
        if (feat != ControlledFeature::FEATURE_OF_SIZE &&
            feat != ControlledFeature::CYLINDER_AXIS) {
            r.reason = "material modifier requires a feature of size";
            return r;
        }
    }

    r.legal = true;
    r.reason = "";
    return r;
}

} // namespace gdt
} // namespace native
} // namespace forge
