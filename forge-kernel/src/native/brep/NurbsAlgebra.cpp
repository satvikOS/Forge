// forge/native/brep/NurbsAlgebra.cpp
//
// Implementation of the K1.1 NURBS-algebra completion (NurbsAlgebra.hpp).
// Pure C++20, standard library only. No OCCT, no new dependencies, no WASM.
//
// Algorithms re-implemented from the standard mathematical definitions (NOT
// copied source) in Piegl & Tiller "The NURBS Book":
//   * CurveKnotIns          (Alg. A5.1, generalised to r-fold)
//   * RefineKnotVectCurve   (Alg. A5.4)
//   * RemoveCurveKnot       (Alg. A5.8)
//   * DegreeElevateCurve    (Alg. A5.9)
//   * SurfaceKnotIns        (Alg. A5.3, via tensor-product isoline insertion)
//   * DegreeElevateSurface  (Alg. A5.10, via isoline elevation)
//   * Isocurve extraction   (§4.5, basis contraction)
//   * Surface fundamental forms / Gauss-mean-principal curvature (§3 classical
//     differential geometry, built on surfaceDerivatives)
//   * Point inversion / projection (Alg. 6.1 spirit, Newton on the foot-point)
//
// REUSE: this file #includes Nurbs.hpp / NurbsCalculus.hpp and calls findSpan(),
// curveDerivatives(), surfaceDerivatives(). It does NOT re-implement the
// Cox-de Boor basis recurrence or the rational derivative machinery.

#include "forge/native/brep/NurbsAlgebra.hpp"

#include "forge/native/brep/Nurbs.hpp"
#include "forge/native/brep/NurbsCalculus.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// ----- homogeneous 4-vector helpers (local to this TU) ----------------------
struct Vec4 { double x = 0, y = 0, z = 0, w = 0; };

inline Vec4 weighted(const Vec3& p, double w) {
    return Vec4{p.x * w, p.y * w, p.z * w, w};
}
inline Vec4 hadd(const Vec4& a, const Vec4& b) {
    return Vec4{a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w};
}
inline Vec4 hsub(const Vec4& a, const Vec4& b) {
    return Vec4{a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w};
}
inline Vec4 hscale(const Vec4& a, double s) {
    return Vec4{a.x * s, a.y * s, a.z * s, a.w * s};
}
inline double hdist(const Vec4& a, const Vec4& b) {
    const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, dw = a.w - b.w;
    return std::sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
}

// ----- Euclidean Vec3 helpers ----------------------------------------------
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

// Existing multiplicity of value `u` in a knot vector.
std::size_t knotMultiplicity(const std::vector<double>& U, double u) {
    std::size_t s = 0;
    for (double k : U) if (k == u) ++s;
    return s;
}

// Build a NurbsCurve back from homogeneous control points + knot vector.
NurbsCurve fromHomogeneous(std::size_t degree,
                           const std::vector<Vec4>& Pw,
                           const std::vector<double>& U) {
    NurbsCurve c;
    c.degree = degree;
    c.knots = U;
    c.controlPoints.resize(Pw.size());
    c.weights.resize(Pw.size());
    for (std::size_t i = 0; i < Pw.size(); ++i) {
        const double w = Pw[i].w;
        // For a valid NURBS the weight stays strictly positive under the affine
        // (convex-combination) operations used here.
        const double iw = (w != 0.0) ? 1.0 / w : 0.0;
        c.controlPoints[i] = Vec3{Pw[i].x * iw, Pw[i].y * iw, Pw[i].z * iw};
        c.weights[i] = w;
    }
    return c;
}

// Homogeneous control points of a curve.
std::vector<Vec4> homogeneous(const NurbsCurve& c) {
    std::vector<Vec4> Pw(c.controlPoints.size());
    for (std::size_t i = 0; i < Pw.size(); ++i)
        Pw[i] = weighted(c.controlPoints[i], c.weights[i]);
    return Pw;
}

// ---------------------------------------------------------------------------
// Core r-fold knot insertion on HOMOGENEOUS control points (Alg. A5.1).
// Returns the new homogeneous control points and writes the new knot vector to
// `UQ`. `k` is the span (knots[k] <= u < knots[k+1]); `s` is the existing
// multiplicity; `r` is the number of insertions; p the degree.
// ---------------------------------------------------------------------------
std::vector<Vec4> curveKnotInsHomog(const std::vector<double>& UP,
                                    const std::vector<Vec4>& Pw,
                                    std::size_t p, double u,
                                    std::size_t k, std::size_t s,
                                    std::size_t r,
                                    std::vector<double>& UQ) {
    const std::size_t np = Pw.size();          // = n + 1
    const std::size_t n = np - 1;
    const std::size_t mp = UP.size();          // = m + 1
    const std::size_t m = mp - 1;

    // New knot vector (size + r): copy [0..k], r copies of u, then [k+1..m].
    UQ.assign(mp + r, 0.0);
    for (std::size_t i = 0; i <= k; ++i) UQ[i] = UP[i];
    for (std::size_t i = 1; i <= r; ++i) UQ[k + i] = u;
    for (std::size_t i = k + 1; i <= m; ++i) UQ[i + r] = UP[i];

    std::vector<Vec4> Qw(np + r);
    // Unchanged leading control points.
    for (std::size_t i = 0; i <= k - p; ++i) Qw[i] = Pw[i];
    // Unchanged trailing control points.
    for (std::size_t i = k - s; i <= n; ++i) Qw[i + r] = Pw[i];

    // Auxiliary R: the working window P[k-p .. k-s].
    std::vector<Vec4> R(p - s + 1);
    for (std::size_t i = 0; i <= p - s; ++i) R[i] = Pw[k - p + i];

    // Insert u r times (Alg. A5.1 main loops).
    std::size_t L = 0;
    for (std::size_t j = 1; j <= r; ++j) {
        L = k - p + j;
        const std::size_t lim = p - j - s;  // (p - s) - j  ... loop count
        for (std::size_t i = 0; i <= lim; ++i) {
            const double lo = UP[L + i];
            const double hi = UP[i + k + 1];
            const double denom = hi - lo;
            const double alpha = (denom != 0.0) ? (u - lo) / denom : 0.0;
            R[i] = hadd(hscale(R[i], 1.0 - alpha), hscale(R[i + 1], alpha));
        }
        Qw[L] = R[0];
        Qw[k + r - j - s] = R[p - j - s];
    }
    // Load remaining (middle) control points.
    for (std::size_t i = L + 1; i < k - s; ++i) Qw[i] = R[i - L];

    return Qw;
}

} // namespace

// ===========================================================================
// insertKnotR — r-fold knot insertion (Alg. A5.1).
// ===========================================================================
NurbsCurve insertKnotR(const NurbsCurve& curve, double u, std::size_t r) {
    if (r == 0) return curve;
    const std::size_t p = curve.degree;
    const std::size_t n = curve.controlPoints.size() - 1;
    const std::size_t s = knotMultiplicity(curve.knots, u);
    // The standard algorithm requires s + r <= p (else a knot would exceed the
    // degree multiplicity and split the curve). Honestly clamp r to that bound.
    const std::size_t rmax = (p > s) ? (p - s) : 0;
    const std::size_t rr = std::min(r, rmax);
    if (rr == 0) return curve;

    const std::size_t k = findSpan(n, p, u, curve.knots);
    std::vector<Vec4> Pw = homogeneous(curve);
    std::vector<double> UQ;
    std::vector<Vec4> Qw = curveKnotInsHomog(curve.knots, Pw, p, u, k, s, rr, UQ);
    return fromHomogeneous(p, Qw, UQ);
}

// ===========================================================================
// refineKnotVector — RefineKnotVectCurve (Alg. A5.4).
// ===========================================================================
NurbsCurve refineKnotVector(const NurbsCurve& curve,
                            const std::vector<double>& Xin) {
    if (Xin.empty()) return curve;
    std::vector<double> X = Xin;
    std::sort(X.begin(), X.end());

    const std::size_t p = curve.degree;
    const std::size_t n = curve.controlPoints.size() - 1;   // last cp index
    const std::size_t m = n + p + 1;                        // last knot index
    const std::size_t r = X.size() - 1;                     // last X index

    const std::vector<double>& U = curve.knots;
    const std::vector<Vec4> Pw = homogeneous(curve);

    std::vector<double> Ubar(m + r + 2, 0.0);
    std::vector<Vec4> Qw(n + r + 2, Vec4{});

    const std::size_t a = findSpan(n, p, X[0], U);
    const std::size_t b = findSpan(n, p, X[r], U) + 1;

    for (std::size_t j = 0; j <= a - p; ++j) Qw[j] = Pw[j];
    for (std::size_t j = b - 1; j <= n; ++j) Qw[j + r + 1] = Pw[j];

    for (std::size_t j = 0; j <= a; ++j) Ubar[j] = U[j];
    for (std::size_t j = b + p; j <= m; ++j) Ubar[j + r + 1] = U[j];

    // i,k indices walk down; use signed arithmetic to avoid size_t underflow.
    long i = static_cast<long>(b + p - 1);
    long k = static_cast<long>(b + p + r);
    for (long j = static_cast<long>(r); j >= 0; --j) {
        while (X[static_cast<std::size_t>(j)] <= U[static_cast<std::size_t>(i)] &&
               i > static_cast<long>(a)) {
            Qw[static_cast<std::size_t>(k - p - 1)] =
                Pw[static_cast<std::size_t>(i - p - 1)];
            Ubar[static_cast<std::size_t>(k)] = U[static_cast<std::size_t>(i)];
            --k;
            --i;
        }
        Qw[static_cast<std::size_t>(k - p - 1)] =
            Qw[static_cast<std::size_t>(k - p)];
        for (long l = 1; l <= static_cast<long>(p); ++l) {
            const std::size_t ind = static_cast<std::size_t>(k - p + l);
            double alpha = Ubar[static_cast<std::size_t>(k + l)] -
                           X[static_cast<std::size_t>(j)];
            if (std::fabs(alpha) == 0.0) {
                Qw[ind - 1] = Qw[ind];
            } else {
                alpha /= (Ubar[static_cast<std::size_t>(k + l)] -
                          U[static_cast<std::size_t>(i - p + l)]);
                Qw[ind - 1] = hadd(hscale(Qw[ind - 1], alpha),
                                   hscale(Qw[ind], 1.0 - alpha));
            }
        }
        Ubar[static_cast<std::size_t>(k)] = X[static_cast<std::size_t>(j)];
        --k;
    }
    return fromHomogeneous(p, Qw, Ubar);
}

// ===========================================================================
// removeKnot — RemoveCurveKnot (Alg. A5.8). Removes value u up to `num` times,
// only when geometrically exact within tol.
// ===========================================================================
NurbsCurve removeKnot(const NurbsCurve& curve, double u, std::size_t num,
                      double tol, std::size_t& removed) {
    removed = 0;
    const std::size_t p = curve.degree;
    const std::size_t n = curve.controlPoints.size() - 1;
    const std::size_t m = n + p + 1;

    // Locate the LAST index r with U[r] == u and its multiplicity s.
    const std::vector<double>& U = curve.knots;
    const std::size_t s = knotMultiplicity(U, u);
    if (s == 0) return curve;  // not present — nothing to remove
    std::size_t rIdx = 0;
    for (std::size_t i = 0; i <= m; ++i) if (U[i] == u) rIdx = i;  // last occ.
    const std::size_t r = rIdx;
    // Interior knot only (the clamp knots cannot be removed below order).
    if (r < p + 1 || r > m - p - 1) return curve;

    // Working copies. P&T A5.8 mutates Pw/U in place per successful pass.
    std::vector<Vec4> Pw = homogeneous(curve);   // size n+1
    std::vector<double> Uw = U;                   // size m+1

    const long ord = static_cast<long>(p) + 1;
    const std::size_t fout = (2 * r - s - p) / 2;       // first control pt out
    long first = static_cast<long>(r) - static_cast<long>(p);
    long last  = static_cast<long>(r) - static_cast<long>(s);

    std::vector<Vec4> temp(2 * p + 1, Vec4{});

    long t = 0;
    const long numL = static_cast<long>(num);
    for (; t < numL; ++t) {
        // Compute the new control points for one removal pass (A5.8). Signed
        // indices throughout (the i>j termination needs signed comparison).
        const long off = first - 1;            // diff in index between temp & P
        temp[0] = Pw[static_cast<std::size_t>(off)];
        temp[static_cast<std::size_t>(last + 1 - off)] =
            Pw[static_cast<std::size_t>(last + 1)];
        long i = first, j = last;
        long ii = 1, jj = last - off;
        bool remflag = false;
        while (j - i > t) {
            const double alfi = (u - Uw[static_cast<std::size_t>(i)]) /
                (Uw[static_cast<std::size_t>(i + ord + t)] -
                 Uw[static_cast<std::size_t>(i)]);
            const double alfj = (u - Uw[static_cast<std::size_t>(j - t)]) /
                (Uw[static_cast<std::size_t>(j + ord)] -
                 Uw[static_cast<std::size_t>(j - t)]);
            temp[static_cast<std::size_t>(ii)] = hscale(
                hsub(Pw[static_cast<std::size_t>(i)],
                     hscale(temp[static_cast<std::size_t>(ii - 1)], 1.0 - alfi)),
                1.0 / alfi);
            temp[static_cast<std::size_t>(jj)] = hscale(
                hsub(Pw[static_cast<std::size_t>(j)],
                     hscale(temp[static_cast<std::size_t>(jj + 1)], alfj)),
                1.0 / (1.0 - alfj));
            ++i; ++ii;
            --j; --jj;
        }
        // Check whether the knot is removable on this pass.
        if (j - i < t) {
            remflag = (hdist(temp[static_cast<std::size_t>(ii - 1)],
                             temp[static_cast<std::size_t>(jj + 1)]) <= tol);
        } else {
            const double alfi = (u - Uw[static_cast<std::size_t>(i)]) /
                (Uw[static_cast<std::size_t>(i + ord + t)] -
                 Uw[static_cast<std::size_t>(i)]);
            const Vec4 cand = hadd(
                hscale(temp[static_cast<std::size_t>(ii + t + 1)], alfi),
                hscale(temp[static_cast<std::size_t>(ii - 1)], 1.0 - alfi));
            remflag = (hdist(Pw[static_cast<std::size_t>(i)], cand) <= tol);
        }
        if (!remflag) break;  // not exactly removable -> stop honestly

        // Successful: write the recomputed control points back into Pw.
        i = first; j = last;
        while (j - i > t) {
            Pw[static_cast<std::size_t>(i)] =
                temp[static_cast<std::size_t>(i - off)];
            Pw[static_cast<std::size_t>(j)] =
                temp[static_cast<std::size_t>(j - off)];
            ++i; --j;
        }
        ++removed;
        // Move the affected window outward for the next removal of the same knot.
        --first; ++last;
    }

    if (removed == 0) return curve;

    // Shift the knot vector down by `removed` (drop them at index r).
    std::vector<double> Unew(Uw.size() - removed);
    for (std::size_t k = 0; k <= r - removed; ++k) Unew[k] = Uw[k];
    for (std::size_t k = r + 1; k <= m; ++k) Unew[k - removed] = Uw[k];

    // Compact the control points: close the `removed`-sized hole (A5.8 tail).
    // j = fout, i = fout; for the surviving points, shift inward.
    std::size_t jj = fout, ii = fout;
    for (std::size_t k = 1; k < removed; ++k) {
        if (k % 2 == 1) ++ii; else --jj;
    }
    std::vector<Vec4> Pnew = Pw;
    for (std::size_t k = ii + 1; k <= n; ++k) {
        Pnew[jj] = Pw[k];
        ++jj;
    }
    Pnew.resize((n + 1) - removed);

    return fromHomogeneous(p, Pnew, Unew);
}

// ===========================================================================
// elevateDegree — DegreeElevateCurve (Alg. A5.9).
//
// Implemented robustly: extract the curve's Bezier segments (via knot insertion
// to full interior multiplicity p), degree-elevate each Bezier segment by t
// using the exact binomial formula, then remove the now-redundant interior
// knots. This is the standard, numerically-clean route and is rational-exact on
// homogeneous control points.
// ===========================================================================
NurbsCurve elevateDegree(const NurbsCurve& curve, std::size_t t) {
    if (t == 0) return curve;
    const std::size_t p = curve.degree;

    // 1. Saturate all DISTINCT interior knots to multiplicity p so the curve
    //    decomposes into independent Bezier segments.
    NurbsCurve c = curve;
    {
        // Collect distinct interior knot values.
        std::vector<double> interior;
        const std::size_t m = c.knots.size() - 1;
        for (std::size_t i = p + 1; i + 1 + p <= m; ++i) {
            double v = c.knots[i];
            if (v > c.knots[p] && v < c.knots[m - p]) {
                if (interior.empty() || interior.back() != v) {
                    if (std::find(interior.begin(), interior.end(), v) ==
                        interior.end())
                        interior.push_back(v);
                }
            }
        }
        for (double v : interior) {
            std::size_t s = knotMultiplicity(c.knots, v);
            if (p > s) c = insertKnotR(c, v, p - s);
        }
    }

    // 2. Now c is a sequence of Bezier segments of degree p. Elevate each to
    //    degree p+t with the Bezier degree-elevation formula on homogeneous
    //    control points, sharing the segment-boundary control points.
    const std::size_t pe = p + t;
    std::vector<Vec4> Pw = homogeneous(c);
    const std::vector<double>& U = c.knots;

    // Distinct breakpoints (segment boundaries) in parameter order.
    std::vector<double> brk;
    for (std::size_t i = 0; i < U.size(); ++i) {
        if (brk.empty() || U[i] != brk.back()) brk.push_back(U[i]);
    }
    const std::size_t nSeg = brk.size() - 1;

    // Bezier degree-elevation coefficients: for raising p -> p+t,
    //   Q[j] = sum_{i=max(0,j-t)}^{min(p,j)} C(p,i)C(t,j-i)/C(p+t,j) * P[i].
    auto binom = [](std::size_t a, std::size_t b) -> double {
        if (b > a) return 0.0;
        double r = 1.0;
        for (std::size_t i = 0; i < b; ++i)
            r = r * static_cast<double>(a - i) / static_cast<double>(i + 1);
        return r;
    };

    std::vector<Vec4> outPw;
    std::vector<double> outU;
    // Leading clamp of the new knot vector.
    for (std::size_t i = 0; i <= pe; ++i) outU.push_back(brk.front());

    for (std::size_t seg = 0; seg < nSeg; ++seg) {
        // The p+1 Bezier control points of this segment are
        //   Pw[seg*p + 0 .. seg*p + p].
        const std::size_t base = seg * p;
        std::vector<Vec4> seg_in(p + 1);
        for (std::size_t i = 0; i <= p; ++i) seg_in[i] = Pw[base + i];

        std::vector<Vec4> seg_out(pe + 1, Vec4{});
        for (std::size_t j = 0; j <= pe; ++j) {
            Vec4 acc{};
            const std::size_t i0 = (j > t) ? (j - t) : 0;
            const std::size_t i1 = std::min(p, j);
            for (std::size_t i = i0; i <= i1; ++i) {
                const double coef = binom(p, i) * binom(t, j - i) /
                                    binom(pe, j);
                acc = hadd(acc, hscale(seg_in[i], coef));
            }
            seg_out[j] = acc;
        }

        // Append: first segment contributes all pe+1 points; later segments
        // skip the shared boundary point (index 0 == previous index pe).
        const std::size_t start = (seg == 0) ? 0 : 1;
        for (std::size_t j = start; j <= pe; ++j) outPw.push_back(seg_out[j]);

        // Interior breakpoint knots at multiplicity pe (except after last seg).
        if (seg + 1 < nSeg) {
            for (std::size_t i = 0; i < pe; ++i) outU.push_back(brk[seg + 1]);
        }
    }
    // Trailing clamp.
    for (std::size_t i = 0; i <= pe; ++i) outU.push_back(brk.back());

    NurbsCurve elevated = fromHomogeneous(pe, outPw, outU);

    // 3. Remove the interior knots that were only needed for the Bezier
    //    decomposition, down to the original surface continuity. This is
    //    optional for geometry (the saturated form is the SAME curve), so we
    //    attempt removal but never corrupt: removeKnot is exact-or-skip.
    for (std::size_t b = 1; b + 1 < brk.size(); ++b) {
        std::size_t rem = 0;
        // Try to bring interior multiplicity from pe down toward p+? — the
        // maximally-removable count keeps the curve identical. Attempt up to t
        // removals (the elevation preserves continuity class).
        NurbsCurve tryC = removeKnot(elevated, brk[b], t, 1e-9, rem);
        if (rem > 0) elevated = tryC;
    }
    return elevated;
}

// ===========================================================================
// Surface knot insertion (single) via tensor-product isoline insertion.
// ===========================================================================
NurbsSurface insertSurfaceKnot(const NurbsSurface& surf, bool dirU, double val) {
    NurbsSurface out;
    if (dirU) {
        // Insert into U: for each V column j, treat the column
        //   { control[i][j], i=0..nU-1 } as a degree-U curve and insert `val`.
        const std::size_t nU = surf.control.size();
        const std::size_t nV = surf.control[0].size();
        // Build one representative column curve to get the new knotsU + sizing.
        std::vector<std::vector<Vec3>> newCtrl;  // [nU+1][nV]
        std::vector<std::vector<double>> newW;
        std::vector<double> newKnotsU;
        // Per-column insertion.
        std::vector<NurbsCurve> cols(nV);
        for (std::size_t j = 0; j < nV; ++j) {
            NurbsCurve c;
            c.degree = surf.degreeU;
            c.knots = surf.knotsU;
            c.controlPoints.resize(nU);
            c.weights.resize(nU);
            for (std::size_t i = 0; i < nU; ++i) {
                c.controlPoints[i] = surf.control[i][j];
                c.weights[i] = surf.weights[i][j];
            }
            cols[j] = insertKnotR(c, val, 1);
        }
        newKnotsU = cols[0].knots;
        const std::size_t nUnew = cols[0].controlPoints.size();
        newCtrl.assign(nUnew, std::vector<Vec3>(nV));
        newW.assign(nUnew, std::vector<double>(nV));
        for (std::size_t j = 0; j < nV; ++j)
            for (std::size_t i = 0; i < nUnew; ++i) {
                newCtrl[i][j] = cols[j].controlPoints[i];
                newW[i][j] = cols[j].weights[i];
            }
        out.degreeU = surf.degreeU;
        out.degreeV = surf.degreeV;
        out.control = std::move(newCtrl);
        out.weights = std::move(newW);
        out.knotsU = std::move(newKnotsU);
        out.knotsV = surf.knotsV;
    } else {
        // Insert into V: per-row insertion.
        const std::size_t nU = surf.control.size();
        const std::size_t nV = surf.control[0].size();
        std::vector<NurbsCurve> rows(nU);
        for (std::size_t i = 0; i < nU; ++i) {
            NurbsCurve c;
            c.degree = surf.degreeV;
            c.knots = surf.knotsV;
            c.controlPoints = surf.control[i];
            c.weights = surf.weights[i];
            rows[i] = insertKnotR(c, val, 1);
        }
        const std::size_t nVnew = rows[0].controlPoints.size();
        out.degreeU = surf.degreeU;
        out.degreeV = surf.degreeV;
        out.control.assign(nU, std::vector<Vec3>(nVnew));
        out.weights.assign(nU, std::vector<double>(nVnew));
        for (std::size_t i = 0; i < nU; ++i) {
            out.control[i] = rows[i].controlPoints;
            out.weights[i] = rows[i].weights;
        }
        out.knotsU = surf.knotsU;
        out.knotsV = rows[0].knots;
    }
    return out;
}

// ===========================================================================
// Surface degree elevation (direction-wise) via isoline elevation.
// ===========================================================================
NurbsSurface elevateSurfaceDegree(const NurbsSurface& surf, bool dirU,
                                  std::size_t t) {
    if (t == 0) return surf;
    NurbsSurface out;
    if (dirU) {
        const std::size_t nU = surf.control.size();
        const std::size_t nV = surf.control[0].size();
        std::vector<NurbsCurve> cols(nV);
        for (std::size_t j = 0; j < nV; ++j) {
            NurbsCurve c;
            c.degree = surf.degreeU;
            c.knots = surf.knotsU;
            c.controlPoints.resize(nU);
            c.weights.resize(nU);
            for (std::size_t i = 0; i < nU; ++i) {
                c.controlPoints[i] = surf.control[i][j];
                c.weights[i] = surf.weights[i][j];
            }
            cols[j] = elevateDegree(c, t);
        }
        const std::size_t nUnew = cols[0].controlPoints.size();
        out.degreeU = surf.degreeU + t;
        out.degreeV = surf.degreeV;
        out.control.assign(nUnew, std::vector<Vec3>(nV));
        out.weights.assign(nUnew, std::vector<double>(nV));
        for (std::size_t j = 0; j < nV; ++j)
            for (std::size_t i = 0; i < nUnew; ++i) {
                out.control[i][j] = cols[j].controlPoints[i];
                out.weights[i][j] = cols[j].weights[i];
            }
        out.knotsU = cols[0].knots;
        out.knotsV = surf.knotsV;
    } else {
        const std::size_t nU = surf.control.size();
        std::vector<NurbsCurve> rows(nU);
        for (std::size_t i = 0; i < nU; ++i) {
            NurbsCurve c;
            c.degree = surf.degreeV;
            c.knots = surf.knotsV;
            c.controlPoints = surf.control[i];
            c.weights = surf.weights[i];
            rows[i] = elevateDegree(c, t);
        }
        const std::size_t nVnew = rows[0].controlPoints.size();
        out.degreeU = surf.degreeU;
        out.degreeV = surf.degreeV + t;
        out.control.assign(nU, std::vector<Vec3>(nVnew));
        out.weights.assign(nU, std::vector<double>(nVnew));
        for (std::size_t i = 0; i < nU; ++i) {
            out.control[i] = rows[i].controlPoints;
            out.weights[i] = rows[i].weights;
        }
        out.knotsU = surf.knotsU;
        out.knotsV = rows[0].knots;
    }
    return out;
}

// ===========================================================================
// Isocurve extraction (§4.5).
//
// Fix u: the surface point is S(u,v) = sum_j ( sum_i N_i(u) w_ij P_ij ) ... /
// denom. Contracting the U direction at fixed u gives a curve in V whose
// rational control points are the U-weighted combinations of the surface net.
// We build them on HOMOGENEOUS control points so the rational case is exact.
// ===========================================================================
NurbsCurve isoCurveU(const NurbsSurface& surf, double u) {
    const std::size_t pu = surf.degreeU;
    const std::size_t nU = surf.control.size();
    const std::size_t nV = surf.control[0].size();
    const std::size_t spanU = findSpan(nU - 1, pu, u, surf.knotsU);
    const std::vector<double> Nu = basisFunctions(spanU, u, pu, surf.knotsU);

    NurbsCurve c;
    c.degree = surf.degreeV;
    c.knots = surf.knotsV;
    c.controlPoints.resize(nV);
    c.weights.resize(nV);
    for (std::size_t j = 0; j < nV; ++j) {
        Vec4 acc{};
        for (std::size_t a = 0; a <= pu; ++a) {
            const std::size_t iu = spanU - pu + a;
            acc = hadd(acc, hscale(weighted(surf.control[iu][j],
                                            surf.weights[iu][j]), Nu[a]));
        }
        const double w = acc.w;
        const double iw = (w != 0.0) ? 1.0 / w : 0.0;
        c.controlPoints[j] = Vec3{acc.x * iw, acc.y * iw, acc.z * iw};
        c.weights[j] = w;
    }
    return c;
}

NurbsCurve isoCurveV(const NurbsSurface& surf, double v) {
    const std::size_t pv = surf.degreeV;
    const std::size_t nU = surf.control.size();
    const std::size_t nV = surf.control[0].size();
    const std::size_t spanV = findSpan(nV - 1, pv, v, surf.knotsV);
    const std::vector<double> Nv = basisFunctions(spanV, v, pv, surf.knotsV);

    NurbsCurve c;
    c.degree = surf.degreeU;
    c.knots = surf.knotsU;
    c.controlPoints.resize(nU);
    c.weights.resize(nU);
    for (std::size_t i = 0; i < nU; ++i) {
        Vec4 acc{};
        for (std::size_t b = 0; b <= pv; ++b) {
            const std::size_t iv = spanV - pv + b;
            acc = hadd(acc, hscale(weighted(surf.control[i][iv],
                                            surf.weights[i][iv]), Nv[b]));
        }
        const double w = acc.w;
        const double iw = (w != 0.0) ? 1.0 / w : 0.0;
        c.controlPoints[i] = Vec3{acc.x * iw, acc.y * iw, acc.z * iw};
        c.weights[i] = w;
    }
    return c;
}

// ===========================================================================
// surfaceCurvature — first + second fundamental form, Gauss/mean/principal.
// ===========================================================================
SurfaceCurvature surfaceCurvature(const NurbsSurface& surf, double u, double v) {
    SurfaceCurvature out;
    const auto D = surfaceDerivatives(surf, u, v, 2);
    const Vec3 Su = D[1][0];
    const Vec3 Sv = D[0][1];
    const Vec3 Suu = D[2][0];
    const Vec3 Suv = D[1][1];
    const Vec3 Svv = D[0][2];

    const Vec3 cr = vcross(Su, Sv);
    const double crLen = vnorm(cr);
    if (crLen <= 1e-300) return out;             // degenerate tangent plane
    const Vec3 n = vscale(cr, 1.0 / crLen);

    // First fundamental form.
    const double E = vdot(Su, Su);
    const double F = vdot(Su, Sv);
    const double G = vdot(Sv, Sv);
    const double det1 = E * G - F * F;           // == crLen^2
    if (std::fabs(det1) <= 1e-300) return out;

    // Second fundamental form.
    const double L = vdot(Suu, n);
    const double M = vdot(Suv, n);
    const double N = vdot(Svv, n);

    out.ok = true;
    out.gaussian = (L * N - M * M) / det1;
    out.mean = (E * N - 2.0 * F * M + G * L) / (2.0 * det1);
    // Principal curvatures are the roots of k^2 - 2H k + K = 0.
    double disc = out.mean * out.mean - out.gaussian;
    if (disc < 0.0) disc = 0.0;                  // clamp tiny negatives (umbilic)
    const double sq = std::sqrt(disc);
    out.k1 = out.mean - sq;                      // smaller root
    out.k2 = out.mean + sq;                      // larger root
    return out;
}

// ===========================================================================
// projectPointToCurve — Newton on f(u) = (C(u)-P).C'(u) = 0.
// ===========================================================================
CurveProjection projectPointToCurve(const NurbsCurve& curve, const Vec3& P,
                                    double tol, std::size_t maxIter) {
    CurveProjection out;
    const std::size_t p = curve.degree;
    const std::size_t n = curve.controlPoints.size() - 1;
    const double u0 = curve.knots[p];
    const double u1 = curve.knots[n + 1];

    // 1. Coarse sweep for the best seed (avoids local minima of the Newton).
    const std::size_t samples = std::max<std::size_t>(50, (n + 1) * 8);
    double bestU = u0, bestD2 = 1e300;
    for (std::size_t i = 0; i <= samples; ++i) {
        const double u = u0 + (u1 - u0) * static_cast<double>(i) /
                                  static_cast<double>(samples);
        const Vec3 c = curve.evaluate(u);
        const Vec3 d = vsub(c, P);
        const double d2 = vdot(d, d);
        if (d2 < bestD2) { bestD2 = d2; bestU = u; }
    }

    // 2. Newton: u_{k+1} = u_k - f(u)/f'(u), f = (C-P).C', f' = |C'|^2+(C-P).C''.
    double u = bestU;
    std::size_t it = 0;
    for (; it < maxIter; ++it) {
        const auto d = curveDerivatives(curve, u, 2);
        const Vec3 r = vsub(d[0], P);            // C(u) - P
        const double f = vdot(r, d[1]);
        const double fp = vdot(d[1], d[1]) + vdot(r, d[2]);
        // Two convergence criteria (P&T 6.4): point coincidence and zero cosine.
        const double rlen = vnorm(r);
        const double c1len = vnorm(d[1]);
        if (rlen <= tol) break;                  // landed on the curve
        if (c1len > 0.0 && std::fabs(f) / (c1len * rlen) <= tol) break;
        if (std::fabs(fp) <= 1e-300) break;      // flat — stop
        double un = u - f / fp;
        if (un < u0) un = u0;                    // clamp to clamped domain
        if (un > u1) un = u1;
        if (std::fabs((un - u) * c1len) <= tol) { u = un; break; }
        u = un;
    }
    out.ok = true;
    out.u = u;
    out.point = curve.evaluate(u);
    out.distance = vnorm(vsub(out.point, P));
    out.iterations = it;
    return out;
}

// ===========================================================================
// projectPointToSurface — 2D Newton on (u,v).
//   f(u,v) = r.S_u = 0,  g(u,v) = r.S_v = 0,  r = S(u,v) - P.
//   Jacobian J = [[ |S_u|^2 + r.S_uu , S_u.S_v + r.S_uv ],
//                 [ S_u.S_v + r.S_uv , |S_v|^2 + r.S_vv ]].
// ===========================================================================
SurfaceProjection projectPointToSurface(const NurbsSurface& surf, const Vec3& P,
                                        double tol, std::size_t maxIter) {
    SurfaceProjection out;
    const std::size_t pu = surf.degreeU, pv = surf.degreeV;
    const std::size_t nU = surf.control.size() - 1;
    const std::size_t nV = surf.control[0].size() - 1;
    const double u0 = surf.knotsU[pu], u1 = surf.knotsU[nU + 1];
    const double v0 = surf.knotsV[pv], v1 = surf.knotsV[nV + 1];

    // 1. Coarse 2D sweep for the seed.
    const std::size_t su = std::max<std::size_t>(24, (nU + 1) * 4);
    const std::size_t sv = std::max<std::size_t>(24, (nV + 1) * 4);
    double bu = u0, bv = v0, bestD2 = 1e300;
    for (std::size_t iu = 0; iu <= su; ++iu) {
        const double u = u0 + (u1 - u0) * static_cast<double>(iu) /
                                  static_cast<double>(su);
        for (std::size_t iv = 0; iv <= sv; ++iv) {
            const double v = v0 + (v1 - v0) * static_cast<double>(iv) /
                                      static_cast<double>(sv);
            const Vec3 s = surf.evaluate(u, v);
            const Vec3 d = vsub(s, P);
            const double d2 = vdot(d, d);
            if (d2 < bestD2) { bestD2 = d2; bu = u; bv = v; }
        }
    }

    // 2. Newton.
    double u = bu, v = bv;
    std::size_t it = 0;
    for (; it < maxIter; ++it) {
        const auto D = surfaceDerivatives(surf, u, v, 2);
        const Vec3 S = D[0][0];
        const Vec3 Su = D[1][0], Sv = D[0][1];
        const Vec3 Suu = D[2][0], Suv = D[1][1], Svv = D[0][2];
        const Vec3 r = vsub(S, P);

        const double rlen = vnorm(r);
        const double f = vdot(r, Su);
        const double g = vdot(r, Sv);
        const double suLen = vnorm(Su), svLen = vnorm(Sv);

        // Convergence: point coincidence OR both cosines ~ 0 (P&T 6.6).
        bool zeroCos =
            (suLen == 0.0 || std::fabs(f) / (suLen * rlen + 1e-300) <= tol) &&
            (svLen == 0.0 || std::fabs(g) / (svLen * rlen + 1e-300) <= tol);
        if (rlen <= tol || zeroCos) break;

        // Jacobian.
        const double j11 = vdot(Su, Su) + vdot(r, Suu);
        const double j12 = vdot(Su, Sv) + vdot(r, Suv);
        const double j22 = vdot(Sv, Sv) + vdot(r, Svv);
        const double det = j11 * j22 - j12 * j12;
        if (std::fabs(det) <= 1e-300) break;
        const double du = -(j22 * f - j12 * g) / det;
        const double dv = -(j11 * g - j12 * f) / det;

        double un = u + du, vn = v + dv;
        if (un < u0) un = u0; if (un > u1) un = u1;
        if (vn < v0) vn = v0; if (vn > v1) vn = v1;

        const double step = std::sqrt((un - u) * (un - u) * vdot(Su, Su) +
                                      (vn - v) * (vn - v) * vdot(Sv, Sv));
        u = un; v = vn;
        if (step <= tol) break;
    }
    out.ok = true;
    out.u = u; out.v = v;
    out.point = surf.evaluate(u, v);
    out.distance = vnorm(vsub(out.point, P));
    out.iterations = it;
    return out;
}

} // namespace brep
} // namespace native
} // namespace forge
