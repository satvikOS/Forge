// forge/native/surfit/Surfit.cpp
//
// Implementation of the point-supervised parametric surface fitter (Surfit.hpp).
// Pure C++20, no external dependencies. See the header for honesty / scope.
//
// References (algorithms re-implemented from the standard mathematical
// definitions, not copied source): least-squares B-spline surface fitting and
// the closest-point (footpoint) reparameterization in Piegl & Tiller "The NURBS
// Book" §9.4; the cyclic-Jacobi symmetric eigensolver for the 3x3 covariance;
// Cholesky factorization for the SPD normal equations.

#include "forge/native/surfit/Surfit.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>
#include <vector>

#include "forge/native/brep/Nurbs.hpp"          // findSpan / basisFunctions / NurbsSurface / Vec3
#include "forge/native/brep/NurbsSurface.hpp"   // evaluateWithDerivatives / SurfaceSample

namespace forge {
namespace native {
namespace surfit {

namespace {

// ---- tiny Vec3 helpers (local, self-contained) ----------------------------
inline Vec3 sub(const Vec3& a, const Vec3& b) { return Vec3{a.x - b.x, a.y - b.y, a.z - b.z}; }
inline double dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline double norm(const Vec3& a) { return std::sqrt(dot(a, a)); }
inline bool finite3(const Vec3& a) {
    return std::isfinite(a.x) && std::isfinite(a.y) && std::isfinite(a.z);
}

// ---------------------------------------------------------------------------
// Cyclic Jacobi eigensolver for a symmetric 3x3 matrix. Returns eigenvalues
// (ascending) in `eval` and the matching column eigenvectors in `evec` (evec[k]
// is the unit eigenvector for eval[k]). Self-contained (~40 lines) so this TU
// takes no dependency on PrimitiveFit's helpers.
// ---------------------------------------------------------------------------
void jacobiEigen3(const double Ain[3][3], double eval[3], Vec3 evec[3]) {
    double A[3][3];
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) A[i][j] = Ain[i][j];

    // V accumulates the rotations -> columns are eigenvectors.
    double V[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};

    for (int sweep = 0; sweep < 64; ++sweep) {
        double off = std::fabs(A[0][1]) + std::fabs(A[0][2]) + std::fabs(A[1][2]);
        if (off < 1e-18) break;
        // Rotate the three off-diagonal (p,q) pairs in turn.
        static const int P[3] = {0, 0, 1};
        static const int Q[3] = {1, 2, 2};
        for (int k = 0; k < 3; ++k) {
            const int p = P[k], q = Q[k];
            const double apq = A[p][q];
            if (std::fabs(apq) < 1e-300) continue;
            const double app = A[p][p], aqq = A[q][q];
            const double phi = 0.5 * (aqq - app) / apq;
            double t = (phi >= 0.0 ? 1.0 : -1.0) /
                       (std::fabs(phi) + std::sqrt(phi * phi + 1.0));
            const double c = 1.0 / std::sqrt(t * t + 1.0);
            const double s = t * c;
            // Apply the Givens rotation J^T A J for the (p,q) plane.
            for (int i = 0; i < 3; ++i) {
                const double aip = A[i][p], aiq = A[i][q];
                A[i][p] = c * aip - s * aiq;
                A[i][q] = s * aip + c * aiq;
            }
            for (int i = 0; i < 3; ++i) {
                const double api = A[p][i], aqi = A[q][i];
                A[p][i] = c * api - s * aqi;
                A[q][i] = s * api + c * aqi;
            }
            for (int i = 0; i < 3; ++i) {
                const double vip = V[i][p], viq = V[i][q];
                V[i][p] = c * vip - s * viq;
                V[i][q] = s * vip + c * viq;
            }
        }
    }

    // Eigenvalues on the diagonal; sort ascending and reorder the columns.
    std::array<int, 3> order{0, 1, 2};
    double diag[3] = {A[0][0], A[1][1], A[2][2]};
    std::sort(order.begin(), order.end(),
              [&](int a, int b) { return diag[a] < diag[b]; });
    for (int k = 0; k < 3; ++k) {
        const int c = order[static_cast<std::size_t>(k)];
        eval[k] = diag[c];
        Vec3 v{V[0][c], V[1][c], V[2][c]};
        const double n = norm(v);
        if (n > 0.0) v = Vec3{v.x / n, v.y / n, v.z / n};
        evec[k] = v;
    }
}

// ---------------------------------------------------------------------------
// SPD linear solve A x = b for a symmetric positive-definite A (Cholesky), with
// a Gaussian-elimination + partial-pivoting fallback if A is not numerically PD
// (a negative/zero pivot appears). Solves for `nrhs` right-hand sides packed
// column-major in B (size M*nrhs); X overwrites the solution (size M*nrhs).
// Returns false only if the system is singular even under pivoting.
// ---------------------------------------------------------------------------
bool solveSPD(const std::vector<double>& A, std::size_t M,
              const std::vector<double>& B, std::size_t nrhs,
              std::vector<double>& X) {
    // --- attempt Cholesky: A = L L^T ---
    std::vector<double> L(M * M, 0.0);
    bool spd = true;
    for (std::size_t i = 0; i < M && spd; ++i) {
        for (std::size_t j = 0; j <= i; ++j) {
            double sum = A[i * M + j];
            for (std::size_t k = 0; k < j; ++k) sum -= L[i * M + k] * L[j * M + k];
            if (i == j) {
                if (sum <= 0.0 || !std::isfinite(sum)) { spd = false; break; }
                L[i * M + j] = std::sqrt(sum);
            } else {
                L[i * M + j] = sum / L[j * M + j];
            }
        }
    }
    if (spd) {
        X.assign(M * nrhs, 0.0);
        for (std::size_t r = 0; r < nrhs; ++r) {
            // forward solve L y = b
            std::vector<double> y(M, 0.0);
            for (std::size_t i = 0; i < M; ++i) {
                double sum = B[r * M + i];
                for (std::size_t k = 0; k < i; ++k) sum -= L[i * M + k] * y[k];
                y[i] = sum / L[i * M + i];
            }
            // back solve L^T x = y
            for (std::size_t ii = M; ii-- > 0;) {
                double sum = y[ii];
                for (std::size_t k = ii + 1; k < M; ++k) sum -= L[k * M + ii] * X[r * M + k];
                X[r * M + ii] = sum / L[ii * M + ii];
            }
        }
        return true;
    }

    // --- fallback: Gaussian elimination with partial pivoting on [A | B] ---
    std::vector<double> a(A);          // working copy of A (row-major M x M)
    std::vector<double> b(B);          // working copy of B (M x nrhs col-major)
    for (std::size_t col = 0; col < M; ++col) {
        std::size_t piv = col;
        double best = std::fabs(a[col * M + col]);
        for (std::size_t r = col + 1; r < M; ++r) {
            const double v = std::fabs(a[r * M + col]);
            if (v > best) { best = v; piv = r; }
        }
        if (best < 1e-300) return false;
        if (piv != col) {
            for (std::size_t k = 0; k < M; ++k) std::swap(a[col * M + k], a[piv * M + k]);
            for (std::size_t r = 0; r < nrhs; ++r) std::swap(b[r * M + col], b[r * M + piv]);
        }
        const double pivVal = a[col * M + col];
        for (std::size_t r = col + 1; r < M; ++r) {
            const double f = a[r * M + col] / pivVal;
            if (f == 0.0) continue;
            for (std::size_t k = col; k < M; ++k) a[r * M + k] -= f * a[col * M + k];
            for (std::size_t rr = 0; rr < nrhs; ++rr) b[rr * M + r] -= f * b[rr * M + col];
        }
    }
    X.assign(M * nrhs, 0.0);
    for (std::size_t r = 0; r < nrhs; ++r) {
        for (std::size_t ii = M; ii-- > 0;) {
            double sum = b[r * M + ii];
            for (std::size_t k = ii + 1; k < M; ++k) sum -= a[ii * M + k] * X[r * M + k];
            X[r * M + ii] = sum / a[ii * M + ii];
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Build a clamped open-uniform knot vector for (degree, count): first/last knot
// repeated (degree+1) times, the (count-degree-1) interior knots evenly spaced
// in (0,1). Size = count + degree + 1.
// ---------------------------------------------------------------------------
std::vector<double> clampedKnots(std::size_t degree, std::size_t count) {
    std::vector<double> k;
    k.reserve(count + degree + 1);
    for (std::size_t i = 0; i <= degree; ++i) k.push_back(0.0);
    const std::size_t interior = count - degree - 1;  // count > degree guaranteed by caller
    for (std::size_t i = 1; i <= interior; ++i)
        k.push_back(static_cast<double>(i) / static_cast<double>(interior + 1));
    for (std::size_t i = 0; i <= degree; ++i) k.push_back(1.0);
    return k;
}

// Clamp x to [0,1].
inline double clamp01(double x) { return x < 0.0 ? 0.0 : (x > 1.0 ? 1.0 : x); }

// ---------------------------------------------------------------------------
// Closest-point (footpoint) of `p` on surface `s`: a coarse grid seed refined by
// a few clamped Gauss-Newton steps. Returns the (u,v) and the squared distance.
// `gridN` controls the seed resolution.
// ---------------------------------------------------------------------------
struct Footpoint { double u, v, dist2; };

Footpoint closestPoint(const NurbsSurface& s, const Vec3& p, std::size_t gridN) {
    // --- coarse grid seed ---
    double bu = 0.0, bv = 0.0, bd2 = std::numeric_limits<double>::infinity();
    for (std::size_t i = 0; i <= gridN; ++i) {
        const double u = static_cast<double>(i) / static_cast<double>(gridN);
        for (std::size_t j = 0; j <= gridN; ++j) {
            const double v = static_cast<double>(j) / static_cast<double>(gridN);
            const Vec3 q = s.evaluate(u, v);
            const Vec3 d = sub(p, q);
            const double d2 = dot(d, d);
            if (d2 < bd2) { bd2 = d2; bu = u; bv = v; }
        }
    }
    // --- clamped Gauss-Newton footpoint refinement ---
    double u = bu, v = bv;
    for (int it = 0; it < 12; ++it) {
        brep::SurfaceSample S = brep::evaluateWithDerivatives(s, u, v);
        if (!S.ok) break;
        const Vec3 r = sub(p, S.point);                // residual p - S
        const double a = dot(S.du, S.du);
        const double b = dot(S.du, S.dv);
        const double c = dot(S.dv, S.dv);
        const double e = dot(r, S.du);
        const double f = dot(r, S.dv);
        const double det = a * c - b * b;
        if (std::fabs(det) < 1e-18) break;
        double du = (e * c - f * b) / det;
        double dv = (a * f - b * e) / det;
        if (!std::isfinite(du) || !std::isfinite(dv)) break;
        double nu = clamp01(u + du);
        double nv = clamp01(v + dv);
        const Vec3 nq = s.evaluate(nu, nv);
        const Vec3 nd = sub(p, nq);
        const double nd2 = dot(nd, nd);
        if (nd2 <= bd2) {                              // accept only if it improves
            bd2 = nd2; bu = nu; bv = nv; u = nu; v = nv;
        } else {
            break;                                     // diverged -> keep best seed
        }
        if (du * du + dv * dv < 1e-20) break;
    }
    return Footpoint{bu, bv, bd2};
}

}  // namespace

// ===========================================================================
// chamferDistance — bidirectional point<->surface metric.
// ===========================================================================
double chamferDistance(const std::vector<Vec3>& points, const NurbsSurface& s,
                       std::size_t sampleU, std::size_t sampleV) {
    if (points.empty() || !s.valid() || sampleU == 0 || sampleV == 0) return 0.0;

    // Pre-sample the surface on a grid (reused for both directions).
    std::vector<Vec3> grid;
    grid.reserve((sampleU + 1) * (sampleV + 1));
    for (std::size_t i = 0; i <= sampleU; ++i) {
        const double u = static_cast<double>(i) / static_cast<double>(sampleU);
        for (std::size_t j = 0; j <= sampleV; ++j) {
            const double v = static_cast<double>(j) / static_cast<double>(sampleV);
            grid.push_back(s.evaluate(u, v));
        }
    }

    // cloud -> surface: footpoint distance (grid seed + Newton refine). This is
    // the genuine fit residual (each data point's distance to the fitted patch).
    const std::size_t seedN = std::max<std::size_t>(8, std::min(sampleU, sampleV));
    double sumPS = 0.0;
    for (const Vec3& p : points) {
        const Footpoint fp = closestPoint(s, p, seedN);
        sumPS += std::sqrt(std::max(0.0, fp.dist2));
    }
    const double meanPS = sumPS / static_cast<double>(points.size());

    // surface -> cloud: nearest cloud point for each surface sample.
    // NOTE (honesty): the cloud is a FINITE, DISCRETE set, so this direction has
    // an irreducible floor of ~half the cloud's sample spacing even for a perfect
    // fit (a continuous surface sample lands BETWEEN cloud points). So the
    // bidirectional Chamfer is NOT driven to ~0 by a perfect fit on a coarse grid
    // cloud — its surface->cloud half reflects the cloud's sampling density, not a
    // fit error. The true fit residual is the cloud->surface direction (and the
    // rms/maxDist reported by fitNurbsSurface). Both halves are reported here.
    double sumSP = 0.0;
    for (const Vec3& q : grid) {
        double best = std::numeric_limits<double>::infinity();
        for (const Vec3& p : points) {
            const Vec3 d = sub(q, p);
            const double d2 = dot(d, d);
            if (d2 < best) best = d2;
        }
        sumSP += std::sqrt(best);
    }
    const double meanSP = sumSP / static_cast<double>(grid.size());

    return meanPS + meanSP;
}

// ===========================================================================
// fitNurbsSurface — parameterize -> least-squares -> reparameterize iteration.
// ===========================================================================
FitResult fitNurbsSurface(const std::vector<Vec3>& points, const FitOptions& opt) {
    FitResult R;

    // --- (a) validation gates (honest reasons) ---
    if (opt.degreeU < 1 || opt.degreeV < 1) { R.reason = "degree must be >= 1"; return R; }
    if (opt.nU <= opt.degreeU || opt.nV <= opt.degreeV) {
        R.reason = "control-net size must exceed degree in each direction";
        return R;
    }
    const std::size_t M = opt.nU * opt.nV;  // total control DOF
    if (points.size() < M) {
        R.reason = "too few points for the control DOF (need >= nU*nV)";
        return R;
    }
    for (const Vec3& p : points) {
        if (!finite3(p)) { R.reason = "non-finite point in the cloud"; return R; }
    }

    const std::size_t N = points.size();

    // --- (a) base-plane parameterization: centroid + covariance eigensolve ---
    Vec3 c{0, 0, 0};
    for (const Vec3& p : points) { c.x += p.x; c.y += p.y; c.z += p.z; }
    c.x /= static_cast<double>(N); c.y /= static_cast<double>(N); c.z /= static_cast<double>(N);

    double cov[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    for (const Vec3& p : points) {
        const double dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
        cov[0][0] += dx * dx; cov[0][1] += dx * dy; cov[0][2] += dx * dz;
        cov[1][1] += dy * dy; cov[1][2] += dy * dz; cov[2][2] += dz * dz;
    }
    cov[1][0] = cov[0][1]; cov[2][0] = cov[0][2]; cov[2][1] = cov[1][2];
    const double invN = 1.0 / static_cast<double>(N);
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) cov[i][j] *= invN;

    double eval[3];
    Vec3 evec[3];
    jacobiEigen3(cov, eval, evec);
    // eval ascending: evec[2] (largest) and evec[1] (second) span the base plane;
    // evec[0] (smallest) is the normal. Degenerate if the two in-plane spreads
    // are ~0 (cloud is collinear or a single point).
    if (eval[2] <= 1e-18 || eval[1] <= 1e-18) {
        R.reason = "degenerate cloud (collinear / coincident): no valid base plane";
        return R;
    }
    // The two largest-eigenvalue eigenvectors span the base plane; the smallest
    // is the normal. For a SQUARE-ish flat cloud the two in-plane eigenvalues are
    // near-degenerate, so the eigenvectors land at an ARBITRARY in-plane rotation
    // (often ~45 deg to a grid). Normalizing such a rotated projection to [0,1]^2
    // makes a DIAMOND that circumscribes the data, so the patch boundary control
    // points overhang far into empty space. Fix: rotate the in-plane frame to the
    // orientation that MINIMIZES the projected bounding-box area (a light angle
    // scan = rotating-calipers idea), giving a tight, axis-aligned parameter
    // rectangle and no diamond overhang. The plane normal is unaffected.
    const Vec3 e1 = evec[2];
    const Vec3 e2 = evec[1];

    // Pre-project once onto (e1,e2).
    std::vector<double> p1(N), p2(N);
    for (std::size_t i = 0; i < N; ++i) {
        const Vec3 d = sub(points[i], c);
        p1[i] = dot(d, e1);
        p2[i] = dot(d, e2);
    }
    // Scan angles in [0, pi/2) for the minimum projected-bbox area.
    double bestAng = 0.0, bestArea = std::numeric_limits<double>::infinity();
    const double kHalfPi = 1.57079632679489661923;  // pi/2 (M_PI not standard C++)
    const int ANG = 90;
    for (int t = 0; t < ANG; ++t) {
        const double ang = kHalfPi * static_cast<double>(t) / static_cast<double>(ANG);
        const double ca = std::cos(ang), sa = std::sin(ang);
        double mn1 = std::numeric_limits<double>::infinity(), mx1 = -mn1;
        double mn2 = mn1, mx2 = mx1;
        for (std::size_t i = 0; i < N; ++i) {
            const double a = ca * p1[i] + sa * p2[i];
            const double b = -sa * p1[i] + ca * p2[i];
            mn1 = std::min(mn1, a); mx1 = std::max(mx1, a);
            mn2 = std::min(mn2, b); mx2 = std::max(mx2, b);
        }
        const double area = (mx1 - mn1) * (mx2 - mn2);
        if (area < bestArea) { bestArea = area; bestAng = ang; }
    }
    const double cA = std::cos(bestAng), sA = std::sin(bestAng);
    // Rotated, axis-aligned in-plane frame.
    const Vec3 eU{cA * e1.x + sA * e2.x, cA * e1.y + sA * e2.y, cA * e1.z + sA * e2.z};
    const Vec3 eV{-sA * e1.x + cA * e2.x, -sA * e1.y + cA * e2.y, -sA * e1.z + cA * e2.z};

    // Project to the aligned plane coords, capture extents for [0,1] normalization.
    std::vector<double> pu(N), pv(N);
    double aMin = std::numeric_limits<double>::infinity(), aMax = -aMin;
    double bMin = aMin, bMax = aMax;
    for (std::size_t i = 0; i < N; ++i) {
        const Vec3 d = sub(points[i], c);
        const double a = dot(d, eU);
        const double b = dot(d, eV);
        pu[i] = a; pv[i] = b;
        aMin = std::min(aMin, a); aMax = std::max(aMax, a);
        bMin = std::min(bMin, b); bMax = std::max(bMax, b);
    }
    const double aSpan = aMax - aMin, bSpan = bMax - bMin;
    if (aSpan <= 1e-15 || bSpan <= 1e-15) {
        R.reason = "degenerate projected extent (cloud not 2D over its base plane)";
        return R;
    }
    std::vector<double> U(N), V(N);
    for (std::size_t i = 0; i < N; ++i) {
        U[i] = clamp01((pu[i] - aMin) / aSpan);
        V[i] = clamp01((pv[i] - bMin) / bSpan);
    }

    // --- (b) clamped open-uniform knot vectors ---
    NurbsSurface surf;
    surf.degreeU = opt.degreeU; surf.degreeV = opt.degreeV;
    surf.knotsU = clampedKnots(opt.degreeU, opt.nU);
    surf.knotsV = clampedKnots(opt.degreeV, opt.nV);
    surf.control.assign(opt.nU, std::vector<Vec3>(opt.nV, Vec3{0, 0, 0}));
    surf.weights.assign(opt.nU, std::vector<double>(opt.nV, 1.0));

    const std::size_t nUm1 = opt.nU - 1;
    const std::size_t nVm1 = opt.nV - 1;

    // Refit lambda: solve the normal equations given the current (U,V) params.
    auto refit = [&](const std::vector<double>& Up, const std::vector<double>& Vp) -> bool {
        std::vector<double> NtN(M * M, 0.0);
        std::vector<double> Ntp(M * 3, 0.0);  // 3 RHS packed column-major (x,y,z)

        for (std::size_t i = 0; i < N; ++i) {
            const double u = Up[i], v = Vp[i];
            const std::size_t spanU = brep::findSpan(nUm1, opt.degreeU, u, surf.knotsU);
            const std::size_t spanV = brep::findSpan(nVm1, opt.degreeV, v, surf.knotsV);
            const std::vector<double> Nu = brep::basisFunctions(spanU, u, opt.degreeU, surf.knotsU);
            const std::vector<double> Nv = brep::basisFunctions(spanV, v, opt.degreeV, surf.knotsV);

            // Active control indices + their tensor-product basis values.
            const std::size_t cnt = (opt.degreeU + 1) * (opt.degreeV + 1);
            std::vector<std::size_t> idx(cnt);
            std::vector<double> bas(cnt);
            std::size_t t = 0;
            for (std::size_t a = 0; a <= opt.degreeU; ++a) {
                const std::size_t iu = spanU - opt.degreeU + a;
                for (std::size_t b = 0; b <= opt.degreeV; ++b) {
                    const std::size_t iv = spanV - opt.degreeV + b;
                    idx[t] = iu * opt.nV + iv;        // flattened control index
                    bas[t] = Nu[a] * Nv[b];
                    ++t;
                }
            }
            // Accumulate N^T N (only the active block) and N^T p.
            for (std::size_t r = 0; r < cnt; ++r) {
                const std::size_t kr = idx[r];
                const double br = bas[r];
                Ntp[0 * M + kr] += br * points[i].x;
                Ntp[1 * M + kr] += br * points[i].y;
                Ntp[2 * M + kr] += br * points[i].z;
                for (std::size_t cc = 0; cc < cnt; ++cc) {
                    NtN[kr * M + idx[cc]] += br * bas[cc];
                }
            }
        }
        // Tikhonov diagonal for conditioning (sparse-data safety).
        for (std::size_t k = 0; k < M; ++k) NtN[k * M + k] += opt.lambda;

        std::vector<double> sol;
        if (!solveSPD(NtN, M, Ntp, 3, sol)) return false;
        for (std::size_t iu = 0; iu < opt.nU; ++iu)
            for (std::size_t iv = 0; iv < opt.nV; ++iv) {
                const std::size_t k = iu * opt.nV + iv;
                surf.control[iu][iv] = Vec3{sol[0 * M + k], sol[1 * M + k], sol[2 * M + k]};
            }
        return surf.valid();
    };

    // --- initial fit on the projected parameters ---
    if (!refit(U, V)) { R.reason = "least-squares solve failed (singular system)"; return R; }

    // Track the best surface seen (Chamfer can plateau, not strictly decrease).
    NurbsSurface best = surf;
    double bestChamfer = chamferDistance(points, surf);
    R.chamferHistory.push_back(bestChamfer);
    double prevChamfer = bestChamfer;

    // --- (d) closest-point reparameterization iteration ---
    std::size_t iters = 0;
    for (std::size_t it = 0; it < opt.maxIters; ++it) {
        // Reparameterize each point to its footpoint on the current surface.
        std::vector<double> Un(N), Vn(N);
        for (std::size_t i = 0; i < N; ++i) {
            const Footpoint fp = closestPoint(surf, points[i], 24);
            Un[i] = fp.u; Vn[i] = fp.v;
        }
        if (!refit(Un, Vn)) break;  // keep the last good surface
        U = Un; V = Vn;
        ++iters;

        const double ch = chamferDistance(points, surf);
        R.chamferHistory.push_back(ch);
        if (ch < bestChamfer) { bestChamfer = ch; best = surf; }

        if (prevChamfer - ch < opt.tol) { prevChamfer = ch; break; }
        prevChamfer = ch;
    }

    // --- (e/f) finalize on the best surface; report honest residuals ---
    surf = best;
    R.surface = surf;
    R.iters = iters;
    R.chamfer = bestChamfer;

    // cloud->surface RMS + max (honesty residuals).
    double sumSq = 0.0, mx = 0.0;
    const std::size_t seedN = 24;
    for (const Vec3& p : points) {
        const Footpoint fp = closestPoint(surf, p, seedN);
        const double d = std::sqrt(std::max(0.0, fp.dist2));
        sumSq += d * d;
        mx = std::max(mx, d);
    }
    R.rms = std::sqrt(sumSq / static_cast<double>(N));
    R.maxDist = mx;
    R.ok = true;
    R.reason = "ok: single NURBS patch over a base-plane parameterization "
               "(trimming / multi-patch are follow-ups)";
    return R;
}

}  // namespace surfit
}  // namespace native
}  // namespace forge
