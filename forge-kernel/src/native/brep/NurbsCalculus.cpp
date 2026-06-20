// forge/native/brep/NurbsCalculus.cpp
//
// Implementation of the in-house NURBS calculus + Boehm knot insertion
// (NurbsCalculus.hpp). Pure C++20, standard library only. No OCCT.
//
// Algorithms re-implemented from the standard mathematical definitions (NOT
// copied source): DersBasisFuns (Alg. A2.3), CurveDerivsAlg1 (A3.2),
// RatCurveDerivs (A4.2), SurfaceDerivsAlg1 (A3.6), RatSurfaceDerivs (A4.4) and
// CurveKnotIns (A5.1) in Piegl & Tiller "The NURBS Book".
//
// REUSE: this file #includes forge/native/brep/Nurbs.hpp and calls its
// findSpan() / basisFunctions() and its NurbsCurve/NurbsSurface POD types. It
// does NOT re-implement the Cox-de Boor basis recurrence for the *value*
// (basisFunctions); it extends it to derivatives via the standard A2.3 form,
// which is the derivative of that exact recurrence.

#include "forge/native/brep/NurbsCalculus.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>

namespace forge {
namespace native {
namespace brep {

namespace {

// ----- small homogeneous 4-vector helpers (local to this TU) ---------------
struct Vec4 { double x = 0, y = 0, z = 0, w = 0; };

inline Vec4 weighted(const Vec3& p, double w) {
    return Vec4{p.x * w, p.y * w, p.z * w, w};
}
inline Vec4 scale(const Vec4& a, double s) {
    return Vec4{a.x * s, a.y * s, a.z * s, a.w * s};
}
inline Vec4 add(const Vec4& a, const Vec4& b) {
    return Vec4{a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w};
}
inline Vec3 xyz(const Vec4& a) { return Vec3{a.x, a.y, a.z}; }

inline Vec3 vadd(const Vec3& a, const Vec3& b) {
    return Vec3{a.x + b.x, a.y + b.y, a.z + b.z};
}
inline Vec3 vsub(const Vec3& a, const Vec3& b) {
    return Vec3{a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Vec3 vscale(const Vec3& a, double s) {
    return Vec3{a.x * s, a.y * s, a.z * s};
}
inline double vdot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Vec3 vcross(const Vec3& a, const Vec3& b) {
    return Vec3{a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x};
}
inline double vnorm(const Vec3& a) { return std::sqrt(vdot(a, a)); }

// Binomial coefficients C(n,k) up to a small order, computed once.
inline double binom(std::size_t n, std::size_t k) {
    if (k > n) return 0.0;
    double r = 1.0;
    for (std::size_t i = 0; i < k; ++i) {
        r = r * static_cast<double>(n - i) / static_cast<double>(i + 1);
    }
    return r;
}

} // namespace

// ===========================================================================
// basisFunctionDerivatives — DersBasisFuns (The NURBS Book Alg. A2.3).
//
// Computes ders[k][r] = N^{(k)}_{span-p+r, p}(u) for k in [0, maxDeriv],
// r in [0, p]. ders[0] reproduces the value path (cross-checkable against the
// existing basisFunctions()).
// ===========================================================================
std::vector<std::vector<double>> basisFunctionDerivatives(
    std::size_t span, double u, std::size_t degree, std::size_t maxDeriv,
    const std::vector<double>& knots) {
    const std::size_t p = degree;
    const std::size_t n = maxDeriv;

    // ndu[j][r]: the basis values and knot differences (Alg. A2.3 working table).
    std::vector<std::vector<double>> ndu(p + 1, std::vector<double>(p + 1, 0.0));
    std::vector<double> left(p + 1, 0.0), right(p + 1, 0.0);

    ndu[0][0] = 1.0;
    for (std::size_t j = 1; j <= p; ++j) {
        left[j]  = u - knots[span + 1 - j];
        right[j] = knots[span + j] - u;
        double saved = 0.0;
        for (std::size_t r = 0; r < j; ++r) {
            // Lower triangle: knot differences.
            const double denom = right[r + 1] + left[j - r];
            ndu[j][r] = denom; // store denominator (knot difference)
            const double temp = (denom != 0.0) ? (ndu[r][j - 1] / denom) : 0.0;
            // Upper triangle: basis values.
            ndu[r][j] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        ndu[j][j] = saved;
    }

    std::vector<std::vector<double>> ders(n + 1,
                                          std::vector<double>(p + 1, 0.0));
    // Load the function values (0th derivative).
    for (std::size_t j = 0; j <= p; ++j) ders[0][j] = ndu[j][p];

    // Compute the derivatives (Alg. A2.3, the `a` two-row swap scheme).
    std::vector<std::vector<double>> a(2, std::vector<double>(p + 1, 0.0));
    for (std::size_t r = 0; r <= p; ++r) {
        std::size_t s1 = 0, s2 = 1; // alternate rows of a
        a[0][0] = 1.0;
        for (std::size_t k = 1; k <= n; ++k) {
            double d = 0.0;
            const long rk = static_cast<long>(r) - static_cast<long>(k);
            const long pk = static_cast<long>(p) - static_cast<long>(k);
            if (r >= k) {
                a[s2][0] = a[s1][0] / ndu[static_cast<std::size_t>(pk) + 1][rk];
                d = a[s2][0] * ndu[static_cast<std::size_t>(rk)]
                              [static_cast<std::size_t>(pk)];
            }
            const std::size_t j1 = (rk >= -1) ? 1
                                              : static_cast<std::size_t>(-rk);
            std::size_t j2;
            if (static_cast<long>(r) - 1 <= pk)
                j2 = k - 1;
            else
                j2 = p - r;
            for (std::size_t j = j1; j <= j2; ++j) {
                a[s2][j] = (a[s1][j] - a[s1][j - 1]) /
                           ndu[static_cast<std::size_t>(pk) + 1]
                              [static_cast<std::size_t>(rk) + j];
                d += a[s2][j] * ndu[static_cast<std::size_t>(rk) + j]
                                   [static_cast<std::size_t>(pk)];
            }
            if (r <= static_cast<std::size_t>(pk >= 0 ? pk : -1) &&
                static_cast<long>(r) <= pk) {
                a[s2][k] = -a[s1][k - 1] /
                           ndu[static_cast<std::size_t>(pk) + 1][r];
                d += a[s2][k] * ndu[r][static_cast<std::size_t>(pk)];
            }
            ders[k][r] = d;
            std::swap(s1, s2);
        }
    }

    // Multiply through by the correct factors: prod_{i} (p - i).
    double f = static_cast<double>(p);
    for (std::size_t k = 1; k <= n; ++k) {
        for (std::size_t r = 0; r <= p; ++r) ders[k][r] *= f;
        f *= static_cast<double>(p - k);
    }
    return ders;
}

// ===========================================================================
// curveDerivatives — rational curve derivatives via the Leibniz quotient rule
// (RatCurveDerivs, Alg. A4.2). We first compute the HOMOGENEOUS derivatives
// A^{(k)}(u) (numerator) and w^{(k)}(u) (denominator) from the weighted control
// points (Alg. A3.2 applied to homogeneous points), then
//   C^{(k)} = ( A^{(k)} - sum_{i=1..k} C(k,i) w^{(i)} C^{(k-i)} ) / w.
// ===========================================================================
std::vector<Vec3> curveDerivatives(const NurbsCurve& curve, double u,
                                   std::size_t maxDeriv) {
    assert(curve.valid() && "curveDerivatives on invalid curve");
    const std::size_t p = curve.degree;
    const std::size_t du = std::min(maxDeriv, p); // beyond degree -> zero
    const std::size_t n = curve.controlPoints.size() - 1;
    const std::size_t span = findSpan(n, p, u, curve.knots);
    const auto nders = basisFunctionDerivatives(span, u, p, du, curve.knots);

    // Homogeneous derivatives A^{(k)} (x,y,z numerator) and w^{(k)}.
    std::vector<Vec4> CK(maxDeriv + 1, Vec4{});
    for (std::size_t k = 0; k <= du; ++k) {
        Vec4 acc{};
        for (std::size_t j = 0; j <= p; ++j) {
            const std::size_t idx = span - p + j;
            const Vec4 pw = weighted(curve.controlPoints[idx],
                                     curve.weights[idx]);
            acc = add(acc, scale(pw, nders[k][j]));
        }
        CK[k] = acc;
    }

    // Apply the quotient rule to project back to Euclidean.
    std::vector<Vec3> ck(maxDeriv + 1, Vec3{});
    for (std::size_t k = 0; k <= maxDeriv; ++k) {
        Vec3 v = xyz(CK[k]); // A^{(k)} (numerator only)
        for (std::size_t i = 1; i <= k; ++i) {
            v = vsub(v, vscale(ck[k - i], binom(k, i) * CK[i].w));
        }
        const double w0 = CK[0].w;
        assert(std::fabs(w0) > 0.0 && "degenerate rational weight (w == 0)");
        ck[k] = vscale(v, 1.0 / w0);
    }
    return ck;
}

Vec3 curveTangent(const NurbsCurve& curve, double u) {
    const auto d = curveDerivatives(curve, u, 1);
    const double s = vnorm(d[1]);
    assert(s > 0.0 && "curveTangent: zero first derivative (cusp)");
    return vscale(d[1], 1.0 / s);
}

double curveCurvature(const NurbsCurve& curve, double u) {
    const auto d = curveDerivatives(curve, u, 2);
    const double s = vnorm(d[1]);
    assert(s > 0.0 && "curveCurvature: zero first derivative (cusp)");
    const Vec3 cr = vcross(d[1], d[2]);
    return vnorm(cr) / (s * s * s);
}

// ===========================================================================
// surfaceDerivatives — rational tensor-product surface derivatives
// (RatSurfaceDerivs, Alg. A4.4) built on A3.6 (homogeneous) then the 2D
// Leibniz quotient rule.
// ===========================================================================
std::vector<std::vector<Vec3>> surfaceDerivatives(
    const NurbsSurface& surf, double u, double v, std::size_t maxDeriv) {
    assert(surf.valid() && "surfaceDerivatives on invalid surface");
    const std::size_t pu = surf.degreeU, pv = surf.degreeV;
    const std::size_t du = std::min(maxDeriv, pu);
    const std::size_t dv = std::min(maxDeriv, pv);
    const std::size_t nU = surf.control.size();
    const std::size_t nV = surf.control[0].size();
    const std::size_t spanU = findSpan(nU - 1, pu, u, surf.knotsU);
    const std::size_t spanV = findSpan(nV - 1, pv, v, surf.knotsV);
    const auto nDu = basisFunctionDerivatives(spanU, u, pu, du, surf.knotsU);
    const auto nDv = basisFunctionDerivatives(spanV, v, pv, dv, surf.knotsV);

    // Homogeneous derivatives A^{(k)(l)} for k+l <= maxDeriv.
    std::vector<std::vector<Vec4>> SKL(
        maxDeriv + 1, std::vector<Vec4>(maxDeriv + 1, Vec4{}));
    for (std::size_t k = 0; k <= du; ++k) {
        for (std::size_t l = 0; l <= dv; ++l) {
            if (k + l > maxDeriv) continue;
            Vec4 acc{};
            for (std::size_t a = 0; a <= pu; ++a) {
                const std::size_t iu = spanU - pu + a;
                for (std::size_t b = 0; b <= pv; ++b) {
                    const std::size_t iv = spanV - pv + b;
                    const Vec4 pw = weighted(surf.control[iu][iv],
                                             surf.weights[iu][iv]);
                    acc = add(acc, scale(pw, nDu[k][a] * nDv[l][b]));
                }
            }
            SKL[k][l] = acc;
        }
    }

    // 2D Leibniz quotient rule (Alg. A4.4).
    std::vector<std::vector<Vec3>> skl(
        maxDeriv + 1, std::vector<Vec3>(maxDeriv + 1, Vec3{}));
    const double w0 = SKL[0][0].w;
    assert(std::fabs(w0) > 0.0 && "degenerate rational surface weight");
    for (std::size_t k = 0; k <= maxDeriv; ++k) {
        for (std::size_t l = 0; l + k <= maxDeriv; ++l) {
            Vec3 vv = xyz(SKL[k][l]);
            for (std::size_t j = 1; j <= l; ++j) {
                vv = vsub(vv, vscale(skl[k][l - j], binom(l, j) * SKL[0][j].w));
            }
            for (std::size_t i = 1; i <= k; ++i) {
                vv = vsub(vv, vscale(skl[k - i][l], binom(k, i) * SKL[i][0].w));
                Vec3 v2{};
                for (std::size_t j = 1; j <= l; ++j) {
                    v2 = vadd(v2,
                              vscale(skl[k - i][l - j],
                                     binom(l, j) * SKL[i][j].w));
                }
                vv = vsub(vv, vscale(v2, binom(k, i)));
            }
            skl[k][l] = vscale(vv, 1.0 / w0);
        }
    }
    return skl;
}

Vec3 surfaceNormal(const NurbsSurface& surf, double u, double v) {
    const auto d = surfaceDerivatives(surf, u, v, 1);
    const Vec3 su = d[1][0];
    const Vec3 sv = d[0][1];
    const Vec3 nrm = vcross(su, sv);
    const double s = vnorm(nrm);
    assert(s > 0.0 && "surfaceNormal: degenerate tangent plane");
    return vscale(nrm, 1.0 / s);
}

// ===========================================================================
// insertKnot — Boehm single-knot insertion (CurveKnotIns, Alg. A5.1), rational
// (operates on homogeneous control points so the geometry is unchanged).
// ===========================================================================
NurbsCurve insertKnot(const NurbsCurve& curve, double u) {
    assert(curve.valid() && "insertKnot on invalid curve");
    const std::size_t p = curve.degree;
    const std::size_t np = curve.controlPoints.size(); // = n + 1
    const std::size_t n = np - 1;

    // Locate the span; the new knot will be inserted just after `k`.
    const std::size_t k = findSpan(n, p, u, curve.knots);

    // Existing multiplicity s of u in the knot vector (counting only the value
    // exactly equal to u). For a clean +1 insertion we require s < p.
    std::size_t s = 0;
    for (double kn : curve.knots)
        if (kn == u) ++s;
    assert(s < p && "insertKnot: knot multiplicity would reach the degree");

    // Homogeneous control points of the original curve.
    std::vector<Vec4> Pw(np);
    for (std::size_t i = 0; i < np; ++i)
        Pw[i] = weighted(curve.controlPoints[i], curve.weights[i]);

    // New knot vector (size + 1): insert u after position k.
    std::vector<double> UQ(curve.knots.size() + 1);
    for (std::size_t i = 0; i <= k; ++i) UQ[i] = curve.knots[i];
    UQ[k + 1] = u;
    for (std::size_t i = k + 1; i < curve.knots.size(); ++i)
        UQ[i + 1] = curve.knots[i];

    // New homogeneous control points (size + 1). Standard CurveKnotIns
    // (Alg. A5.1) for a single insertion (r = 1) with existing multiplicity s.
    std::vector<Vec4> Qw(np + 1);
    // Unchanged before the affected window: Q[i] = P[i] for i = 0..k-p.
    for (std::size_t i = 0; i <= k - p; ++i) Qw[i] = Pw[i];
    // Unchanged after the affected window: Q[i+1] = P[i] for i = k-s..n.
    for (std::size_t i = k - s; i <= n; ++i) Qw[i + 1] = Pw[i];

    // Auxiliary: R[i] = P[k-p+i] for i = 0..p-s.
    std::vector<Vec4> R(p - s + 1);
    for (std::size_t i = 0; i <= p - s; ++i) R[i] = Pw[k - p + i];

    // Single insertion (the r=1, j=0 instance of A5.1's save loop).
    // L is the index of the first recomputed control point.
    const std::size_t L = k - p + 1;
    for (std::size_t i = 0; i <= p - s - 1; ++i) {
        // alpha = (u - U[L+i]) / (U[i+k+1] - U[L+i])  (original knot vector).
        const double lo = curve.knots[L + i];
        const double hi = curve.knots[i + k + 1];
        const double denom = hi - lo;
        const double alpha = (denom != 0.0) ? (u - lo) / denom : 0.0;
        R[i] = add(scale(R[i], 1.0 - alpha), scale(R[i + 1], alpha));
    }
    // Place the recomputed window: Q[L+i] = R[i] for the leading points, and
    // the trailing recomputed point closes at Q[k+1-s] (A5.1: Q[k+r-j-s]).
    for (std::size_t i = 0; i <= p - s - 1; ++i) Qw[L + i] = R[i];
    Qw[k + 1 - s] = R[p - s];

    // Project homogeneous control points back to (point, weight).
    NurbsCurve out;
    out.degree = p;
    out.knots = std::move(UQ);
    out.controlPoints.resize(np + 1);
    out.weights.resize(np + 1);
    for (std::size_t i = 0; i < np + 1; ++i) {
        const Vec4& q = Qw[i];
        const double w = q.w;
        assert(std::fabs(w) > 0.0 && "insertKnot: degenerate weight");
        out.controlPoints[i] = Vec3{q.x / w, q.y / w, q.z / w};
        out.weights[i] = w;
    }
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
