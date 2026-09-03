// forge/native/geom/BSplineBasis.hpp — the four pure-native numerics every
// B-spline fitter in this kernel needs: the knot-span search, the non-zero
// basis functions, and an SPD (Cholesky) factor/solve for the normal equations.
//
// Piegl & Tiller, The NURBS Book: A2.1 (FindSpan), A2.2 (BasisFuns). No OCCT
// type appears in this header, deliberately — it is arithmetic on std::vector
// and nothing else, so it costs no toolkit and can be unit-tested with no kernel.
//
// PROVENANCE, stated because a silent second copy of a validated algorithm is
// how two engines start disagreeing: `src/native/geom/NativeNurbsConvert.cpp`
// carries a private, anonymous-namespace copy of these same four routines
// (lines 132-190 there), written first and validated by that file's own gates.
// The bodies here are transcribed from it unchanged. They were NOT deleted from
// NativeNurbsConvert.cpp by this commit: that translation unit is a validated
// one whose gates are a separate run, and a refactor that destabilises it is not
// part of the pcurve blocker. `test/pcurve_fit_gate.cpp` therefore includes a
// DIFFERENTIAL check — the basis functions here must reproduce the partition of
// unity, the correct support, and a straight line exactly — so that the copy
// cannot drift silently while it exists. Unifying the two is a follow-up and is
// recorded as one in reports/DRAFT_NATIVE_ENGINE.md.

#ifndef FORGE_NATIVE_GEOM_BSPLINEBASIS_HPP
#define FORGE_NATIVE_GEOM_BSPLINEBASIS_HPP

#include <cmath>
#include <vector>

namespace forge {
namespace bsplinebasis {

// P&T A2.1 — knot span index for a clamped knot vector U (last ctrl index n).
inline int findSpan(int n, int p, double u, const std::vector<double>& U) {
    if (u >= U[n + 1]) return n;
    if (u <= U[p]) return p;
    int low = p, high = n + 1, mid = (low + high) / 2;
    while (u < U[mid] || u >= U[mid + 1]) {
        if (u < U[mid]) high = mid; else low = mid;
        mid = (low + high) / 2;
    }
    return mid;
}

// P&T A2.2 — the p+1 nonzero basis functions N[0..p] at u in span i.
inline void basisFuns(int i, double u, int p, const std::vector<double>& U,
                      std::vector<double>& N) {
    N.assign(p + 1, 0.0);
    N[0] = 1.0;
    std::vector<double> left(p + 1, 0.0), right(p + 1, 0.0);
    for (int j = 1; j <= p; ++j) {
        left[j]  = u - U[i + 1 - j];
        right[j] = U[i + j] - u;
        double saved = 0.0;
        for (int r = 0; r < j; ++r) {
            double denom = right[r + 1] + left[j - r];
            double temp  = (denom != 0.0) ? N[r] / denom : 0.0;
            N[r]  = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
}

// Solve the SPD system A x = b (A = m x m, row-major) by Cholesky. The same
// factorisation is reused for every right-hand side. Returns false on a
// non-positive pivot (rank-deficient => the caller must fall back or defer).
inline bool choleskyFactor(std::vector<double>& A, int m) {
    for (int i = 0; i < m; ++i) {
        for (int j = 0; j <= i; ++j) {
            double s = A[i * m + j];
            for (int k = 0; k < j; ++k) s -= A[i * m + k] * A[j * m + k];
            if (i == j) {
                if (s <= 1e-14) return false;
                A[i * m + j] = std::sqrt(s);
            } else {
                A[i * m + j] = s / A[j * m + j];
            }
        }
    }
    return true;
}

inline void choleskySolve(const std::vector<double>& L, int m, std::vector<double>& b) {
    for (int i = 0; i < m; ++i) {              // forward: L y = b
        double s = b[i];
        for (int k = 0; k < i; ++k) s -= L[i * m + k] * b[k];
        b[i] = s / L[i * m + i];
    }
    for (int i = m - 1; i >= 0; --i) {         // back: L^T x = y
        double s = b[i];
        for (int k = i + 1; k < m; ++k) s -= L[k * m + i] * b[k];
        b[i] = s / L[i * m + i];
    }
}

}  // namespace bsplinebasis
}  // namespace forge

#endif  // FORGE_NATIVE_GEOM_BSPLINEBASIS_HPP
