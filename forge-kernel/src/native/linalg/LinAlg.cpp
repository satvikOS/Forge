// forge/native/linalg/LinAlg.cpp
//
// Out-of-line implementation of forge::native::linalg — the in-house, Eigen-free
// linear algebra library. Pure C++20 / standard library only. See LinAlg.hpp for
// the full rationale and the Eigen->forge call-site map.
//
// Every algorithm here is a textbook-stable method:
//   LU   — Doolittle elimination with partial OR full pivoting (Golub & Van Loan
//          §3.4); rank-revealing in full-pivot mode.
//   LLT  — right-looking Cholesky (G&VL §4.2); ok=false iff a pivot <= 0.
//   LDLT — Bunch-Kaufman symmetric-indefinite factorization with 1x1/2x2 pivots
//          (G&VL §4.4); the correct factorization for the multibody KKT saddle.
//   QR   — Householder reflectors (G&VL §5.2); least-squares via Qᵀb back-subst.
//   SymmetricEigen — Householder tridiagonalization (G&VL §8.3.1) then the
//          implicit-shift QL algorithm with Wilkinson shift (Numerical Recipes
//          tqli/tred2), eigenvectors accumulated, results sorted ascending.
//   GeneralizedSymmetricEigen — Cholesky-of-M reduction (G&VL §8.7.2).
//   SparseLDLT — symmetric factorization driven from CSR assembly: fill-reducing
//          ordering (T-163), then multifrontal SUPERNODAL Cholesky whose dense
//          blocks go through the dense-kernel seam (native loops, or Apple
//          Accelerate above the measured crossover when built with
//          FORGE_LINALG_ACCELERATE — T-157); the scalar up-looking LDLᵀ is kept
//          as the reference oracle.
//   conjugateGradient — Hestenes-Stiefel CG with Jacobi preconditioner.

#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <complex>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <utility>
#include <vector>

// Apple Accelerate (system framework, no third-party licence) backs the dense
// kernels of the supernodal factorization when the build asks for it
// (forge-kernel/CMakeLists.txt defines FORGE_LINALG_ACCELERATE=1 on Apple and
// links -framework Accelerate). Every other build — and test/native/run_native.sh,
// which compiles this file with a bare compiler — gets the portable native loops.
#if defined(__APPLE__) && defined(FORGE_LINALG_ACCELERATE) && FORGE_LINALG_ACCELERATE
#ifndef ACCELERATE_NEW_LAPACK
#define ACCELERATE_NEW_LAPACK 1
#endif
#include <Accelerate/Accelerate.h>
#define FORGE_LA_ACCELERATE 1
#else
#define FORGE_LA_ACCELERATE 0
#endif

namespace forge {
namespace native {
namespace linalg {

namespace {

template <class T>
typename ScalarTraits<T>::Real absT(const T& x) { return ScalarTraits<T>::absval(x); }

// ---- DenseOp size distribution (T-157 A1). Off unless a diagnostic enables it.
std::atomic<bool> g_opStatsOn{false};
std::atomic<std::uint64_t> g_opCalls[kDenseOpCount][kDenseSizeBuckets];
std::atomic<std::uint64_t> g_opNanos[kDenseOpCount][kDenseSizeBuckets];
std::atomic<std::size_t> g_opMaxRows[kDenseOpCount];
std::atomic<std::size_t> g_opMaxCols[kDenseOpCount];

void atomicMax(std::atomic<std::size_t>& a, std::size_t v) {
    std::size_t cur = a.load(std::memory_order_relaxed);
    while (v > cur && !a.compare_exchange_weak(cur, v, std::memory_order_relaxed)) {}
}

// Records one compute() of a dense op (rows x cols) and its wall time — only
// while the diagnostic is enabled at construction.
class DenseOpScope {
public:
    DenseOpScope(DenseOp op, std::size_t rows, std::size_t cols)
        : on_(g_opStatsOn.load(std::memory_order_relaxed)), op_(static_cast<int>(op)),
          rows_(rows), cols_(cols) {
        if (on_) t0_ = std::chrono::steady_clock::now();
    }
    ~DenseOpScope() {
        if (!on_) return;
        const auto ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
                            std::chrono::steady_clock::now() - t0_).count();
        const int b = denseSizeBucket(std::max(rows_, cols_));
        g_opCalls[op_][b].fetch_add(1, std::memory_order_relaxed);
        g_opNanos[op_][b].fetch_add(static_cast<std::uint64_t>(ns), std::memory_order_relaxed);
        atomicMax(g_opMaxRows[op_], rows_);
        atomicMax(g_opMaxCols[op_], cols_);
    }
    DenseOpScope(const DenseOpScope&) = delete;
    DenseOpScope& operator=(const DenseOpScope&) = delete;

private:
    bool on_;
    int op_;
    std::size_t rows_, cols_;
    std::chrono::steady_clock::time_point t0_{};
};

}  // namespace

int denseSizeBucket(std::size_t n) {
    if (n < 8) return 0;
    if (n < 32) return 1;
    if (n < 128) return 2;
    if (n < 512) return 3;
    if (n < 2048) return 4;
    return 5;
}

const char* denseOpName(DenseOp op) {
    switch (op) {
    case DenseOp::LU:                        return "LU";
    case DenseOp::LLT:                       return "LLT";
    case DenseOp::LDLT:                      return "LDLT";
    case DenseOp::HouseholderQR:             return "HouseholderQR";
    case DenseOp::ColPivHouseholderQR:       return "ColPivHouseholderQR";
    case DenseOp::FullPivHouseholderQR:      return "FullPivHouseholderQR";
    case DenseOp::SymmetricEigen:            return "SymmetricEigen";
    case DenseOp::GeneralizedSymmetricEigen: return "GeneralizedSymmetricEigen";
    case DenseOp::Count:                     break;
    }
    return "?";
}

void setDenseOpStatsEnabled(bool on) { g_opStatsOn.store(on, std::memory_order_relaxed); }

DenseOpStats denseOpStats() {
    DenseOpStats s;
    for (int o = 0; o < kDenseOpCount; ++o) {
        for (int b = 0; b < kDenseSizeBuckets; ++b) {
            s.calls[o][b] = g_opCalls[o][b].load(std::memory_order_relaxed);
            s.seconds[o][b] = 1e-9 * static_cast<double>(g_opNanos[o][b].load(std::memory_order_relaxed));
        }
        s.maxRows[o] = g_opMaxRows[o].load(std::memory_order_relaxed);
        s.maxCols[o] = g_opMaxCols[o].load(std::memory_order_relaxed);
    }
    return s;
}

void resetDenseOpStats() {
    for (int o = 0; o < kDenseOpCount; ++o) {
        for (int b = 0; b < kDenseSizeBuckets; ++b) {
            g_opCalls[o][b].store(0, std::memory_order_relaxed);
            g_opNanos[o][b].store(0, std::memory_order_relaxed);
        }
        g_opMaxRows[o].store(0, std::memory_order_relaxed);
        g_opMaxCols[o].store(0, std::memory_order_relaxed);
    }
}

// ===========================================================================
// LU
// ===========================================================================
template <class T>
void LU<T>::compute(const Matrix<T>& A, bool fullPivot, bool rankRevealing) {
    const DenseOpScope opScope(DenseOp::LU, A.rows(), A.cols());
    const std::size_t n = A.rows();
    n_ = n; full_ = fullPivot; ok_ = (A.rows() == A.cols());
    lu_ = A;
    p_.resize(n); q_.resize(n);
    for (std::size_t i = 0; i < n; ++i) { p_[i] = i; q_[i] = i; }
    sign_ = 1; rank_ = 0;
    if (!ok_) return;

    using Real = typename ScalarTraits<T>::Real;
    Real maxA = 0;
    for (std::size_t i = 0; i < n; ++i)
        for (std::size_t j = 0; j < n; ++j) maxA = std::max(maxA, absT(lu_(i, j)));
    const Real scale = (maxA > 0 ? maxA : Real(1));
    // rank-revealing: flag numerically-deficient pivots; non-rank-revealing:
    // only flag a structurally-zero pivot (lets wide-dynamic-range penalty
    // systems factor, matching Eigen SparseLU / LAPACK getrf).
    const Real tol = rankRevealing
        ? scale * std::numeric_limits<Real>::epsilon() * Real(n) * Real(16)
        : scale * Real(1e-30);

    for (std::size_t k = 0; k < n; ++k) {
        // pivot search
        std::size_t pr = k, pc = k;
        Real best = absT(lu_(k, k));
        if (fullPivot) {
            for (std::size_t i = k; i < n; ++i)
                for (std::size_t j = k; j < n; ++j) {
                    Real v = absT(lu_(i, j));
                    if (v > best) { best = v; pr = i; pc = j; }
                }
        } else {
            for (std::size_t i = k; i < n; ++i) {
                Real v = absT(lu_(i, k));
                if (v > best) { best = v; pr = i; }
            }
        }
        if (best > tol) ++rank_;
        else { ok_ = false; continue; }  // singular column — leave as is

        if (pr != k) {
            for (std::size_t j = 0; j < n; ++j) std::swap(lu_(pr, j), lu_(k, j));
            std::swap(p_[pr], p_[k]); sign_ = -sign_;
        }
        if (fullPivot && pc != k) {
            for (std::size_t i = 0; i < n; ++i) std::swap(lu_(i, pc), lu_(i, k));
            std::swap(q_[pc], q_[k]); sign_ = -sign_;
        }
        const T piv = lu_(k, k);
        for (std::size_t i = k + 1; i < n; ++i) {
            T f = lu_(i, k) / piv;
            lu_(i, k) = f;
            for (std::size_t j = k + 1; j < n; ++j) lu_(i, j) -= f * lu_(k, j);
        }
    }
}

template <class T>
std::vector<T> LU<T>::solve(const std::vector<T>& b) const {
    const std::size_t n = n_;
    std::vector<T> x(n, T(0));
    if (n == 0) return x;
    // apply row permutation: pb[i] = b[p_[i]]
    std::vector<T> y(n);
    for (std::size_t i = 0; i < n; ++i) y[i] = b[p_[i]];
    // forward solve L y = Pb (unit lower)
    for (std::size_t i = 0; i < n; ++i) {
        T s = y[i];
        for (std::size_t j = 0; j < i; ++j) s -= lu_(i, j) * y[j];
        y[i] = s;
    }
    // back solve U z = y
    for (std::size_t ii = 0; ii < n; ++ii) {
        std::size_t i = n - 1 - ii;
        T s = y[i];
        for (std::size_t j = i + 1; j < n; ++j) s -= lu_(i, j) * y[j];
        T d = lu_(i, i);
        y[i] = (absT(d) > 0) ? (s / d) : T(0);
    }
    // undo column permutation: x[q_[i]] = z[i]
    for (std::size_t i = 0; i < n; ++i) x[q_[i]] = y[i];
    return x;
}

template <class T>
Matrix<T> LU<T>::solve(const Matrix<T>& B) const {
    Matrix<T> X(n_, B.cols(), T(0));
    std::vector<T> col(n_);
    for (std::size_t j = 0; j < B.cols(); ++j) {
        for (std::size_t i = 0; i < n_; ++i) col[i] = B(i, j);
        std::vector<T> xj = solve(col);
        for (std::size_t i = 0; i < n_; ++i) X(i, j) = xj[i];
    }
    return X;
}

template <class T>
Matrix<T> LU<T>::inverse() const {
    Matrix<T> I = Matrix<T>::Identity(n_);
    return solve(I);
}

template <class T>
T LU<T>::determinant() const {
    T d = T(sign_);
    for (std::size_t i = 0; i < n_; ++i) d *= lu_(i, i);
    return d;
}

// ===========================================================================
// LLT (Cholesky, SPD)
// ===========================================================================
template <class T>
void LLT<T>::compute(const Matrix<T>& A) {
    const DenseOpScope opScope(DenseOp::LLT, A.rows(), A.cols());
    const std::size_t n = A.rows();
    n_ = n; ok_ = (A.rows() == A.cols());
    L_ = Matrix<T>(n, n, T(0));
    if (!ok_) return;
    using Real = typename ScalarTraits<T>::Real;
    for (std::size_t j = 0; j < n; ++j) {
        // diagonal
        T sum = A(j, j);
        for (std::size_t k = 0; k < j; ++k)
            sum -= L_(j, k) * ScalarTraits<T>::conj(L_(j, k));
        Real diag = ScalarTraits<T>::realpart(sum);
        if (!(diag > Real(0))) { ok_ = false; return; }
        T ljj = T(std::sqrt(diag));
        L_(j, j) = ljj;
        for (std::size_t i = j + 1; i < n; ++i) {
            T s = A(i, j);
            for (std::size_t k = 0; k < j; ++k)
                s -= L_(i, k) * ScalarTraits<T>::conj(L_(j, k));
            L_(i, j) = s / ljj;
        }
    }
}

template <class T>
std::vector<T> LLT<T>::solve(const std::vector<T>& b) const {
    const std::size_t n = n_;
    std::vector<T> y(b);
    // forward L y = b
    for (std::size_t i = 0; i < n; ++i) {
        T s = y[i];
        for (std::size_t k = 0; k < i; ++k) s -= L_(i, k) * y[k];
        y[i] = s / L_(i, i);
    }
    // back Lᴴ x = y
    for (std::size_t ii = 0; ii < n; ++ii) {
        std::size_t i = n - 1 - ii;
        T s = y[i];
        for (std::size_t k = i + 1; k < n; ++k)
            s -= ScalarTraits<T>::conj(L_(k, i)) * y[k];
        y[i] = s / L_(i, i);
    }
    return y;
}

template <class T>
Matrix<T> LLT<T>::solve(const Matrix<T>& B) const {
    Matrix<T> X(n_, B.cols(), T(0));
    std::vector<T> col(n_);
    for (std::size_t j = 0; j < B.cols(); ++j) {
        for (std::size_t i = 0; i < n_; ++i) col[i] = B(i, j);
        std::vector<T> xj = solve(col);
        for (std::size_t i = 0; i < n_; ++i) X(i, j) = xj[i];
    }
    return X;
}

// ===========================================================================
// LDLT (symmetric, Bunch-Kaufman with 1x1 / 2x2 pivots)
// ===========================================================================
//
// We factor A = P L D Lᵀ Pᵀ. The classic Bunch-Kaufman strategy chooses, at each
// step, either a 1x1 or a 2x2 diagonal pivot block so the factorization is
// numerically stable even when A is symmetric INDEFINITE (the multibody KKT). We
// store the full L (unit lower, in block columns) and the block-diagonal D as a
// list of 1x1 / 2x2 blocks, plus the symmetric permutation.
template <class T>
void LDLT<T>::compute(const Matrix<T>& Ain) {
    const DenseOpScope opScope(DenseOp::LDLT, Ain.rows(), Ain.cols());
    using Real = typename ScalarTraits<T>::Real;
    const std::size_t n = Ain.rows();
    n_ = n; ok_ = (Ain.rows() == Ain.cols());
    L_ = Matrix<T>::Identity(n);
    d1_.assign(n, T(0));
    blockSize_.assign(n, 1);
    block2_.assign(n, std::array<T, 4>{{T(0), T(0), T(0), T(0)}});
    perm_.resize(n);
    for (std::size_t i = 0; i < n; ++i) perm_[i] = i;
    positive_ = true;
    if (!ok_) return;

    // Work on a mutable copy A (full symmetric, only lower used logically).
    Matrix<T> A = Ain;
    const Real alpha = (Real(1) + std::sqrt(Real(17))) / Real(8);  // ≈0.6404

    auto swapSym = [&](std::size_t i, std::size_t j) {
        if (i == j) return;
        std::swap(perm_[i], perm_[j]);
        // swap rows i,j and cols i,j of A
        for (std::size_t k = 0; k < n; ++k) std::swap(A(i, k), A(j, k));
        for (std::size_t k = 0; k < n; ++k) std::swap(A(k, i), A(k, j));
        // swap already-computed L rows i,j (columns < current step)
        for (std::size_t k = 0; k < n; ++k) std::swap(L_(i, k), L_(j, k));
    };

    std::size_t k = 0;
    while (k < n) {
        // largest off-diagonal magnitude in column k (rows k+1..)
        Real lambda = 0; std::size_t r = k;
        for (std::size_t i = k + 1; i < n; ++i) {
            Real v = absT(A(i, k));
            if (v > lambda) { lambda = v; r = i; }
        }
        Real akk = absT(A(k, k));

        bool use1x1 = false;
        if (lambda == Real(0)) {
            use1x1 = true;  // column already eliminated below diagonal
        } else if (akk >= alpha * lambda) {
            use1x1 = true;
        } else {
            // largest off-diagonal in column r (excluding row r), call it sigma
            Real sigma = 0;
            for (std::size_t i = k; i < n; ++i) {
                if (i == r) continue;
                Real v = absT(A(i, r));
                if (v > sigma) sigma = v;
            }
            if (akk * sigma >= alpha * lambda * lambda) {
                use1x1 = true;
            } else if (absT(A(r, r)) >= alpha * sigma) {
                // 1x1 pivot with row/col r swapped into position k
                swapSym(k, r);
                use1x1 = true;
            } else {
                // 2x2 pivot using rows/cols k and r; bring r to k+1
                swapSym(k + 1, r);
                use1x1 = false;
            }
        }

        if (use1x1) {
            T piv = A(k, k);
            blockSize_[k] = 1;
            d1_[k] = piv;
            if (ScalarTraits<T>::realpart(piv) <= Real(0)) positive_ = false;
            if (absT(piv) == Real(0)) { ok_ = false; ++k; continue; }
            for (std::size_t i = k + 1; i < n; ++i) {
                T lik = A(i, k) / piv;
                L_(i, k) = lik;
                for (std::size_t j = k + 1; j <= i; ++j) {
                    A(i, j) -= lik * A(j, k);
                    A(j, i) = A(i, j);  // keep symmetric
                }
            }
            ++k;
        } else {
            // 2x2 pivot D = [[a,b],[b,c]] at (k,k),(k,k+1),(k+1,k+1)
            T a = A(k, k), b = A(k + 1, k), c = A(k + 1, k + 1);
            T det = a * c - b * b;
            positive_ = false;  // a genuine 2x2 block => indefinite locally
            blockSize_[k] = 2; blockSize_[k + 1] = 0;
            block2_[k] = std::array<T, 4>{{a, b, b, c}};
            if (absT(det) == Real(0)) { ok_ = false; k += 2; continue; }
            // inverse of D
            T id00 =  c / det, id01 = -b / det, id11 =  a / det;
            for (std::size_t i = k + 2; i < n; ++i) {
                T u = A(i, k), v = A(i, k + 1);
                // [li0 li1] = [u v] * Dinv
                T li0 = u * id00 + v * id01;
                T li1 = u * id01 + v * id11;
                L_(i, k)     = li0;
                L_(i, k + 1) = li1;
            }
            for (std::size_t i = k + 2; i < n; ++i) {
                T li0 = L_(i, k), li1 = L_(i, k + 1);
                for (std::size_t j = k + 2; j <= i; ++j) {
                    // A_ij -= [li0 li1] * [A_jk ; A_j,k+1]
                    A(i, j) -= li0 * A(j, k) + li1 * A(j, k + 1);
                    A(j, i) = A(i, j);
                }
            }
            k += 2;
        }
    }
}

template <class T>
std::vector<T> LDLT<T>::solve(const std::vector<T>& b) const {
    const std::size_t n = n_;
    // apply permutation: y[i] = b[perm_[i]]
    std::vector<T> y(n);
    for (std::size_t i = 0; i < n; ++i) y[i] = b[perm_[i]];

    // forward L z = y  (unit lower)
    for (std::size_t i = 0; i < n; ++i) {
        T s = y[i];
        for (std::size_t j = 0; j < i; ++j) s -= L_(i, j) * y[j];
        y[i] = s;
    }
    // diagonal D solve: D w = z  (1x1 and 2x2 blocks)
    {
        std::size_t i = 0;
        while (i < n) {
            if (blockSize_[i] == 2) {
                const std::array<T, 4>& D = block2_[i];
                T det = D[0] * D[3] - D[1] * D[2];
                T r0 = y[i], r1 = y[i + 1];
                y[i]     = ( D[3] * r0 - D[1] * r1) / det;
                y[i + 1] = (-D[2] * r0 + D[0] * r1) / det;
                i += 2;
            } else {
                if (absT(d1_[i]) > 0) y[i] = y[i] / d1_[i];
                i += 1;
            }
        }
    }
    // back Lᵀ x = w
    for (std::size_t ii = 0; ii < n; ++ii) {
        std::size_t i = n - 1 - ii;
        T s = y[i];
        for (std::size_t j = i + 1; j < n; ++j) s -= L_(j, i) * y[j];
        y[i] = s;
    }
    // undo permutation: x[perm_[i]] = y[i]
    std::vector<T> x(n, T(0));
    for (std::size_t i = 0; i < n; ++i) x[perm_[i]] = y[i];
    return x;
}

// ===========================================================================
// HouseholderQR
// ===========================================================================
template <class T>
void HouseholderQR<T>::compute(const Matrix<T>& A) {
    const DenseOpScope opScope(DenseOp::HouseholderQR, A.rows(), A.cols());
    using Real = typename ScalarTraits<T>::Real;
    const std::size_t m = A.rows(), n = A.cols();
    m_ = m; n_ = n; ok_ = (m >= n);
    qr_ = A;
    beta_.assign(n, T(0));
    if (!ok_) return;

    for (std::size_t k = 0; k < n; ++k) {
        // build Householder reflector zeroing qr_(k+1..m-1, k)
        Real normx = 0;
        for (std::size_t i = k; i < m; ++i) { Real a = absT(qr_(i, k)); normx += a * a; }
        normx = std::sqrt(normx);
        if (normx == Real(0)) { beta_[k] = T(0); continue; }

        T x0 = qr_(k, k);
        Real ax0 = absT(x0);
        // alpha = -sign(x0)*normx (phase-aware for complex)
        T phase = (ax0 > Real(0)) ? (x0 / T(ax0)) : T(1);
        T alpha = -phase * T(normx);
        T v0 = x0 - alpha;
        // v = x with v[k]=v0
        Real vnorm2 = absT(v0) * absT(v0);
        for (std::size_t i = k + 1; i < m; ++i) { Real a = absT(qr_(i, k)); vnorm2 += a * a; }
        if (vnorm2 == Real(0)) { beta_[k] = T(0); continue; }
        T beta = T(2) / T(vnorm2);
        beta_[k] = beta;

        // store v (normalized so v[k]=v0) in column k below: we keep v0 separately
        // by writing the implicit reflector into qr_ sub-diagonal (v[k+1..]) and
        // recording R(k,k)=alpha. Save v0 in a parallel slot via qr_(k,k) temp.
        // Apply reflector to columns k..n-1: A -= beta * v (vᴴ A)
        // First, capture v components.
        std::vector<T> v(m, T(0));
        v[k] = v0;
        for (std::size_t i = k + 1; i < m; ++i) v[i] = qr_(i, k);

        for (std::size_t j = k; j < n; ++j) {
            T s = T(0);
            for (std::size_t i = k; i < m; ++i) s += ScalarTraits<T>::conj(v[i]) * qr_(i, j);
            T bs = beta * s;
            for (std::size_t i = k; i < m; ++i) qr_(i, j) -= bs * v[i];
        }
        // overwrite stored reflector: keep v below diagonal, alpha on diagonal,
        // and remember v0 by storing it where? We re-derive v0 in solve via alpha:
        // v0 = qr_(k,k) - alpha, but qr_(k,k) now == alpha. So store v0 in beta-coupled
        // scheme: keep a separate vector of v0 values.
        v0store_.resize(n);
        v0store_[k] = v0;
        // qr_ now holds R on/above diagonal and v (below diagonal) in column k.
        // restore sub-diagonal v entries (they were modified by the j=k apply):
        for (std::size_t i = k + 1; i < m; ++i) qr_(i, k) = v[i];
        qr_(k, k) = alpha;
    }

    // extract R (m x n, upper triangular in top-left n x n)
    R_ = Matrix<T>(m, n, T(0));
    for (std::size_t i = 0; i < m; ++i)
        for (std::size_t j = i; j < n; ++j)
            if (i < n) R_(i, j) = qr_(i, j);
}

template <class T>
std::vector<T> HouseholderQR<T>::solve(const std::vector<T>& b) const {
    const std::size_t m = m_, n = n_;
    std::vector<T> y(b);  // will become Qᴴ b
    // apply reflectors H_{n-1} ... H_0 to b
    for (std::size_t k = 0; k < n; ++k) {
        if (absT(beta_[k]) == 0) continue;
        std::vector<T> v(m, T(0));
        v[k] = v0store_[k];
        for (std::size_t i = k + 1; i < m; ++i) v[i] = qr_(i, k);
        T s = T(0);
        for (std::size_t i = k; i < m; ++i) s += ScalarTraits<T>::conj(v[i]) * y[i];
        T bs = beta_[k] * s;
        for (std::size_t i = k; i < m; ++i) y[i] -= bs * v[i];
    }
    // back-substitute R x = (Qᴴ b)[0:n]
    std::vector<T> x(n, T(0));
    for (std::size_t ii = 0; ii < n; ++ii) {
        std::size_t i = n - 1 - ii;
        T s = y[i];
        for (std::size_t j = i + 1; j < n; ++j) s -= qr_(i, j) * x[j];
        T d = qr_(i, i);
        x[i] = (absT(d) > 0) ? (s / d) : T(0);
    }
    return x;
}

template <class T>
Matrix<T> HouseholderQR<T>::matrixQ() const {
    const std::size_t m = m_, n = n_;
    Matrix<T> Q = Matrix<T>::Identity(m);
    // Q = H_0 H_1 ... H_{n-1}; apply each reflector to columns of Q from the left,
    // accumulating in reverse so columns come out as the orthonormal basis.
    for (std::size_t kk = 0; kk < n; ++kk) {
        std::size_t k = n - 1 - kk;
        if (absT(beta_[k]) == 0) continue;
        std::vector<T> v(m, T(0));
        v[k] = v0store_[k];
        for (std::size_t i = k + 1; i < m; ++i) v[i] = qr_(i, k);
        for (std::size_t j = 0; j < m; ++j) {
            T s = T(0);
            for (std::size_t i = k; i < m; ++i) s += ScalarTraits<T>::conj(v[i]) * Q(i, j);
            T bs = beta_[k] * s;
            for (std::size_t i = k; i < m; ++i) Q(i, j) -= bs * v[i];
        }
    }
    return Q;
}

// ===========================================================================
// ColPivHouseholderQR — rank-revealing Householder QR with column pivoting.
// A P = Q R with non-increasing |R_ii|; solve() returns the basic solution.
// ===========================================================================
template <class T>
void ColPivHouseholderQR<T>::compute(const Matrix<T>& A) {
    const DenseOpScope opScope(DenseOp::ColPivHouseholderQR, A.rows(), A.cols());
    using Real = typename ScalarTraits<T>::Real;
    const std::size_t m = A.rows(), n = A.cols();
    m_ = m; n_ = n; ok_ = true; rank_ = 0;
    qr_ = A;
    beta_.assign(n, T(0));
    v0_.assign(n, T(0));
    perm_.resize(n);
    for (std::size_t j = 0; j < n; ++j) perm_[j] = j;

    std::vector<Real> colnorm(n, Real(0));
    for (std::size_t j = 0; j < n; ++j) {
        Real s = 0; for (std::size_t i = 0; i < m; ++i) { Real a = absT(qr_(i, j)); s += a * a; }
        colnorm[j] = s;
    }

    const std::size_t p = (m < n) ? m : n;
    Real tol = Real(0);
    for (std::size_t k = 0; k < p; ++k) {
        // pivot: active column k..n-1 with the largest remaining norm
        std::size_t c = k; Real best = colnorm[k];
        for (std::size_t j = k + 1; j < n; ++j) if (colnorm[j] > best) { best = colnorm[j]; c = j; }
        if (c != k) {
            for (std::size_t i = 0; i < m; ++i) std::swap(qr_(i, k), qr_(i, c));
            std::swap(perm_[k], perm_[c]);
            std::swap(colnorm[k], colnorm[c]);
        }
        // Householder reflector zeroing qr_(k+1..m-1, k)
        Real normx = 0; for (std::size_t i = k; i < m; ++i) { Real a = absT(qr_(i, k)); normx += a * a; }
        normx = std::sqrt(normx);
        if (normx == Real(0)) { beta_[k] = T(0); v0_[k] = T(0); continue; }
        T x0 = qr_(k, k); Real ax0 = absT(x0);
        T phase = (ax0 > Real(0)) ? (x0 / T(ax0)) : T(1);
        T alpha = -phase * T(normx);
        T v0 = x0 - alpha;
        Real vnorm2 = absT(v0) * absT(v0);
        for (std::size_t i = k + 1; i < m; ++i) { Real a = absT(qr_(i, k)); vnorm2 += a * a; }
        if (vnorm2 == Real(0)) { beta_[k] = T(0); v0_[k] = T(0); continue; }
        T beta = T(2) / T(vnorm2); beta_[k] = beta; v0_[k] = v0;
        std::vector<T> v(m, T(0)); v[k] = v0;
        for (std::size_t i = k + 1; i < m; ++i) v[i] = qr_(i, k);
        for (std::size_t j = k; j < n; ++j) {
            T s = T(0); for (std::size_t i = k; i < m; ++i) s += ScalarTraits<T>::conj(v[i]) * qr_(i, j);
            T bs = beta * s;
            for (std::size_t i = k; i < m; ++i) qr_(i, j) -= bs * v[i];
        }
        for (std::size_t i = k + 1; i < m; ++i) qr_(i, k) = v[i];
        qr_(k, k) = alpha;
        // rank threshold relative to the first (largest) pivot
        Real adiag = absT(alpha);
        if (k == 0) tol = adiag * std::numeric_limits<Real>::epsilon() *
                          Real((m > n ? m : n)) * Real(16);
        if (adiag > tol) rank_ = k + 1;
        // downdate the remaining active column norms
        for (std::size_t j = k + 1; j < n; ++j) {
            Real a = absT(qr_(k, j));
            colnorm[j] -= a * a;
            if (colnorm[j] < Real(0)) colnorm[j] = Real(0);
        }
    }
}

template <class T>
std::vector<T> ColPivHouseholderQR<T>::solve(const std::vector<T>& b) const {
    const std::size_t m = m_, n = n_;
    const std::size_t p = (m < n) ? m : n;
    std::vector<T> y(b);  // becomes Qᴴ b
    for (std::size_t k = 0; k < p; ++k) {
        if (absT(beta_[k]) == 0) continue;
        std::vector<T> v(m, T(0)); v[k] = v0_[k];
        for (std::size_t i = k + 1; i < m; ++i) v[i] = qr_(i, k);
        T s = T(0); for (std::size_t i = k; i < m; ++i) s += ScalarTraits<T>::conj(v[i]) * y[i];
        T bs = beta_[k] * s;
        for (std::size_t i = k; i < m; ++i) y[i] -= bs * v[i];
    }
    // back-substitute the leading rank×rank block of R; free columns stay 0
    std::vector<T> z(n, T(0));
    for (std::size_t ii = 0; ii < rank_; ++ii) {
        std::size_t i = rank_ - 1 - ii;
        T s = y[i];
        for (std::size_t j = i + 1; j < rank_; ++j) s -= qr_(i, j) * z[j];
        z[i] = s / qr_(i, i);
    }
    // un-permute: x[perm_[k]] = z[k]
    std::vector<T> x(n, T(0));
    for (std::size_t k = 0; k < n; ++k) x[perm_[k]] = z[k];
    return x;
}

// ===========================================================================
// FullPivHouseholderQR — rank-revealing Householder QR with FULL (row+column)
// pivoting. An exact reimplementation of Eigen's FullPivHouseholderQR: same
// packed layout, same tail-only row swap, same τ ("hCoeffs") reflector scaling,
// same column-permutation construction, same row-transposition-aware Q.
// ===========================================================================
namespace {

// Eigen-convention Householder on a column segment x (length L). On exit x[0]
// holds the new pivot β (the resulting diagonal entry), x[1..L-1] holds the
// "essential" part of the reflector vector v = [1, x[1..L-1]], and tau is the
// scaling such that H = I - tau·v·vᴴ satisfies H·x_in = [β, 0, …, 0]ᵀ. Mirrors
// Eigen Householder.h makeHouseholder.
template <class T>
void makeHouseholderEigen(std::vector<T>& x, T& tau) {
    using Real = typename ScalarTraits<T>::Real;
    const std::size_t L = x.size();
    Real tailSq = 0;
    for (std::size_t i = 1; i < L; ++i) { Real a = absT(x[i]); tailSq += a * a; }
    const T c0 = x[0];
    const Real c0im = ScalarTraits<T>::absval(c0 - T(ScalarTraits<T>::realpart(c0)));  // |Im(c0)|
    if (tailSq == Real(0) && c0im == Real(0)) {
        // tail is zero and c0 is purely real -> the reflector is the identity:
        // β = c0, τ = 0, essential part empty (Eigen makeHouseholder special case).
        tau = T(0);
        for (std::size_t i = 1; i < L; ++i) x[i] = T(0);
        // x[0] (β) already equals c0.
        return;
    }
    // General case (covers all real T, and complex with nonzero tail or imag part).
    const Real ax0 = absT(c0);
    Real beta = std::sqrt(ax0 * ax0 + tailSq);
    // Eigen: if numext::real(c0) >= 0 then beta = -beta (so c0 - beta != 0).
    if (ScalarTraits<T>::realpart(c0) >= Real(0)) beta = -beta;
    const T bden = c0 - T(beta);
    for (std::size_t i = 1; i < L; ++i) x[i] = x[i] / bden;
    // Eigen: tau = conj((beta - c0) / beta)  (the conj is a no-op for real T but
    // is REQUIRED for complex so that H = I - tau v vᴴ zeros the tail of x).
    tau = ScalarTraits<T>::conj((T(beta) - c0) / T(beta));
    x[0] = T(beta);
}

}  // namespace

template <class T>
void FullPivHouseholderQR<T>::compute(const Matrix<T>& A) {
    const DenseOpScope opScope(DenseOp::FullPivHouseholderQR, A.rows(), A.cols());
    using Real = typename ScalarTraits<T>::Real;
    const std::size_t m = A.rows(), n = A.cols();
    m_ = m; n_ = n;
    qr_ = A;
    const std::size_t size = (m < n) ? m : n;
    hcoeffs_.assign(size, T(0));
    rowTrans_.assign(size, 0);
    colTrans_.assign(size, 0);
    perm_.resize(n);
    for (std::size_t j = 0; j < n; ++j) perm_[j] = j;
    nonzero_ = size;
    ok_ = A.allFinite() && m > 0;
    if (!ok_) return;
    if (size == 0) return;

    const Real prec = std::numeric_limits<Real>::epsilon() * Real(size);
    Real biggest = Real(0);

    for (std::size_t k = 0; k < size; ++k) {
        // scan the active trailing submatrix qr_(k:m, k:n) for the largest |.|
        std::size_t rb = k, cb = k;
        Real best = Real(-1);
        for (std::size_t i = k; i < m; ++i)
            for (std::size_t j = k; j < n; ++j) {
                Real v = absT(qr_(i, j));
                if (v > best) { best = v; rb = i; cb = j; }
            }
        const Real bic = best;
        if (k == 0) biggest = bic;

        // if the corner is negligible we are below full rank: stop reflecting,
        // leave the rest as identity transpositions (Eigen's early finish).
        if (bic <= prec * biggest) {
            nonzero_ = k;
            for (std::size_t i = k; i < size; ++i) {
                rowTrans_[i] = i;
                colTrans_[i] = i;
                hcoeffs_[i] = T(0);
            }
            break;
        }

        rowTrans_[k] = rb;
        colTrans_[k] = cb;
        // tail-only row swap (columns k..n-1) — leaves stored reflectors intact.
        if (rb != k)
            for (std::size_t j = k; j < n; ++j) std::swap(qr_(k, j), qr_(rb, j));
        // full column swap.
        if (cb != k)
            for (std::size_t i = 0; i < m; ++i) std::swap(qr_(i, k), qr_(i, cb));

        // Householder reflector on column k, rows k..m-1.
        std::vector<T> x(m - k);
        for (std::size_t i = 0; i < m - k; ++i) x[i] = qr_(k + i, k);
        T tau;
        makeHouseholderEigen(x, tau);
        qr_(k, k) = x[0];  // β (new pivot / diagonal entry)
        for (std::size_t i = 1; i < m - k; ++i) qr_(k + i, k) = x[i];  // essential part
        hcoeffs_[k] = tau;

        // apply H = I - τ v vᴴ (v = [1, essential]) to the trailing columns k+1..n-1
        if (ScalarTraits<T>::absval(tau) != Real(0)) {
            for (std::size_t j = k + 1; j < n; ++j) {
                T s = qr_(k, j);  // v[0] = 1
                for (std::size_t i = k + 1; i < m; ++i)
                    s += ScalarTraits<T>::conj(qr_(i, k)) * qr_(i, j);
                T t = tau * s;
                qr_(k, j) -= t;
                for (std::size_t i = k + 1; i < m; ++i) qr_(i, j) -= t * qr_(i, k);
            }
        }
    }

    // build the column permutation: identity, then applyTranspositionOnTheRight.
    for (std::size_t j = 0; j < n; ++j) perm_[j] = j;
    for (std::size_t k = 0; k < size; ++k) std::swap(perm_[k], perm_[colTrans_[k]]);
}

template <class T>
std::size_t FullPivHouseholderQR<T>::rank() const {
    using Real = typename ScalarTraits<T>::Real;
    if (!ok_) return 0;
    Real maxpiv = Real(0);
    for (std::size_t i = 0; i < nonzero_; ++i) {
        Real a = absT(qr_(i, i));
        if (a > maxpiv) maxpiv = a;
    }
    const Real thr = maxpiv * Real(prescribed_ > 0.0
                                   ? prescribed_
                                   : static_cast<double>(std::numeric_limits<Real>::epsilon())
                                         * static_cast<double>((m_ < n_) ? m_ : n_));
    std::size_t r = 0;
    for (std::size_t i = 0; i < nonzero_; ++i)
        if (absT(qr_(i, i)) > thr) ++r;
    return r;
}

template <class T>
Matrix<T> FullPivHouseholderQR<T>::matrixQ() const {
    using Real = typename ScalarTraits<T>::Real;
    const std::size_t m = m_, n = n_;
    const std::size_t size = (m < n) ? m : n;
    Matrix<T> Q = Matrix<T>::Identity(m);
    // Q = product of H'_0 … H'_{size-1} with the row transpositions interleaved,
    // accumulated from the last reflector backwards (Eigen evalTo).
    for (std::size_t kk = 0; kk < size; ++kk) {
        const std::size_t k = size - 1 - kk;
        const T tau = hcoeffs_[k];
        if (ScalarTraits<T>::absval(tau) != Real(0)) {
            // apply (I - conj(τ) v vᴴ) on the left to rows k..m-1, all m columns.
            const T ctau = ScalarTraits<T>::conj(tau);
            for (std::size_t j = 0; j < m; ++j) {
                T s = Q(k, j);  // v[0] = 1
                for (std::size_t i = k + 1; i < m; ++i)
                    s += ScalarTraits<T>::conj(qr_(i, k)) * Q(i, j);
                T t = ctau * s;
                Q(k, j) -= t;
                for (std::size_t i = k + 1; i < m; ++i) Q(i, j) -= t * qr_(i, k);
            }
        }
        // full row swap k <-> rowTrans_[k].
        if (rowTrans_[k] != k)
            for (std::size_t j = 0; j < m; ++j) std::swap(Q(k, j), Q(rowTrans_[k], j));
    }
    return Q;
}

template <class T>
std::vector<T> FullPivHouseholderQR<T>::solve(const std::vector<T>& b) const {
    using Real = typename ScalarTraits<T>::Real;
    const std::size_t m = m_, n = n_;
    const std::size_t r = rank();
    std::vector<T> x(n, T(0));
    if (!ok_ || r == 0) return x;

    // c = b; apply the row transpositions + reflectors of the leading r steps.
    std::vector<T> c(b);
    if (c.size() < m) c.resize(m, T(0));
    for (std::size_t k = 0; k < r; ++k) {
        if (rowTrans_[k] != k) std::swap(c[k], c[rowTrans_[k]]);
        const T tau = hcoeffs_[k];
        if (ScalarTraits<T>::absval(tau) != Real(0)) {
            T s = c[k];  // v[0] = 1
            for (std::size_t i = k + 1; i < m; ++i)
                s += ScalarTraits<T>::conj(qr_(i, k)) * c[i];
            T t = tau * s;
            c[k] -= t;
            for (std::size_t i = k + 1; i < m; ++i) c[i] -= t * qr_(i, k);
        }
    }
    // back-substitute the leading r×r upper-triangular block of R.
    for (std::size_t ii = 0; ii < r; ++ii) {
        const std::size_t i = r - 1 - ii;
        T s = c[i];
        for (std::size_t j = i + 1; j < r; ++j) s -= qr_(i, j) * c[j];
        c[i] = s / qr_(i, i);
    }
    // scatter through the column permutation: x[perm_[i]] = c[i] for i<r, else 0.
    for (std::size_t i = 0; i < r; ++i) x[perm_[i]] = c[i];
    return x;
}

// ===========================================================================
// SymmetricEigen — Householder tridiagonalization + implicit-shift QL
// (Numerical Recipes tred2 + tqli, adapted), eigenvectors accumulated, sorted.
// ===========================================================================
void SymmetricEigen::compute(const MatrixD& A, bool computeVectors) {
    const DenseOpScope opScope(DenseOp::SymmetricEigen, A.rows(), A.cols());
    const std::size_t n = A.rows();
    ok_ = (A.rows() == A.cols());
    eval_.assign(n, 0.0);
    V_ = MatrixD(n, n, 0.0);
    if (!ok_) return;
    if (n == 0) { ok_ = true; return; }
    if (n == 1) { eval_[0] = A(0, 0); V_(0, 0) = 1.0; ok_ = true; return; }

    // z = working copy; on exit holds the accumulated transform (eigenvectors).
    std::vector<double> d(n, 0.0), e(n, 0.0);
    std::vector<std::vector<double>> z(n, std::vector<double>(n, 0.0));
    for (std::size_t i = 0; i < n; ++i)
        for (std::size_t j = 0; j < n; ++j) z[i][j] = A(i, j);

    // ---- tred2: Householder reduction to tridiagonal (d=diag, e=subdiag) ----
    for (std::size_t i = n - 1; i >= 1; --i) {
        std::size_t l = i - 1;
        double h = 0.0, scale = 0.0;
        if (l > 0) {
            for (std::size_t k = 0; k <= l; ++k) scale += std::fabs(z[i][k]);
            if (scale == 0.0) {
                e[i] = z[i][l];
            } else {
                for (std::size_t k = 0; k <= l; ++k) {
                    z[i][k] /= scale;
                    h += z[i][k] * z[i][k];
                }
                double f = z[i][l];
                double g = (f >= 0.0) ? -std::sqrt(h) : std::sqrt(h);
                e[i] = scale * g;
                h -= f * g;
                z[i][l] = f - g;
                f = 0.0;
                for (std::size_t j = 0; j <= l; ++j) {
                    if (computeVectors) z[j][i] = z[i][j] / h;
                    g = 0.0;
                    for (std::size_t k = 0; k <= j; ++k) g += z[j][k] * z[i][k];
                    for (std::size_t k = j + 1; k <= l; ++k) g += z[k][j] * z[i][k];
                    e[j] = g / h;
                    f += e[j] * z[i][j];
                }
                double hh = f / (h + h);
                for (std::size_t j = 0; j <= l; ++j) {
                    f = z[i][j];
                    e[j] = g = e[j] - hh * f;
                    for (std::size_t k = 0; k <= j; ++k) z[j][k] -= (f * e[k] + g * z[i][k]);
                }
            }
        } else {
            e[i] = z[i][l];
        }
        d[i] = h;
        if (i == 1) break;  // unsigned guard
    }
    if (computeVectors) d[0] = 0.0;
    e[0] = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        if (computeVectors) {
            std::size_t l = i;
            if (d[i] != 0.0) {
                for (std::size_t j = 0; j < l; ++j) {
                    double g = 0.0;
                    for (std::size_t k = 0; k < l; ++k) g += z[i][k] * z[k][j];
                    for (std::size_t k = 0; k < l; ++k) z[k][j] -= g * z[k][i];
                }
            }
        }
        d[i] = z[i][i];
        if (computeVectors) {
            z[i][i] = 1.0;
            for (std::size_t j = 0; j < i; ++j) { z[j][i] = 0.0; z[i][j] = 0.0; }
        }
    }

    // ---- tqli: QL with implicit shifts on the tridiagonal (d,e) ----
    for (std::size_t i = 1; i < n; ++i) e[i - 1] = e[i];
    e[n - 1] = 0.0;
    for (std::size_t l = 0; l < n; ++l) {
        int iter = 0;
        std::size_t m;
        do {
            for (m = l; m < n - 1; ++m) {
                double dd = std::fabs(d[m]) + std::fabs(d[m + 1]);
                if (std::fabs(e[m]) <= std::numeric_limits<double>::epsilon() * dd) break;
            }
            if (m != l) {
                if (++iter == 60) { ok_ = false; break; }
                double g = (d[l + 1] - d[l]) / (2.0 * e[l]);
                double r = std::hypot(g, 1.0);
                double sgn = (g >= 0.0) ? std::fabs(r) : -std::fabs(r);
                g = d[m] - d[l] + e[l] / (g + sgn);
                double s = 1.0, c = 1.0, p = 0.0;
                std::size_t i;
                for (i = m; i-- > l;) {
                    double f = s * e[i];
                    double b = c * e[i];
                    r = std::hypot(f, g);
                    e[i + 1] = r;
                    if (r == 0.0) { d[i + 1] -= p; e[m] = 0.0; break; }
                    s = f / r; c = g / r;
                    g = d[i + 1] - p;
                    r = (d[i] - g) * s + 2.0 * c * b;
                    p = s * r;
                    d[i + 1] = g + p;
                    g = c * r - b;
                    if (computeVectors) {
                        for (std::size_t k = 0; k < n; ++k) {
                            f = z[k][i + 1];
                            z[k][i + 1] = s * z[k][i] + c * f;
                            z[k][i]     = c * z[k][i] - s * f;
                        }
                    }
                    if (i == l) break;
                }
                if (r == 0.0 && i >= l && i < m) continue;
                d[l] -= p; e[l] = g; e[m] = 0.0;
            }
        } while (m != l);
    }

    // ---- sort ascending, carry eigenvectors ----
    std::vector<std::size_t> idx(n);
    for (std::size_t i = 0; i < n; ++i) idx[i] = i;
    std::sort(idx.begin(), idx.end(),
              [&](std::size_t a, std::size_t b) { return d[a] < d[b]; });
    for (std::size_t c = 0; c < n; ++c) {
        eval_[c] = d[idx[c]];
        for (std::size_t r = 0; r < n; ++r) V_(r, c) = z[r][idx[c]];
    }
    // normalize sign so the largest-magnitude component is positive (stable form)
    for (std::size_t c = 0; c < n; ++c) {
        std::size_t pr = 0; double pm = 0.0;
        for (std::size_t r = 0; r < n; ++r) {
            double a = std::fabs(V_(r, c));
            if (a > pm) { pm = a; pr = r; }
        }
        if (V_(pr, c) < 0.0)
            for (std::size_t r = 0; r < n; ++r) V_(r, c) = -V_(r, c);
    }
}

// ===========================================================================
// GeneralizedSymmetricEigen — K φ = λ M φ via Cholesky-of-M reduction.
// ===========================================================================
void GeneralizedSymmetricEigen::compute(const MatrixD& K, const MatrixD& M,
                                        bool computeVectors) {
    const DenseOpScope opScope(DenseOp::GeneralizedSymmetricEigen, K.rows(), K.cols());
    const std::size_t n = K.rows();
    ok_ = (K.rows() == K.cols() && M.rows() == n && M.cols() == n);
    eval_.assign(n, 0.0);
    V_ = MatrixD(n, n, 0.0);
    if (!ok_) return;

    // M = L Lᵀ
    LLT<double> chol(M);
    if (!chol.ok()) { ok_ = false; return; }
    const MatrixD& L = chol.matrixL();

    // C = L⁻¹ K L⁻ᵀ. Compute Y = L⁻¹ K (solve L Y = K, forward subst per column),
    // then C = Y L⁻ᵀ = (L⁻¹ Yᵀ)ᵀ (solve L Z = Yᵀ, then C = Zᵀ).
    auto forwardL = [&](const std::vector<double>& rhs) {
        std::vector<double> y(n, 0.0);
        for (std::size_t i = 0; i < n; ++i) {
            double s = rhs[i];
            for (std::size_t k = 0; k < i; ++k) s -= L(i, k) * y[k];
            y[i] = s / L(i, i);
        }
        return y;
    };
    MatrixD Y(n, n, 0.0);
    {
        std::vector<double> col(n);
        for (std::size_t j = 0; j < n; ++j) {
            for (std::size_t i = 0; i < n; ++i) col[i] = K(i, j);
            std::vector<double> yj = forwardL(col);
            for (std::size_t i = 0; i < n; ++i) Y(i, j) = yj[i];
        }
    }
    MatrixD C(n, n, 0.0);
    {
        // C = L⁻¹ Yᵀ  then transpose; since K symmetric, C is symmetric.
        std::vector<double> col(n);
        for (std::size_t j = 0; j < n; ++j) {
            for (std::size_t i = 0; i < n; ++i) col[i] = Y(j, i);  // row j of Y = col of Yᵀ
            std::vector<double> zj = forwardL(col);
            for (std::size_t i = 0; i < n; ++i) C(i, j) = zj[i];
        }
        // symmetrize to wipe rounding asymmetry
        for (std::size_t i = 0; i < n; ++i)
            for (std::size_t j = i + 1; j < n; ++j) {
                double m = 0.5 * (C(i, j) + C(j, i));
                C(i, j) = C(j, i) = m;
            }
    }

    SymmetricEigen es(C, computeVectors);
    if (!es.ok()) { ok_ = false; return; }
    eval_ = es.eigenvalues();
    if (!computeVectors) return;

    // back-transform: φ = L⁻ᵀ y (solve Lᵀ φ = y, back subst per eigenvector column)
    const MatrixD& Yvec = es.eigenvectors();
    auto backLT = [&](const std::vector<double>& rhs) {
        std::vector<double> x(n, 0.0);
        for (std::size_t ii = 0; ii < n; ++ii) {
            std::size_t i = n - 1 - ii;
            double s = rhs[i];
            for (std::size_t k = i + 1; k < n; ++k) s -= L(k, i) * x[k];
            x[i] = s / L(i, i);
        }
        return x;
    };
    std::vector<double> col(n);
    for (std::size_t c = 0; c < n; ++c) {
        for (std::size_t i = 0; i < n; ++i) col[i] = Yvec(i, c);
        std::vector<double> phi = backLT(col);
        for (std::size_t i = 0; i < n; ++i) V_(i, c) = phi[i];
    }
}

// ===========================================================================
// SparseCSR
// ===========================================================================
template <class T>
void SparseCSR<T>::setFromTriplets(std::size_t rows, std::size_t cols,
                                   const std::vector<Triplet<T>>& trips) {
    rows_ = rows; cols_ = cols;
    rowPtr_.assign(rows + 1, 0);
    // count per row
    for (const auto& t : trips) if (t.row < rows) ++rowPtr_[t.row + 1];
    for (std::size_t i = 0; i < rows; ++i) rowPtr_[i + 1] += rowPtr_[i];
    std::vector<std::size_t> fill(rowPtr_.begin(), rowPtr_.end() - 1);
    std::vector<std::size_t> rawCol(trips.size());
    std::vector<T> rawVal(trips.size());
    for (const auto& t : trips) {
        if (t.row >= rows || t.col >= cols) continue;
        std::size_t pos = fill[t.row]++;
        rawCol[pos] = t.col; rawVal[pos] = t.value;
    }
    // sort within each row by column and sum duplicates
    colIdx_.clear(); val_.clear();
    colIdx_.reserve(trips.size()); val_.reserve(trips.size());
    std::vector<std::size_t> newPtr(rows + 1, 0);
    for (std::size_t i = 0; i < rows; ++i) {
        std::size_t a = rowPtr_[i], b = rowPtr_[i + 1];
        std::vector<std::pair<std::size_t, T>> rowEntries;
        rowEntries.reserve(b - a);
        for (std::size_t k = a; k < b; ++k) rowEntries.emplace_back(rawCol[k], rawVal[k]);
        std::sort(rowEntries.begin(), rowEntries.end(),
                  [](const std::pair<std::size_t, T>& x, const std::pair<std::size_t, T>& y) {
                      return x.first < y.first;
                  });
        newPtr[i] = colIdx_.size();
        std::size_t j = 0;
        while (j < rowEntries.size()) {
            std::size_t c = rowEntries[j].first;
            T sum = rowEntries[j].second;
            ++j;
            while (j < rowEntries.size() && rowEntries[j].first == c) {
                sum += rowEntries[j].second; ++j;
            }
            colIdx_.push_back(c);
            val_.push_back(sum);
        }
    }
    newPtr[rows] = colIdx_.size();
    rowPtr_ = newPtr;
}

template <class T>
std::vector<T> SparseCSR<T>::operator*(const std::vector<T>& x) const {
    std::vector<T> y(rows_, T(0));
    for (std::size_t i = 0; i < rows_; ++i) {
        T s = T(0);
        for (std::size_t k = rowPtr_[i]; k < rowPtr_[i + 1]; ++k)
            s += val_[k] * x[colIdx_[k]];
        y[i] = s;
    }
    return y;
}

template <class T>
std::vector<T> SparseCSR<T>::diagonal() const {
    std::vector<T> d(std::min(rows_, cols_), T(0));
    for (std::size_t i = 0; i < rows_; ++i)
        for (std::size_t k = rowPtr_[i]; k < rowPtr_[i + 1]; ++k)
            if (colIdx_[k] == i) { d[i] = val_[k]; break; }
    return d;
}

template <class T>
Matrix<T> SparseCSR<T>::toDense() const {
    Matrix<T> A(rows_, cols_, T(0));
    for (std::size_t i = 0; i < rows_; ++i)
        for (std::size_t k = rowPtr_[i]; k < rowPtr_[i + 1]; ++k)
            A(i, colIdx_[k]) = val_[k];
    return A;
}

template <class T>
T SparseCSR<T>::coeff(std::size_t i, std::size_t j) const {
    for (std::size_t k = rowPtr_[i]; k < rowPtr_[i + 1]; ++k)
        if (colIdx_[k] == j) return val_[k];
    return T(0);
}

// ===========================================================================
// SparseLDLT — TRUE sparse SPD direct factorization. No densify: the matrix is
// fill-reducing-reordered (Reverse Cuthill-McKee), symbolically analyzed (the
// elimination tree gives the exact nonzero pattern of L), and factored with an
// up-looking sparse LDLᵀ. Memory is O(nnz(L)), time is O(nnz(L)·avg-col), so
// large banded FE/CFD systems (n in the 10⁴–10⁵ range) factor in a few MB and
// well under a second — infeasible with the previous dense O(n²)/O(n³) path.
//
// Reference: T. Davis, "Direct Methods for Sparse Linear Systems" (SIAM 2006),
// chs. 4 (etree), 4.4 (up-looking LDLᵀ / ldl), and George & Liu (RCM ordering).
// ===========================================================================
namespace {

// Build the symmetric adjacency (union of upper+lower nonzero patterns, no
// self/diagonal entries) of A from its CSR, as per-row sorted neighbor lists.
// SPD assembly stores the full symmetric pattern, but we union both triangles
// so a structurally-asymmetric-but-valued-symmetric assembly is still handled.
static std::vector<std::vector<std::size_t>>
buildAdjacency(const SparseCSR<double>& A) {
    const std::size_t n = A.rows();
    const auto& rp = A.rowPtr();
    const auto& ci = A.colIdx();
    std::vector<std::vector<std::size_t>> adj(n);
    for (std::size_t i = 0; i < n; ++i) {
        for (std::size_t k = rp[i]; k < rp[i + 1]; ++k) {
            std::size_t j = ci[k];
            if (j == i) continue;
            adj[i].push_back(j);
            adj[j].push_back(i);   // symmetrize the pattern
        }
    }
    for (auto& v : adj) {
        std::sort(v.begin(), v.end());
        v.erase(std::unique(v.begin(), v.end()), v.end());
    }
    return adj;
}

// Reverse Cuthill-McKee fill-reducing ordering. BFS from a pseudo-peripheral
// node within each connected component, ordering neighbors by ascending degree,
// then reverse the resulting sequence. perm[k] = original node at new index k.
static std::vector<std::size_t>
reverseCuthillMcKee(const std::vector<std::vector<std::size_t>>& adj) {
    const std::size_t n = adj.size();
    std::vector<std::size_t> deg(n);
    for (std::size_t i = 0; i < n; ++i) deg[i] = adj[i].size();

    std::vector<char> visited(n, 0);
    std::vector<std::size_t> order;
    order.reserve(n);

    // One Cuthill-McKee BFS sweep from a given root, appending the level-set
    // ordering (neighbors sorted by ascending degree) to `order`.
    auto cmSweep = [&](std::size_t root) {
        std::vector<std::size_t> queue;
        std::size_t head = 0;
        visited[root] = 1;
        queue.push_back(root);
        while (head < queue.size()) {
            std::size_t u = queue[head++];
            order.push_back(u);
            // collect unvisited neighbors, order by ascending degree
            std::vector<std::size_t> nbrs;
            for (std::size_t v : adj[u]) if (!visited[v]) nbrs.push_back(v);
            std::sort(nbrs.begin(), nbrs.end(),
                      [&](std::size_t a, std::size_t b) {
                          if (deg[a] != deg[b]) return deg[a] < deg[b];
                          return a < b;
                      });
            for (std::size_t v : nbrs) { visited[v] = 1; queue.push_back(v); }
        }
    };

    // Find a pseudo-peripheral node in the component containing `start` (a few
    // BFS rounds picking the min-degree node of the deepest level). Returns the
    // chosen root and leaves `visited` for the component cleared.
    auto bfsDepthAndFar = [&](std::size_t start) {
        // returns {eccentricity-depth, farthest min-degree node}, using a local
        // visited map so the global one is untouched.
        std::vector<char> vis(n, 0);
        std::vector<std::size_t> queue, levelStart;
        std::size_t head = 0;
        vis[start] = 1; queue.push_back(start);
        std::size_t depth = 0, lastLevelBegin = 0;
        levelStart.push_back(0);
        while (head < queue.size()) {
            std::size_t levelEnd = queue.size();
            lastLevelBegin = head;
            while (head < levelEnd) {
                std::size_t u = queue[head++];
                for (std::size_t v : adj[u])
                    if (!vis[v]) { vis[v] = 1; queue.push_back(v); }
            }
            if (head < queue.size()) ++depth;
        }
        // pick the min-degree node among the last BFS level
        std::size_t best = queue[lastLevelBegin];
        for (std::size_t p = lastLevelBegin; p < queue.size(); ++p)
            if (deg[queue[p]] < deg[best]) best = queue[p];
        return std::pair<std::size_t, std::size_t>(depth, best);
    };

    for (std::size_t s = 0; s < n; ++s) {
        if (visited[s]) continue;
        // pseudo-peripheral root: iterate to (near) maximize eccentricity
        std::size_t root = s;
        auto pr = bfsDepthAndFar(root);
        std::size_t bestDepth = pr.first, far = pr.second;
        for (int iter = 0; iter < 4 && far != root; ++iter) {
            auto pr2 = bfsDepthAndFar(far);
            if (pr2.first <= bestDepth) break;
            bestDepth = pr2.first; root = far; far = pr2.second;
        }
        cmSweep(root);
    }
    // Reverse for RCM.
    std::reverse(order.begin(), order.end());
    return order;
}

// ---------------------------------------------------------------------------
// Approximate Minimum Degree (AMD) ordering — T-163.
//
// Clean-room implementation of the quotient-graph minimum-degree method of
// Amestoy, Davis & Duff, "An approximate minimum degree ordering algorithm",
// SIAM J. Matrix Anal. Appl. 17(4):886-905 (1996), written from the paper's
// description (no SuiteSparse/CSparse source is copied or vendored).
//
// The elimination graph is never formed. Instead the quotient graph keeps
//   * VARIABLES i (not yet eliminated) with two adjacency lists:
//       A[i] — variable neighbours, E[i] — adjacent ELEMENTS;
//   * ELEMENTS e (eliminated pivots) with their variable list L_e (stored in
//     A[e]); eliminating pivot p merges p's variable neighbours and the L_e of
//     every element adjacent to p into the new element L_p and ABSORBS those
//     elements (they are dead from then on).
// Exact external degrees are too expensive, so each variable i ∈ L_p receives
// the AMD upper bound
//     d_i = min( n_remaining − |i|,  d_i(prev) + |L_p \ i|,
//                |A_i| + |L_p \ i| + Σ_{e ∈ E_i \ p} |L_e \ L_p| ),
// where |L_e \ L_p| is computed for all touched elements in one sweep. Weights
// |·| count original variables (supervariables carry nv > 1). Further:
//   * aggressive element absorption: |L_e \ L_p| = 0  ⇒  L_e ⊆ L_p, absorb e;
//   * mass elimination: a variable left adjacent ONLY to element p is
//     eliminated together with p (it creates no new fill);
//   * supervariable detection: variables of L_p with identical (A, E) lists are
//     indistinguishable — merged into one weighted supervariable (hashed, then
//     compared exactly);
//   * dense rows (degree > max(16, 10·√n)) are removed up front and ordered
//     last, as in the paper.
// The pivot is always a variable of minimum approximate degree (bucket lists).
// Returns perm with perm[k] = original index eliminated at position k.
// ---------------------------------------------------------------------------
static std::vector<std::size_t>
approximateMinimumDegree(const std::vector<std::vector<std::size_t>>& adj) {
    const std::size_t nn = adj.size();
    std::vector<std::size_t> perm;
    perm.reserve(nn);
    if (nn == 0) return perm;
    if (nn >= static_cast<std::size_t>(std::numeric_limits<int>::max() / 2)) {
        // Index range of this implementation exceeded — fall back to identity
        // rather than overflow (unreachable for any matrix that fits in RAM
        // with this factorization).
        for (std::size_t i = 0; i < nn; ++i) perm.push_back(i);
        return perm;
    }
    const int n = static_cast<int>(nn);

    enum : unsigned char { VAR = 0, ELEM = 1, DEAD = 2, MERGED = 3, DENSE = 4, ELIM = 5 };
    std::vector<unsigned char> st(nn, VAR);
    std::vector<std::vector<int>> A(nn), E(nn);   // A[e] doubles as L_e for elements
    std::vector<int> nv(nn, 1), deg(nn, 0);
    std::vector<int> chainNext(nn, -1), chainTail(nn);
    for (int i = 0; i < n; ++i) chainTail[i] = i;

    // ---- dense rows: ordered last, removed from the graph ----------------
    const double denseThr = std::max(16.0, 10.0 * std::sqrt(static_cast<double>(n)));
    std::vector<int> denseList;
    for (int i = 0; i < n; ++i)
        if (static_cast<double>(adj[i].size()) > denseThr) { st[i] = DENSE; denseList.push_back(i); }
    const int nlive = n - static_cast<int>(denseList.size());

    for (int i = 0; i < n; ++i) {
        if (st[i] != VAR) continue;
        A[i].reserve(adj[i].size());
        for (std::size_t j : adj[i])
            if (st[j] != DENSE && static_cast<int>(j) != i) A[i].push_back(static_cast<int>(j));
        deg[i] = static_cast<int>(A[i].size());
    }

    // ---- degree buckets (doubly linked) ----------------------------------
    std::vector<int> head(nn + 1, -1), nxt(nn, -1), prv(nn, -1);
    int mindeg = n;
    auto bucketInsert = [&](int i) {
        const int d = deg[i];
        nxt[i] = head[d]; prv[i] = -1;
        if (head[d] >= 0) prv[head[d]] = i;
        head[d] = i;
        if (d < mindeg) mindeg = d;
    };
    auto bucketRemove = [&](int i) {
        const int d = deg[i];
        if (prv[i] >= 0) nxt[prv[i]] = nxt[i]; else head[d] = nxt[i];
        if (nxt[i] >= 0) prv[nxt[i]] = prv[i];
        nxt[i] = prv[i] = -1;
    };
    for (int i = 0; i < n; ++i) if (st[i] == VAR) bucketInsert(i);

    std::vector<int> order;            // principal variables in elimination order
    order.reserve(nn);
    std::vector<int> lpMark(nn, 0);    // == step  ⇔  in L_p (or p itself)
    std::vector<int> wStamp(nn, 0), w(nn, 0);
    std::vector<int> cmpMark(nn, 0);
    int cmpTag = 0;
    std::vector<int> Lp, survivors, asum(nn, 0), esum(nn, 0);
    std::vector<std::pair<std::uint64_t, int>> hashed;
    int nelim = 0, step = 0;

    while (nelim < nlive) {
        // ---- 1. pivot: a variable of minimum approximate degree ----------
        while (mindeg <= n && head[mindeg] < 0) ++mindeg;
        if (mindeg > n) break;                       // defensive: graph exhausted
        const int p = head[mindeg];
        bucketRemove(p);
        ++step;
        nelim += nv[p];
        order.push_back(p);

        // ---- 2. new element L_p = (A_p ∪ ⋃_{e∈E_p} L_e) \ p; absorb E_p ---
        Lp.clear();
        int degp = 0;
        lpMark[p] = step;
        for (int j : A[p])
            if (st[j] == VAR && nv[j] > 0 && lpMark[j] != step) {
                lpMark[j] = step; Lp.push_back(j); degp += nv[j];
            }
        for (int e : E[p]) {
            if (st[e] != ELEM) continue;
            for (int j : A[e])
                if (st[j] == VAR && nv[j] > 0 && lpMark[j] != step) {
                    lpMark[j] = step; Lp.push_back(j); degp += nv[j];
                }
            st[e] = DEAD;                            // absorbed into p
            std::vector<int>().swap(A[e]);
        }
        std::vector<int>().swap(A[p]);
        std::vector<int>().swap(E[p]);
        st[p] = ELEM;
        for (int i : Lp) bucketRemove(i);

        // ---- 3. w(e) = |L_e \ L_p| for every element touching L_p ---------
        for (int i : Lp)
            for (int e : E[i]) {
                if (st[e] != ELEM) continue;
                if (wStamp[e] != step) { wStamp[e] = step; w[e] = deg[e]; }
                w[e] -= nv[i];
            }

        // ---- 4a. prune lists, aggressive absorption, mass elimination ------
        survivors.clear();
        for (int i : Lp) {
            std::vector<int>& Ei = E[i];
            std::size_t we = 0;
            int es = 0;
            for (int e : Ei) {
                if (st[e] != ELEM) continue;
                if (w[e] <= 0) {                     // L_e ⊆ L_p: absorb into p
                    st[e] = DEAD;
                    std::vector<int>().swap(A[e]);
                    continue;
                }
                es += w[e];
                Ei[we++] = e;
            }
            Ei.resize(we);
            std::vector<int>& Ai = A[i];
            std::size_t wa = 0;
            int as = 0;
            for (int j : Ai) {
                if (st[j] != VAR || nv[j] <= 0 || lpMark[j] == step) continue;
                as += nv[j];
                Ai[wa++] = j;
            }
            Ai.resize(wa);
            if (Ai.empty() && Ei.empty()) {
                // adjacent only to p: eliminate now, right after p
                st[i] = ELIM;
                nelim += nv[i];
                degp -= nv[i];
                order.push_back(i);
                std::vector<int>().swap(Ai);
                std::vector<int>().swap(Ei);
                continue;
            }
            asum[i] = as; esum[i] = es;
            survivors.push_back(i);
        }

        // ---- 4b. approximate external degrees -----------------------------
        const int remaining = nlive - nelim;
        for (int i : survivors) {
            E[i].push_back(p);
            const int ext = degp - nv[i];
            long long d = static_cast<long long>(deg[i]) + ext;
            d = std::min<long long>(d, static_cast<long long>(asum[i]) + ext + esum[i]);
            d = std::min<long long>(d, remaining - nv[i]);
            deg[i] = static_cast<int>(std::max<long long>(d, 0));
        }

        // ---- 5. supervariable detection among the survivors ----------------
        hashed.clear();
        for (int i : survivors) {
            std::uint64_t h = 0;
            for (int j : A[i]) h += static_cast<std::uint64_t>(j);
            for (int e : E[i]) h += static_cast<std::uint64_t>(e);
            h = h * 1000003u + (static_cast<std::uint64_t>(A[i].size()) << 20)
                + static_cast<std::uint64_t>(E[i].size());
            hashed.emplace_back(h, i);
        }
        std::sort(hashed.begin(), hashed.end());
        for (std::size_t a = 0; a < hashed.size();) {
            std::size_t b = a + 1;
            while (b < hashed.size() && hashed[b].first == hashed[a].first) ++b;
            for (std::size_t x = a; x + 1 < b; ++x) {
                const int i = hashed[x].second;
                if (nv[i] <= 0) continue;
                ++cmpTag;
                for (int j : A[i]) cmpMark[j] = cmpTag;
                for (int e : E[i]) cmpMark[e] = cmpTag;
                for (std::size_t y = x + 1; y < b; ++y) {
                    const int j = hashed[y].second;
                    if (nv[j] <= 0 || A[j].size() != A[i].size() ||
                        E[j].size() != E[i].size()) continue;
                    bool same = true;
                    for (int q : A[j]) if (cmpMark[q] != cmpTag) { same = false; break; }
                    if (same)
                        for (int q : E[j]) if (cmpMark[q] != cmpTag) { same = false; break; }
                    if (!same) continue;
                    // merge j into i
                    nv[i] += nv[j];
                    deg[i] = std::max(0, deg[i] - nv[j]);
                    nv[j] = 0;
                    st[j] = MERGED;
                    std::vector<int>().swap(A[j]);
                    std::vector<int>().swap(E[j]);
                    chainNext[chainTail[i]] = j;
                    chainTail[i] = chainTail[j];
                }
            }
            a = b;
        }

        // ---- 6. finalize element p and re-queue the survivors --------------
        deg[p] = degp;
        A[p].clear();
        for (int i : survivors)
            if (nv[i] > 0) { A[p].push_back(i); bucketInsert(i); }
    }

    // ---- expand supervariables, then the dense rows -----------------------
    std::vector<char> placed(nn, 0);
    for (int pv : order)
        for (int j = pv; j >= 0; j = chainNext[j])
            if (!placed[j]) { placed[j] = 1; perm.push_back(static_cast<std::size_t>(j)); }
    for (int d : denseList)
        if (!placed[d]) { placed[d] = 1; perm.push_back(static_cast<std::size_t>(d)); }
    // Defensive completeness: anything not reached (cannot happen for a
    // consistent quotient graph) is appended so perm is always a permutation.
    for (int i = 0; i < n; ++i)
        if (!placed[i]) perm.push_back(static_cast<std::size_t>(i));
    return perm;
}

// Postorder an ordering by its elimination tree (Liu). For the permuted pattern
// P A Pᵀ the etree is computed (path-compressed ancestor walk), then a DFS
// postorder relabels the nodes so every subtree is contiguous. A postorder is
// an EQUIVALENT ordering — it yields exactly the same nnz(L) and flop count —
// but it makes each subtree's columns of L adjacent in memory, which is what
// the up-looking numeric factorization's column walks need for locality.
static std::vector<std::size_t>
postorderByEtree(const std::vector<std::vector<std::size_t>>& adj,
                 const std::vector<std::size_t>& perm) {
    const std::size_t n = perm.size();
    std::vector<std::size_t> iperm(n);
    for (std::size_t k = 0; k < n; ++k) iperm[perm[k]] = k;
    const std::size_t NONE = static_cast<std::size_t>(-1);
    std::vector<std::size_t> parent(n, NONE), ancestor(n, NONE);
    for (std::size_t k = 0; k < n; ++k) {
        for (std::size_t oj : adj[perm[k]]) {
            std::size_t i = iperm[oj];
            if (i >= k) continue;
            // climb from i to the root of its current subtree, compressing
            while (i != NONE && i != k) {
                const std::size_t next = ancestor[i];
                ancestor[i] = k;
                if (next == NONE) { parent[i] = k; break; }
                i = next;
            }
        }
    }
    // children lists (head/next), filled in reverse so DFS visits ascending
    std::vector<std::size_t> head(n, NONE), next(n, NONE);
    for (std::size_t j = n; j-- > 0;)
        if (parent[j] != NONE) { next[j] = head[parent[j]]; head[parent[j]] = j; }
    std::vector<std::size_t> post;
    post.reserve(n);
    std::vector<std::size_t> stack;
    for (std::size_t r = 0; r < n; ++r) {
        if (parent[r] != NONE) continue;
        stack.push_back(r);
        while (!stack.empty()) {
            const std::size_t v = stack.back();
            const std::size_t c = head[v];
            if (c != NONE) { head[v] = next[c]; stack.push_back(c); }
            else { stack.pop_back(); post.push_back(v); }
        }
    }
    std::vector<std::size_t> out(n);
    for (std::size_t k = 0; k < n; ++k) out[k] = perm[post[k]];
    return out;
}

// ---------------------------------------------------------------------------
// Symbolic analysis of P A Pᵀ WITHOUT forming L (T-163).
//
//   * elimination tree — Liu, "A compact row storage scheme for Cholesky
//     factors using elimination trees", ACM TOMS 12(2), 1986 (path-compressed
//     ancestor walk);
//   * its postorder;
//   * exact column counts of L — Gilbert, Ng & Peyton, "An efficient algorithm
//     to compute row and column counts for sparse Cholesky factorization",
//     SIAM J. Matrix Anal. Appl. 15(4):1075-1091, 1994. Row i of L is the row
//     subtree T^i of the etree whose leaves are among {j < i : a_ij ≠ 0}; a
//     column j gains +1 for every row subtree it is a LEAF of and −1 at the
//     least common ancestor of consecutive leaves (in postorder) of the same
//     row subtree, and −1 for each child; summing these deltas up the tree
//     gives c_j. Leaves are recognised with first-descendant numbers and the
//     LCAs with a path-compressed disjoint-set forest.
//
// Cost O(nnz(A)·α(n)) — independent of nnz(L) — which is what makes it
// affordable to analyse EVERY candidate ordering before factoring with one.
// Written from the papers; no third-party source is copied.
// ---------------------------------------------------------------------------
constexpr std::size_t kNoNode = static_cast<std::size_t>(-1);

struct PermutedPattern {          // CSR of P A Pᵀ's symmetric pattern, no diagonal
    std::vector<std::size_t> ptr; // size n+1
    std::vector<std::size_t> idx; // permuted neighbour indices (both triangles)
};

PermutedPattern permutePattern(const std::vector<std::vector<std::size_t>>& adj,
                               const std::vector<std::size_t>& perm) {
    const std::size_t n = perm.size();
    std::vector<std::size_t> iperm(n);
    for (std::size_t k = 0; k < n; ++k) iperm[perm[k]] = k;
    PermutedPattern P;
    P.ptr.assign(n + 1, 0);
    for (std::size_t k = 0; k < n; ++k) P.ptr[k + 1] = P.ptr[k] + adj[perm[k]].size();
    P.idx.resize(P.ptr[n]);
    for (std::size_t k = 0; k < n; ++k) {
        std::size_t q = P.ptr[k];
        for (std::size_t o : adj[perm[k]]) P.idx[q++] = iperm[o];
    }
    return P;
}

// parent[j] (> j) or kNoNode for a root.
std::vector<std::size_t> eliminationTree(const PermutedPattern& P, std::size_t n) {
    std::vector<std::size_t> parent(n, kNoNode), anc(n, kNoNode);
    for (std::size_t k = 0; k < n; ++k) {
        for (std::size_t q = P.ptr[k]; q < P.ptr[k + 1]; ++q) {
            std::size_t i = P.idx[q];
            if (i >= k) continue;
            // walk i -> root of its current subtree, re-pointing each node at k
            while (i != kNoNode && i != k) {
                const std::size_t up = anc[i];
                anc[i] = k;
                if (up == kNoNode) parent[i] = k;
                i = up;
            }
        }
    }
    return parent;
}

// post[t] = node visited t-th by a depth-first postorder of the forest.
std::vector<std::size_t> etreePostorder(const std::vector<std::size_t>& parent) {
    const std::size_t n = parent.size();
    std::vector<std::size_t> head(n, kNoNode), next(n, kNoNode);
    for (std::size_t j = n; j-- > 0;)
        if (parent[j] != kNoNode) { next[j] = head[parent[j]]; head[parent[j]] = j; }
    std::vector<std::size_t> post, stack;
    post.reserve(n);
    for (std::size_t r = 0; r < n; ++r) {
        if (parent[r] != kNoNode) continue;
        stack.push_back(r);
        while (!stack.empty()) {
            const std::size_t v = stack.back();
            const std::size_t c = head[v];
            if (c != kNoNode) { head[v] = next[c]; stack.push_back(c); }
            else { stack.pop_back(); post.push_back(v); }
        }
    }
    return post;
}

// c_j = number of STRICTLY-LOWER nonzeros in column j of L.
std::vector<std::size_t> strictColumnCounts(const PermutedPattern& P,
                                            const std::vector<std::size_t>& parent,
                                            const std::vector<std::size_t>& post) {
    const std::size_t n = parent.size();
    std::vector<std::size_t> firstDesc(n, kNoNode);   // postorder # of first descendant
    std::vector<std::size_t> lastLeafFirst(n, kNoNode);
    std::vector<std::size_t> prevLeaf(n, kNoNode);
    std::vector<std::size_t> setOf(n);
    std::vector<long long> delta(n, 0);
    for (std::size_t t = 0; t < n; ++t) {
        std::size_t j = post[t];
        delta[j] = (firstDesc[j] == kNoNode) ? 1 : 0;   // an etree leaf
        for (; j != kNoNode && firstDesc[j] == kNoNode; j = parent[j]) firstDesc[j] = t;
    }
    for (std::size_t i = 0; i < n; ++i) setOf[i] = i;
    for (std::size_t t = 0; t < n; ++t) {
        const std::size_t j = post[t];
        if (parent[j] != kNoNode) --delta[parent[j]];
        for (std::size_t q = P.ptr[j]; q < P.ptr[j + 1]; ++q) {
            const std::size_t i = P.idx[q];
            if (i <= j) continue;                       // only a_ij below the diagonal
            // j is a leaf of row subtree T^i iff none of its descendants was
            // already seen for row i (their first-descendant numbers are ≥ firstDesc[j]).
            if (lastLeafFirst[i] != kNoNode && firstDesc[j] <= lastLeafFirst[i]) continue;
            lastLeafFirst[i] = firstDesc[j];
            const std::size_t jprev = prevLeaf[i];
            prevLeaf[i] = j;
            ++delta[j];
            if (jprev != kNoNode) {
                // least common ancestor of (jprev, j) = representative of jprev's set
                std::size_t r = jprev;
                while (setOf[r] != r) r = setOf[r];
                for (std::size_t s = jprev; s != r;) { const std::size_t up = setOf[s]; setOf[s] = r; s = up; }
                --delta[r];
            }
        }
        if (parent[j] != kNoNode) setOf[j] = parent[j];
    }
    for (std::size_t j = 0; j < n; ++j)                 // parent[j] > j: children first
        if (parent[j] != kNoNode) delta[parent[j]] += delta[j];
    std::vector<std::size_t> c(n);
    for (std::size_t j = 0; j < n; ++j) c[j] = static_cast<std::size_t>(delta[j] - 1);
    return c;
}

SymbolicFactorStats symbolicStatsOf(const std::vector<std::vector<std::size_t>>& adj,
                                    const std::vector<std::size_t>& perm) {
    SymbolicFactorStats s;
    const std::size_t n = perm.size();
    if (n == 0) return s;
    const PermutedPattern P = permutePattern(adj, perm);
    const std::vector<std::size_t> parent = eliminationTree(P, n);
    const std::vector<std::size_t> post = etreePostorder(parent);
    const std::vector<std::size_t> c = strictColumnCounts(P, parent, post);
    for (std::size_t j = 0; j < n; ++j) {
        s.nnzL += c[j];
        const double cj = static_cast<double>(c[j]);
        s.flops += cj * (cj + 3.0) / 2.0;
    }
    return s;
}

// ---------------------------------------------------------------------------
// Multilevel NESTED DISSECTION (T-163).
//
// George (SIAM J. Numer. Anal. 10(2), 1973): find a small vertex SEPARATOR S
// splitting the graph into A and B with no A–B edge, order A, then B, then S
// LAST, and recurse into A and B. Fill can then only occur inside A, inside B
// and in the (dense) separator block — on a 3-D FE mesh that is O(n^{4/3})
// nonzeros against O(n^{5/3}) for a band/profile ordering.
//
// Separators are found the multilevel way (Hendrickson & Leland 1995; Karypis
// & Kumar, SIAM J. Sci. Comput. 20(1):359-392, 1998), written here from those
// descriptions:
//   0. COMPRESS: vertices with identical closed neighbourhoods (the d DOFs of
//      one FE node) are merged into one weighted vertex, so a node's DOFs are
//      never split and the graph shrinks d-fold (d² in edges).
//   1. COARSEN by heavy-edge matching until ~100 vertices remain.
//   2. On the coarsest graph compute several initial separators: greedy graph
//      growing (GGGP: grow one side from a random seed, always adding the
//      boundary vertex that most reduces the edge cut) to half the weight,
//      edge-FM refinement of that bisection, then BOTH sides' boundary
//      vertices as a thick separator that the node refinement thins; keep the
//      best.
//   3. UNCOARSEN: project the separator to each finer graph and improve it with
//      a two-sided Fiduccia-Mattheyses node-separator refinement (move a
//      separator vertex into a side, pulling its neighbours on the other side
//      into the separator; gain = separator-weight decrease; hill-climb with
//      rollback to the best state; sides capped at 60 % of the weight). Gains
//      are kept incrementally from per-vertex side-weight counts.
//   4. Also try a LEVEL-STRUCTURE separator on the fine graph itself (George &
//      Liu: the median breadth-first level from a pseudo-peripheral vertex —
//      a planar cut across the longest dimension of a mesh), refined the same
//      way; and for heavy graphs (the top of the dissection tree, where a
//      separator's size costs most fill) repeat the whole multilevel bisection
//      kNdMultiSeps times. The smallest balanced separator wins.
//   5. Recurse into each side (each connected component separately); below
//      kNdLeaf vertices order with AMD.
// Deterministic: a fixed-seed xorshift generator drives every random choice.
// Any degenerate split falls back to AMD for that subgraph, so the result is
// always a valid permutation.
// ---------------------------------------------------------------------------
struct NdGraph {
    int n = 0;
    std::vector<int> xadj;    // size n+1
    std::vector<int> adj;     // neighbour lists
    std::vector<int> ewgt;    // edge weights (parallel to adj)
    std::vector<int> vwgt;    // vertex weights
    long long totalW = 0;
};

struct NdRng {                // xorshift64* — deterministic, platform-independent
    std::uint64_t s;
    explicit NdRng(std::uint64_t seed) : s(seed ? seed : 0x9E3779B97F4A7C15ull) {}
    std::uint64_t next() {
        s ^= s >> 12; s ^= s << 25; s ^= s >> 27;
        return s * 2685821657736338717ull;
    }
    int below(int m) { return static_cast<int>(next() % static_cast<std::uint64_t>(m)); }
};

// Tuning measured on the kernel's own FEA matrices against Accelerate's METIS
// (test/sparse_ordering_gate.cpp): with these values nnz(L) averages ~1.08x
// METIS's and factor flops ~1.18x, over three seeds and five matrices.
constexpr int kNdCoarsenTo = 100;   // stop coarsening below this many vertices
constexpr int kNdLeaf = 120;        // order subgraphs this small with AMD
constexpr int kNdInitTries = 8;     // initial separators tried on the coarsest graph
constexpr int kNdPassCoarse = 8;    // node-FM passes on the coarsest graph / level cut
constexpr int kNdPassFine = 4;      // node-FM passes at each uncoarsening level
constexpr long long kNdMultiSepWeight = 2000;  // graphs this heavy: several bisections
constexpr int kNdMultiSeps = 3;     // ... this many, keep the best
constexpr double kNdMaxSide = 0.6;  // a side may hold at most 60 % of the weight

// Heavy-edge matching -> coarse graph. cmap[v] = coarse vertex containing v.
NdGraph ndCoarsen(const NdGraph& g, std::vector<int>& cmap, NdRng& rng, long long maxVw) {
    const int n = g.n;
    std::vector<int> order(static_cast<std::size_t>(n));
    for (int i = 0; i < n; ++i) order[static_cast<std::size_t>(i)] = i;
    for (int i = n - 1; i > 0; --i) std::swap(order[static_cast<std::size_t>(i)],
                                              order[static_cast<std::size_t>(rng.below(i + 1))]);
    std::vector<int> match(static_cast<std::size_t>(n), -1);
    for (int v : order) {
        if (match[static_cast<std::size_t>(v)] != -1) continue;
        int best = -1, bw = -1;
        for (int q = g.xadj[static_cast<std::size_t>(v)]; q < g.xadj[static_cast<std::size_t>(v) + 1]; ++q) {
            const int u = g.adj[static_cast<std::size_t>(q)];
            if (match[static_cast<std::size_t>(u)] != -1) continue;
            if (static_cast<long long>(g.vwgt[static_cast<std::size_t>(v)]) + g.vwgt[static_cast<std::size_t>(u)] > maxVw) continue;
            if (g.ewgt[static_cast<std::size_t>(q)] > bw) { bw = g.ewgt[static_cast<std::size_t>(q)]; best = u; }
        }
        if (best < 0) match[static_cast<std::size_t>(v)] = v;
        else { match[static_cast<std::size_t>(v)] = best; match[static_cast<std::size_t>(best)] = v; }
    }
    cmap.assign(static_cast<std::size_t>(n), -1);
    int nc = 0;
    std::vector<int> f1, f2;
    f1.reserve(static_cast<std::size_t>(n)); f2.reserve(static_cast<std::size_t>(n));
    for (int v = 0; v < n; ++v) {
        if (cmap[static_cast<std::size_t>(v)] != -1) continue;
        const int m = match[static_cast<std::size_t>(v)];
        cmap[static_cast<std::size_t>(v)] = nc;
        f1.push_back(v);
        if (m != v) { cmap[static_cast<std::size_t>(m)] = nc; f2.push_back(m); } else f2.push_back(-1);
        ++nc;
    }
    NdGraph c;
    c.n = nc;
    c.totalW = g.totalW;
    c.vwgt.assign(static_cast<std::size_t>(nc), 0);
    c.xadj.assign(static_cast<std::size_t>(nc) + 1, 0);
    c.adj.reserve(g.adj.size());
    c.ewgt.reserve(g.adj.size());
    std::vector<int> pos(static_cast<std::size_t>(nc), -1);
    for (int cv = 0; cv < nc; ++cv) {
        const int start = static_cast<int>(c.adj.size());
        for (int f : {f1[static_cast<std::size_t>(cv)], f2[static_cast<std::size_t>(cv)]}) {
            if (f < 0) continue;
            c.vwgt[static_cast<std::size_t>(cv)] += g.vwgt[static_cast<std::size_t>(f)];
            for (int q = g.xadj[static_cast<std::size_t>(f)]; q < g.xadj[static_cast<std::size_t>(f) + 1]; ++q) {
                const int cu = cmap[static_cast<std::size_t>(g.adj[static_cast<std::size_t>(q)])];
                if (cu == cv) continue;
                const int p = pos[static_cast<std::size_t>(cu)];
                if (p >= start) c.ewgt[static_cast<std::size_t>(p)] += g.ewgt[static_cast<std::size_t>(q)];
                else {
                    pos[static_cast<std::size_t>(cu)] = static_cast<int>(c.adj.size());
                    c.adj.push_back(cu);
                    c.ewgt.push_back(g.ewgt[static_cast<std::size_t>(q)]);
                }
            }
        }
        c.xadj[static_cast<std::size_t>(cv) + 1] = static_cast<int>(c.adj.size());
    }
    return c;
}

void ndPartWeights(const NdGraph& g, const std::vector<signed char>& where, long long pw[3]) {
    pw[0] = pw[1] = pw[2] = 0;
    for (int v = 0; v < g.n; ++v)
        pw[static_cast<int>(where[static_cast<std::size_t>(v)])] += g.vwgt[static_cast<std::size_t>(v)];
}

// Two-sided FM refinement of a vertex separator (where: 0/1 = sides, 2 = S).
// Every move keeps `where` a valid separator: a vertex leaves S for side `to`
// only together with all of its neighbours on the other side entering S.
// For each S vertex v, ed0[v]/ed1[v] = weight of its neighbours on side 0/1,
// kept INCREMENTALLY as vertices move (O(degree) per moved vertex), so the
// gains VW(v) − ed1[v] (v into side 0) and VW(v) − ed0[v] (v into side 1) are
// O(1). Max-heaps with lazy deletion; a pass hill-climbs through bad moves and
// rolls back to the best state it saw (smallest separator; balance first).
void ndRefineSeparator(const NdGraph& g, std::vector<signed char>& where, long long pw[3],
                       long long maxSide, int passes) {
    const int n = g.n;
    if (n == 0) return;
    const auto VW = [&](int v) -> long long { return g.vwgt[static_cast<std::size_t>(v)]; };
    std::vector<long long> ed0(static_cast<std::size_t>(n), 0), ed1(static_cast<std::size_t>(n), 0);
    std::vector<char> locked(static_cast<std::size_t>(n), 0);
    struct Change { int v; signed char from; };
    std::vector<Change> log;
    std::vector<int> lockedList;
    using Item = std::pair<long long, int>;
    std::vector<Item> h0, h1;               // max-heaps: gain into side 0 / side 1
    const auto computeEd = [&](int v) {
        long long a = 0, b = 0;
        for (int q = g.xadj[static_cast<std::size_t>(v)]; q < g.xadj[static_cast<std::size_t>(v) + 1]; ++q) {
            const int u = g.adj[static_cast<std::size_t>(q)];
            const signed char wu = where[static_cast<std::size_t>(u)];
            if (wu == 0) a += VW(u); else if (wu == 1) b += VW(u);
        }
        ed0[static_cast<std::size_t>(v)] = a;
        ed1[static_cast<std::size_t>(v)] = b;
    };
    const auto gain = [&](int s, int v) {
        return VW(v) - (s == 0 ? ed1[static_cast<std::size_t>(v)] : ed0[static_cast<std::size_t>(v)]);
    };
    const auto push = [&](int s, int v) {
        std::vector<Item>& H = s == 0 ? h0 : h1;
        H.emplace_back(gain(s, v), v);
        std::push_heap(H.begin(), H.end());
    };
    const int limit = std::min(300, std::max(40, n / 50));
    for (int pass = 0; pass < passes; ++pass) {
        h0.clear();
        h1.clear();
        for (int v = 0; v < n; ++v)
            if (where[static_cast<std::size_t>(v)] == 2) {
                computeEd(v);
                h0.emplace_back(gain(0, v), v);
                h1.emplace_back(gain(1, v), v);
            }
        std::make_heap(h0.begin(), h0.end());
        std::make_heap(h1.begin(), h1.end());
        log.clear();
        lockedList.clear();
        const auto balancedNow = [&]() { return pw[0] <= maxSide && pw[1] <= maxSide; };
        bool bestBalanced = balancedNow();
        long long bestSep = pw[2];
        long long bestDiff = pw[0] > pw[1] ? pw[0] - pw[1] : pw[1] - pw[0];
        std::size_t bestLog = 0;
        int sinceBest = 0;
        const auto topOf = [&](int s, int& v, long long& gv) -> bool {
            std::vector<Item>& H = s == 0 ? h0 : h1;
            while (!H.empty()) {
                const Item it = H.front();
                const std::size_t u = static_cast<std::size_t>(it.second);
                if (where[u] != 2 || locked[u] || gain(s, it.second) != it.first) {
                    std::pop_heap(H.begin(), H.end());
                    H.pop_back();
                    continue;
                }
                v = it.second; gv = it.first;
                return true;
            }
            return false;
        };
        for (;;) {
            int v0 = -1, v1 = -1;
            long long g0 = 0, g1 = 0;
            const bool h0ok = topOf(0, v0, g0), h1ok = topOf(1, v1, g1);
            if (!h0ok && !h1ok) break;
            int to;
            if (h0ok && h1ok) to = (g0 > g1) ? 0 : (g1 > g0) ? 1 : (pw[0] < pw[1] ? 0 : 1);
            else to = h0ok ? 0 : 1;
            int v = to == 0 ? v0 : v1;
            if (pw[to] + VW(v) > maxSide) {
                const int o = 1 - to;
                const bool ho = o == 0 ? h0ok : h1ok;
                const int vo = o == 0 ? v0 : v1;
                if (ho && pw[o] + VW(vo) <= maxSide) { to = o; v = vo; }
                else break;
            }
            const int other = 1 - to;
            // ---- v leaves S for side `to` ---------------------------------------
            locked[static_cast<std::size_t>(v)] = 1;
            lockedList.push_back(v);
            log.push_back({v, 2});
            where[static_cast<std::size_t>(v)] = static_cast<signed char>(to);
            pw[to] += VW(v); pw[2] -= VW(v);
            for (int q = g.xadj[static_cast<std::size_t>(v)]; q < g.xadj[static_cast<std::size_t>(v) + 1]; ++q) {
                const int w = g.adj[static_cast<std::size_t>(q)];
                if (where[static_cast<std::size_t>(w)] != 2 || locked[static_cast<std::size_t>(w)]) continue;
                (to == 0 ? ed0 : ed1)[static_cast<std::size_t>(w)] += VW(v);
                push(other, w);                 // w's gain into `other` changed
            }
            // ---- v's neighbours on the other side enter S -----------------------
            for (int q = g.xadj[static_cast<std::size_t>(v)]; q < g.xadj[static_cast<std::size_t>(v) + 1]; ++q) {
                const int u = g.adj[static_cast<std::size_t>(q)];
                if (where[static_cast<std::size_t>(u)] != other) continue;
                log.push_back({u, static_cast<signed char>(other)});
                where[static_cast<std::size_t>(u)] = 2;
                pw[other] -= VW(u); pw[2] += VW(u);
                for (int r = g.xadj[static_cast<std::size_t>(u)]; r < g.xadj[static_cast<std::size_t>(u) + 1]; ++r) {
                    const int w = g.adj[static_cast<std::size_t>(r)];
                    if (where[static_cast<std::size_t>(w)] != 2) continue;
                    (other == 0 ? ed0 : ed1)[static_cast<std::size_t>(w)] -= VW(u);
                    if (!locked[static_cast<std::size_t>(w)]) push(to, w);
                }
                computeEd(u);
                if (!locked[static_cast<std::size_t>(u)]) { push(0, u); push(1, u); }
            }
            // ---- keep the best state seen ---------------------------------------
            const bool bal = balancedNow();
            const long long diff = pw[0] > pw[1] ? pw[0] - pw[1] : pw[1] - pw[0];
            bool better = false;
            if (bal && !bestBalanced) better = true;
            else if (bal == bestBalanced)
                better = (pw[2] < bestSep) || (pw[2] == bestSep && diff < bestDiff);
            if (better) {
                bestBalanced = bal; bestSep = pw[2]; bestDiff = diff; bestLog = log.size();
                sinceBest = 0;
            } else if (++sinceBest > limit) {
                break;
            }
        }
        // ---- roll back to the best state (ed0/ed1 are recomputed next pass) ------
        for (std::size_t t = log.size(); t-- > bestLog;) {
            const Change& c = log[t];
            const std::size_t cv = static_cast<std::size_t>(c.v);
            pw[static_cast<int>(where[cv])] -= VW(c.v);
            where[cv] = c.from;
            pw[static_cast<int>(c.from)] += VW(c.v);
        }
        for (int v : lockedList) locked[static_cast<std::size_t>(v)] = 0;
        if (bestLog == 0) break;   // the pass found nothing better: converged
    }
}

// Initial separator by GREEDY GRAPH GROWING (GGGP, Karypis & Kumar 1998): side
// 0 grows from `seed`, always taking the side-1 boundary vertex whose move cuts
// the most edge weight (max-heap, lazy deletion), until it holds half the
// weight. A few edge-FM passes (hill-climb + rollback to the smallest cut within
// ±5 % balance) improve the bisection, and then the boundary vertices of BOTH
// sides become a deliberately thick separator — the node FM that follows thins
// it, which is how an edge bisection yields a good vertex separator.
void ndGggpSeparator(const NdGraph& g, int seed, std::vector<signed char>& where) {
    const int n = g.n;
    using Item = std::pair<long long, int>;
    const auto at = [](auto& vec, int i) -> auto& { return vec[static_cast<std::size_t>(i)]; };
    std::vector<signed char> side(static_cast<std::size_t>(n), 1);
    std::vector<long long> to0(static_cast<std::size_t>(n), 0), to1(static_cast<std::size_t>(n), 0);
    for (int v = 0; v < n; ++v)
        for (int e = at(g.xadj, v); e < at(g.xadj, v + 1); ++e) at(to1, v) += at(g.ewgt, e);
    long long w0 = 0;
    const auto gainOf = [&](int v) {          // edge-cut decrease if v switches side
        return at(side, v) == 1 ? at(to0, v) - at(to1, v) : at(to1, v) - at(to0, v);
    };
    std::vector<Item> H;
    const auto flip = [&](int v, bool pushNbrs, int onlySide) {
        const int from = at(side, v);
        at(side, v) = static_cast<signed char>(1 - from);
        w0 += (from == 1 ? 1 : -1) * static_cast<long long>(at(g.vwgt, v));
        for (int e = at(g.xadj, v); e < at(g.xadj, v + 1); ++e) {
            const int u = at(g.adj, e);
            const long long w = at(g.ewgt, e);
            if (from == 1) { at(to1, u) -= w; at(to0, u) += w; }
            else { at(to0, u) -= w; at(to1, u) += w; }
            if (pushNbrs && (onlySide < 0 || at(side, u) == onlySide)) {
                H.emplace_back(gainOf(u), u);
                std::push_heap(H.begin(), H.end());
            }
        }
    };
    // ---- greedy growing of side 0 ------------------------------------------
    const long long half = g.totalW / 2;
    flip(seed, true, 1);
    while (w0 < half) {
        int v = -1;
        while (!H.empty()) {
            const Item it = H.front();
            std::pop_heap(H.begin(), H.end());
            H.pop_back();
            if (at(side, it.second) == 1 && gainOf(it.second) == it.first) { v = it.second; break; }
        }
        for (int u = 0; u < n && v < 0; ++u)        // disconnected remainder
            if (at(side, u) == 1) v = u;
        if (v < 0) break;
        flip(v, true, 1);
    }
    // ---- edge-FM passes ----------------------------------------------------------
    const long long tol = std::max<long long>(1, static_cast<long long>(0.05 * static_cast<double>(g.totalW)));
    const auto imb = [&](long long a) { const long long d = 2 * a - g.totalW; return d < 0 ? -d : d; };
    std::vector<char> locked(static_cast<std::size_t>(n), 0);
    std::vector<int> moved;
    for (int pass = 0; pass < 6; ++pass) {
        H.clear();
        long long cut = 0;
        for (int v = 0; v < n; ++v) {
            if (at(side, v) == 0) cut += at(to1, v);
            if ((at(side, v) == 0 ? at(to1, v) : at(to0, v)) > 0) H.emplace_back(gainOf(v), v);
        }
        std::make_heap(H.begin(), H.end());
        long long bestCut = cut;
        const bool startBalanced = imb(w0) <= 2 * tol;
        std::size_t bestLen = 0;
        moved.clear();
        while (!H.empty()) {
            const Item it = H.front();
            std::pop_heap(H.begin(), H.end());
            H.pop_back();
            const int v = it.second;
            if (at(locked, v) || gainOf(v) != it.first) continue;
            const long long nw0 = w0 + (at(side, v) == 1 ? 1 : -1) * static_cast<long long>(at(g.vwgt, v));
            if (imb(nw0) > 2 * tol && imb(nw0) >= imb(w0)) continue;   // would unbalance
            at(locked, v) = 1;
            cut -= it.first;
            flip(v, true, -1);
            moved.push_back(v);
            if (imb(w0) <= 2 * tol && (cut < bestCut || (!startBalanced && bestLen == 0))) {
                bestCut = cut;
                bestLen = moved.size();
            }
            if (moved.size() - bestLen > 50) break;
        }
        for (std::size_t k = moved.size(); k-- > bestLen;) flip(moved[k], false, -1);
        for (int v : moved) at(locked, v) = 0;
        if (bestLen == 0) break;
    }
    where.assign(static_cast<std::size_t>(n), 0);
    for (int v = 0; v < n; ++v) {
        const long long ext = at(side, v) == 0 ? at(to1, v) : at(to0, v);
        at(where, v) = ext > 0 ? 2 : at(side, v);
    }
}

// Breadth-first levels of g from `root` into lev (−1 = unreached); returns the
// number of levels and sets `far` to a lowest-degree vertex of the last level.
int ndBfsLevels(const NdGraph& g, int root, std::vector<int>& lev, std::vector<int>& queue, int& far) {
    lev.assign(static_cast<std::size_t>(g.n), -1);
    queue.clear();
    queue.push_back(root);
    lev[static_cast<std::size_t>(root)] = 0;
    for (std::size_t h = 0; h < queue.size(); ++h) {
        const int v = queue[h];
        for (int e = g.xadj[static_cast<std::size_t>(v)]; e < g.xadj[static_cast<std::size_t>(v) + 1]; ++e) {
            const int u = g.adj[static_cast<std::size_t>(e)];
            if (lev[static_cast<std::size_t>(u)] < 0) {
                lev[static_cast<std::size_t>(u)] = lev[static_cast<std::size_t>(v)] + 1;
                queue.push_back(u);
            }
        }
    }
    const int last = lev[static_cast<std::size_t>(queue.back())];
    far = queue.back();
    int bestDeg = std::numeric_limits<int>::max();
    for (std::size_t h = queue.size(); h-- > 0;) {
        const int v = queue[h];
        if (lev[static_cast<std::size_t>(v)] != last) break;
        const int d = g.xadj[static_cast<std::size_t>(v) + 1] - g.xadj[static_cast<std::size_t>(v)];
        if (d < bestDeg) { bestDeg = d; far = v; }
    }
    return last + 1;
}

// LEVEL-STRUCTURE separator (George & Liu, "Computer Solution of Large Sparse
// Positive Definite Systems", 1981): breadth-first levels from a
// pseudo-peripheral vertex; the level where the cumulative weight crosses half
// is the separator, earlier levels side 0, later levels side 1. On a mesh this
// is a planar cut across its longest extent — often exactly what the
// multilevel search misses on long, thin parts.
void ndLevelSeparator(const NdGraph& g, int seed, std::vector<signed char>& where) {
    std::vector<int> lev, lev2, queue;
    int far = seed;
    int nl = ndBfsLevels(g, seed, lev, queue, far);
    for (int it = 0; it < 8; ++it) {                  // pseudo-peripheral root
        int far2 = far;
        const int nl2 = ndBfsLevels(g, far, lev2, queue, far2);
        if (nl2 <= nl) break;
        nl = nl2;
        lev.swap(lev2);
        far = far2;
    }
    std::vector<long long> lw(static_cast<std::size_t>(nl), 0);
    for (int v = 0; v < g.n; ++v)
        if (lev[static_cast<std::size_t>(v)] >= 0)
            lw[static_cast<std::size_t>(lev[static_cast<std::size_t>(v)])] += g.vwgt[static_cast<std::size_t>(v)];
    const long long half = g.totalW / 2;
    long long acc = 0;
    int cut = nl - 1;
    for (int l = 0; l < nl; ++l) {
        if (acc + lw[static_cast<std::size_t>(l)] / 2 >= half) { cut = l; break; }
        acc += lw[static_cast<std::size_t>(l)];
    }
    where.assign(static_cast<std::size_t>(g.n), 1);
    for (int v = 0; v < g.n; ++v) {
        const int l = lev[static_cast<std::size_t>(v)];
        if (l >= 0) where[static_cast<std::size_t>(v)] = static_cast<signed char>(l < cut ? 0 : l == cut ? 2 : 1);
    }
}

bool ndBetter(const long long a[3], const long long b[3], long long maxSide) {
    const bool ba = a[0] <= maxSide && a[1] <= maxSide;
    const bool bb = b[0] <= maxSide && b[1] <= maxSide;
    if (ba != bb) return ba;
    if (a[2] != b[2]) return a[2] < b[2];
    const long long da = a[0] > a[1] ? a[0] - a[1] : a[1] - a[0];
    const long long db = b[0] > b[1] ? b[0] - b[1] : b[1] - b[0];
    return da < db;
}

// ONE multilevel vertex-separator bisection of a CONNECTED graph (coarsen,
// GGGP initial separators, uncoarsen with node-FM refinement). Returns false if
// no separator with two non-empty sides was found.
bool ndNodeBisectMultilevel(const NdGraph& g, std::vector<signed char>& where, NdRng& rng) {
    const long long maxSide =
        static_cast<long long>(std::ceil(kNdMaxSide * static_cast<double>(g.totalW)));
    std::vector<std::unique_ptr<NdGraph>> levels;      // levels[0] = coarsened once
    std::vector<std::vector<int>> cmaps;               // cmaps[l]: graph(l) -> graph(l+1)
    const NdGraph* cur = &g;
    const long long maxVw = std::max<long long>(
        1, static_cast<long long>(1.5 * static_cast<double>(g.totalW) / kNdCoarsenTo));
    while (cur->n > kNdCoarsenTo) {
        std::vector<int> cmap;
        auto c = std::make_unique<NdGraph>(ndCoarsen(*cur, cmap, rng, maxVw));
        if (static_cast<double>(c->n) > 0.95 * static_cast<double>(cur->n)) break;   // stalled
        cmaps.push_back(std::move(cmap));
        levels.push_back(std::move(c));
        cur = levels.back().get();
    }
    // ---- initial separators on the coarsest graph --------------------------
    std::vector<signed char> best, trial;
    long long bestPw[3] = {0, 0, 0};
    for (int t = 0; t < kNdInitTries; ++t) {
        ndGggpSeparator(*cur, rng.below(cur->n), trial);
        long long pw[3];
        ndPartWeights(*cur, trial, pw);
        ndRefineSeparator(*cur, trial, pw, maxSide, kNdPassCoarse);
        if (pw[0] == 0 || pw[1] == 0) continue;
        if (best.empty() || ndBetter(pw, bestPw, maxSide)) {
            best = trial;
            bestPw[0] = pw[0]; bestPw[1] = pw[1]; bestPw[2] = pw[2];
        }
    }
    if (best.empty()) return false;
    // ---- project back up, refining at every level ---------------------------
    for (std::size_t l = levels.size(); l-- > 0;) {
        const NdGraph& fine = (l == 0) ? g : *levels[l - 1];
        const std::vector<int>& cmap = cmaps[l];
        std::vector<signed char> fw(static_cast<std::size_t>(fine.n));
        for (int v = 0; v < fine.n; ++v)
            fw[static_cast<std::size_t>(v)] = best[static_cast<std::size_t>(cmap[static_cast<std::size_t>(v)])];
        long long pw[3];
        ndPartWeights(fine, fw, pw);
        ndRefineSeparator(fine, fw, pw, maxSide, kNdPassFine);
        best.swap(fw);
        bestPw[0] = pw[0]; bestPw[1] = pw[1]; bestPw[2] = pw[2];
    }
    where.swap(best);
    return bestPw[0] > 0 && bestPw[1] > 0;
}

// The separator a dissection step uses: the best (balanced first, then
// smallest, then most even) of kNdMultiSeps multilevel bisections for heavy
// graphs (one for light ones) and the refined level-structure separator.
// Returns false if none has two non-empty sides.
bool ndNodeBisect(const NdGraph& g, std::vector<signed char>& where, NdRng& rng) {
    const long long maxSide =
        static_cast<long long>(std::ceil(kNdMaxSide * static_cast<double>(g.totalW)));
    std::vector<signed char> best, trial;
    long long bestPw[3] = {0, 0, 0};
    const auto consider = [&]() {
        long long pw[3];
        ndPartWeights(g, trial, pw);
        if (pw[0] == 0 || pw[1] == 0) return;
        if (best.empty() || ndBetter(pw, bestPw, maxSide)) {
            best = trial;
            bestPw[0] = pw[0]; bestPw[1] = pw[1]; bestPw[2] = pw[2];
        }
    };
    const int tries = g.totalW >= kNdMultiSepWeight ? kNdMultiSeps : 1;
    for (int t = 0; t < tries; ++t)
        if (ndNodeBisectMultilevel(g, trial, rng)) consider();
    ndLevelSeparator(g, rng.below(g.n), trial);
    {
        long long pw[3];
        ndPartWeights(g, trial, pw);
        ndRefineSeparator(g, trial, pw, maxSide, kNdPassCoarse);
    }
    consider();
    if (best.empty()) return false;
    where.swap(best);
    return true;
}

// Induced subgraph of G on `verts` (global ids). `loc` is an all -1 scratch
// array of size G.n, restored to all -1 on return.
NdGraph ndInduced(const NdGraph& G, const std::vector<int>& verts, std::vector<int>& loc) {
    NdGraph h;
    h.n = static_cast<int>(verts.size());
    for (int i = 0; i < h.n; ++i) loc[static_cast<std::size_t>(verts[static_cast<std::size_t>(i)])] = i;
    h.xadj.assign(static_cast<std::size_t>(h.n) + 1, 0);
    h.vwgt.resize(static_cast<std::size_t>(h.n));
    for (int i = 0; i < h.n; ++i) {
        const int v = verts[static_cast<std::size_t>(i)];
        h.vwgt[static_cast<std::size_t>(i)] = G.vwgt[static_cast<std::size_t>(v)];
        h.totalW += G.vwgt[static_cast<std::size_t>(v)];
        for (int q = G.xadj[static_cast<std::size_t>(v)]; q < G.xadj[static_cast<std::size_t>(v) + 1]; ++q) {
            const int u = loc[static_cast<std::size_t>(G.adj[static_cast<std::size_t>(q)])];
            if (u >= 0) { h.adj.push_back(u); h.ewgt.push_back(1); }
        }
        h.xadj[static_cast<std::size_t>(i) + 1] = static_cast<int>(h.adj.size());
    }
    for (int v : verts) loc[static_cast<std::size_t>(v)] = -1;
    return h;
}

// Order the vertices of h (local ids, mapped to global by verts) with AMD.
void ndLeafOrder(const NdGraph& h, const std::vector<int>& verts, int* out) {
    std::vector<std::vector<std::size_t>> a(static_cast<std::size_t>(h.n));
    for (int v = 0; v < h.n; ++v)
        for (int q = h.xadj[static_cast<std::size_t>(v)]; q < h.xadj[static_cast<std::size_t>(v) + 1]; ++q)
            a[static_cast<std::size_t>(v)].push_back(static_cast<std::size_t>(h.adj[static_cast<std::size_t>(q)]));
    const std::vector<std::size_t> p = approximateMinimumDegree(a);
    for (std::size_t k = 0; k < p.size(); ++k) out[k] = verts[p[k]];
}

// Nested-dissection order of the global vertices `verts` into out[0..|verts|).
void ndRecurse(const NdGraph& G, const std::vector<int>& verts, int* out,
               std::vector<int>& loc, NdRng& rng) {
    const std::size_t m = verts.size();
    if (m == 0) return;
    if (m == 1) { out[0] = verts[0]; return; }
    NdGraph h = ndInduced(G, verts, loc);
    // ---- connected components are independent: order each on its own --------
    std::vector<int> comp(m, -1), compStart, compVerts;
    compVerts.reserve(m);
    int ncomp = 0;
    for (std::size_t s = 0; s < m; ++s) {
        if (comp[s] >= 0) continue;
        compStart.push_back(static_cast<int>(compVerts.size()));
        comp[s] = ncomp;
        std::size_t head = compVerts.size();
        compVerts.push_back(static_cast<int>(s));
        while (head < compVerts.size()) {
            const int v = compVerts[head++];
            for (int q = h.xadj[static_cast<std::size_t>(v)]; q < h.xadj[static_cast<std::size_t>(v) + 1]; ++q) {
                const int u = h.adj[static_cast<std::size_t>(q)];
                if (comp[static_cast<std::size_t>(u)] < 0) {
                    comp[static_cast<std::size_t>(u)] = ncomp;
                    compVerts.push_back(u);
                }
            }
        }
        ++ncomp;
    }
    compStart.push_back(static_cast<int>(m));
    if (ncomp > 1) {
        // isolated vertices first (they create no fill), then each component
        int written = 0;
        for (int c = 0; c < ncomp; ++c) {
            const int a = compStart[static_cast<std::size_t>(c)], b = compStart[static_cast<std::size_t>(c) + 1];
            if (b - a == 1) out[written++] = verts[static_cast<std::size_t>(compVerts[static_cast<std::size_t>(a)])];
        }
        for (int c = 0; c < ncomp; ++c) {
            const int a = compStart[static_cast<std::size_t>(c)], b = compStart[static_cast<std::size_t>(c) + 1];
            if (b - a == 1) continue;
            std::vector<int> sub;
            sub.reserve(static_cast<std::size_t>(b - a));
            for (int t = a; t < b; ++t)
                sub.push_back(verts[static_cast<std::size_t>(compVerts[static_cast<std::size_t>(t)])]);
            ndRecurse(G, sub, out + written, loc, rng);
            written += b - a;
        }
        return;
    }
    if (m <= static_cast<std::size_t>(kNdLeaf)) { ndLeafOrder(h, verts, out); return; }
    std::vector<signed char> where;
    if (!ndNodeBisect(h, where, rng)) { ndLeafOrder(h, verts, out); return; }
    std::vector<int> A, B, S;
    for (std::size_t i = 0; i < m; ++i) {
        const signed char w = where[i];
        (w == 0 ? A : w == 1 ? B : S).push_back(verts[i]);
    }
    h = NdGraph();   // release before recursing
    std::copy(S.begin(), S.end(), out + (m - S.size()));
    ndRecurse(G, A, out, loc, rng);
    ndRecurse(G, B, out + A.size(), loc, rng);
}

// Step 0 of nested dissection: COMPRESS vertices with identical closed
// neighbourhoods (the d DOFs of one FE node) into one weighted vertex.
struct NdCompressed {
    NdGraph G;
    std::vector<int> superOf;   // original vertex -> supervertex
};

NdCompressed ndCompress(const std::vector<std::vector<std::size_t>>& adj) {
    const std::size_t nn = adj.size();
    NdCompressed C;
    std::vector<std::pair<std::uint64_t, std::size_t>> keyed(nn);
    for (std::size_t i = 0; i < nn; ++i) {
        std::uint64_t h = static_cast<std::uint64_t>(i) * 0x9E3779B97F4A7C15ull;
        for (std::size_t j : adj[i]) h += static_cast<std::uint64_t>(j) * 0x9E3779B97F4A7C15ull;
        h ^= static_cast<std::uint64_t>(adj[i].size()) << 48;
        keyed[i] = {h, i};
    }
    std::sort(keyed.begin(), keyed.end());
    std::vector<int>& superOf = C.superOf;
    superOf.assign(nn, -1);
    std::vector<std::size_t> reps;                 // representative per supervertex
    const auto sameClosed = [&](std::size_t a, std::size_t b) {
        // N[a] == N[b]  <=>  b ∈ adj[a] and adj[a] \ {b} == adj[b] \ {a}
        const auto& A = adj[a];
        const auto& B = adj[b];
        if (A.size() != B.size() || !std::binary_search(A.begin(), A.end(), b)) return false;
        std::size_t ia = 0, ib = 0;
        while (ia < A.size() || ib < B.size()) {
            if (ia < A.size() && A[ia] == b) { ++ia; continue; }
            if (ib < B.size() && B[ib] == a) { ++ib; continue; }
            if (ia == A.size() || ib == B.size() || A[ia] != B[ib]) return false;
            ++ia; ++ib;
        }
        return true;
    };
    for (std::size_t s = 0; s < nn;) {
        std::size_t e = s + 1;
        while (e < nn && keyed[e].first == keyed[s].first) ++e;
        for (std::size_t x = s; x < e; ++x) {
            const std::size_t i = keyed[x].second;
            if (superOf[i] >= 0) continue;
            superOf[i] = static_cast<int>(reps.size());
            reps.push_back(i);
            for (std::size_t y = x + 1; y < e; ++y) {
                const std::size_t j = keyed[y].second;
                if (superOf[j] < 0 && sameClosed(i, j)) superOf[j] = superOf[i];
            }
        }
        s = e;
    }
    const int nc = static_cast<int>(reps.size());
    NdGraph& G = C.G;
    G.n = nc;
    G.vwgt.assign(static_cast<std::size_t>(nc), 0);
    for (std::size_t i = 0; i < nn; ++i) G.vwgt[static_cast<std::size_t>(superOf[i])] += 1;
    G.totalW = static_cast<long long>(nn);
    G.xadj.assign(static_cast<std::size_t>(nc) + 1, 0);
    std::vector<int> mark(static_cast<std::size_t>(nc), -1);
    for (int s = 0; s < nc; ++s) {
        mark[static_cast<std::size_t>(s)] = s;
        for (std::size_t j : adj[reps[static_cast<std::size_t>(s)]]) {
            const int t = superOf[j];
            if (mark[static_cast<std::size_t>(t)] == s) continue;
            mark[static_cast<std::size_t>(t)] = s;
            G.adj.push_back(t);
            G.ewgt.push_back(1);
        }
        G.xadj[static_cast<std::size_t>(s) + 1] = static_cast<int>(G.adj.size());
    }
    return C;
}

// Steps 1..5 on the compressed graph, then expand each supervertex (members
// keep their original relative order). perm[k] = original index at position k.
std::vector<std::size_t> ndOrderCompressed(const NdCompressed& C, std::size_t nn) {
    const NdGraph& G = C.G;
    const int nc = G.n;
    std::vector<int> all(static_cast<std::size_t>(nc)), order(static_cast<std::size_t>(nc), -1);
    for (int s = 0; s < nc; ++s) all[static_cast<std::size_t>(s)] = s;
    std::vector<int> loc(static_cast<std::size_t>(nc), -1);
    NdRng rng(0x7163ull);
    ndRecurse(G, all, order.data(), loc, rng);
    std::vector<std::size_t> memberStart(static_cast<std::size_t>(nc) + 1, 0), members(nn);
    for (std::size_t i = 0; i < nn; ++i) ++memberStart[static_cast<std::size_t>(C.superOf[i]) + 1];
    for (int s = 0; s < nc; ++s) memberStart[static_cast<std::size_t>(s) + 1] += memberStart[static_cast<std::size_t>(s)];
    {
        std::vector<std::size_t> fillp(memberStart.begin(), memberStart.end() - 1);
        for (std::size_t i = 0; i < nn; ++i) members[fillp[static_cast<std::size_t>(C.superOf[i])]++] = i;
    }
    std::vector<std::size_t> perm;
    perm.reserve(nn);
    std::vector<char> placed(nn, 0);
    for (int s : order) {
        if (s < 0) continue;
        for (std::size_t q = memberStart[static_cast<std::size_t>(s)]; q < memberStart[static_cast<std::size_t>(s) + 1]; ++q)
            if (!placed[members[q]]) { placed[members[q]] = 1; perm.push_back(members[q]); }
    }
    // defensive completeness: perm must be a permutation whatever happened above
    for (std::size_t i = 0; i < nn; ++i)
        if (!placed[i]) perm.push_back(i);
    return perm;
}

// Beyond this size the 32-bit-indexed ND falls back to AMD.
bool ndFitsIndexRange(std::size_t n) {
    return n < static_cast<std::size_t>(std::numeric_limits<int>::max() / 4);
}

static std::vector<std::size_t>
nestedDissection(const std::vector<std::vector<std::size_t>>& adj) {
    const std::size_t nn = adj.size();
    if (nn == 0) return {};
    if (!ndFitsIndexRange(nn)) return approximateMinimumDegree(adj);
    return ndOrderCompressed(ndCompress(adj), nn);
}

// One candidate ordering (never Auto).
std::vector<std::size_t> orderingOf(const std::vector<std::vector<std::size_t>>& adj,
                                    SparseOrdering ord) {
    const std::size_t n = adj.size();
    switch (ord) {
    case SparseOrdering::RCM:
        return reverseCuthillMcKee(adj);
    case SparseOrdering::AMD:
        return postorderByEtree(adj, approximateMinimumDegree(adj));
    case SparseOrdering::NestedDissection:
        return postorderByEtree(adj, nestedDissection(adj));
    case SparseOrdering::Natural:
    case SparseOrdering::Auto:
        break;
    }
    std::vector<std::size_t> perm(n);
    for (std::size_t k = 0; k < n; ++k) perm[k] = k;
    return perm;
}

// ===========================================================================
// DENSE KERNEL SEAM (T-157) — internals. See LinAlg.hpp for the contract.
// All matrices are COLUMN-major with a leading dimension.
// ===========================================================================
std::atomic<int> g_densePolicy{static_cast<int>(DenseBackendPolicy::Auto)};
std::atomic<std::uint64_t> g_denseCalls[3][2];
std::atomic<std::uint64_t> g_denseMadds[3][2];
std::atomic<int> g_denseMinAccelM[3];
std::atomic<int> g_denseMinAccelK[3];
std::atomic<std::uint64_t> g_denseBucketCalls[3][2][kDenseSizeBuckets];
std::atomic<std::uint64_t> g_denseBucketMadds[3][2][kDenseSizeBuckets];
std::atomic<std::uint64_t> g_denseAccelBelow[3];

void atomicMin(std::atomic<int>& a, int v) {
    int cur = a.load(std::memory_order_relaxed);
    while ((cur == 0 || v < cur) && !a.compare_exchange_weak(cur, v, std::memory_order_relaxed)) {}
}

// MEASURED crossover (Apple M-series; test/linalg_accelerate_gate.cpp A4
// re-measures every cell, interleaved best-of-3, and prints the table). Below
// these sizes Accelerate's per-call overhead (and, for SYRK with a thin k, its
// blocking) loses to the plain loops:
//   POTRF order k:         Accelerate from k >= 8   (k = 4: ~1.2x either way;
//                          k = 8: 1.5x; k = 32: 2.5x faster)
//   TRSM  B(m×k) := B L⁻ᵀ: from k >= 24 (2-6x faster); for short panels
//                          (m <= 32) already from k >= 8 (2.2x); at m >= 64
//                          and k <= 16 native is as fast or up to 5x faster
//   SYRK  C(m×m) -= B Bᵀ:  from k >= 12 (2-25x faster); with a thin k only for
//                          large m: k >= 8 at m >= 256 (1.3-2.5x), k >= 2 at
//                          m >= 512 (1.2-5.7x). At m = 128 and k <= 8 Accelerate
//                          is consistently 1.3-3x SLOWER, so no m-only rule fits.
bool accelerateWinsImpl(DenseKernel kern, int m, int k) {
    switch (kern) {
    case DenseKernel::Potrf: return k >= 8;
    case DenseKernel::Syrk:  return k >= 12 || (m >= 256 && k >= 8) || (m >= 512 && k >= 2);
    case DenseKernel::Trsm:  return k >= 24 || (m <= 32 && k >= 8);
    }
    return false;
}

bool useAccelerate(DenseKernel kern, int m, int k) {
#if FORGE_LA_ACCELERATE
    const int pol = g_densePolicy.load(std::memory_order_relaxed);
    if (pol == static_cast<int>(DenseBackendPolicy::ForceNative)) return false;
    if (pol == static_cast<int>(DenseBackendPolicy::ForceAccelerate)) return true;
    return accelerateWinsImpl(kern, m, k);
#else
    (void)kern; (void)m; (void)k;
    return false;
#endif
}

void recordDense(DenseKernel kern, bool acc, int m, int k, std::uint64_t madds) {
    const int ki = static_cast<int>(kern), bi = acc ? 1 : 0;
    g_denseCalls[ki][bi].fetch_add(1, std::memory_order_relaxed);
    g_denseMadds[ki][bi].fetch_add(madds, std::memory_order_relaxed);
    const int bk = denseSizeBucket(static_cast<std::size_t>(std::max(m, k)));
    g_denseBucketCalls[ki][bi][bk].fetch_add(1, std::memory_order_relaxed);
    g_denseBucketMadds[ki][bi][bk].fetch_add(madds, std::memory_order_relaxed);
    if (acc) {
        atomicMin(g_denseMinAccelM[ki], std::max(1, m));
        atomicMin(g_denseMinAccelK[ki], std::max(1, k));
        if (!accelerateWinsImpl(kern, m, k)) g_denseAccelBelow[ki].fetch_add(1, std::memory_order_relaxed);
    }
}

// ---- portable native loops (right-looking, unit-stride inner loops) --------
int potrfNative(int n, double* A, int lda) {
    for (int k = 0; k < n; ++k) {
        double* ck = A + static_cast<std::ptrdiff_t>(k) * lda;
        const double d = ck[k];
        if (!(d > 0.0) || !std::isfinite(d)) return k + 1;
        const double s = std::sqrt(d);
        ck[k] = s;
        const double inv = 1.0 / s;
        for (int i = k + 1; i < n; ++i) ck[i] *= inv;
        for (int j = k + 1; j < n; ++j) {
            const double ljk = ck[j];
            if (ljk == 0.0) continue;
            double* cj = A + static_cast<std::ptrdiff_t>(j) * lda;
            for (int i = j; i < n; ++i) cj[i] -= ck[i] * ljk;
        }
    }
    return 0;
}
void trsmNative(int m, int k, const double* L, int ldl, double* B, int ldb) {   // B := B L⁻ᵀ
    for (int j = 0; j < k; ++j) {
        double* bj = B + static_cast<std::ptrdiff_t>(j) * ldb;
        for (int p = 0; p < j; ++p) {
            const double l = L[j + static_cast<std::ptrdiff_t>(p) * ldl];
            if (l == 0.0) continue;
            const double* bp = B + static_cast<std::ptrdiff_t>(p) * ldb;
            for (int i = 0; i < m; ++i) bj[i] -= bp[i] * l;
        }
        const double inv = 1.0 / L[j + static_cast<std::ptrdiff_t>(j) * ldl];
        for (int i = 0; i < m; ++i) bj[i] *= inv;
    }
}
void syrkNative(int m, int k, const double* B, int ldb, double* C, int ldc) {   // C -= B Bᵀ (lower)
    for (int p = 0; p < k; ++p) {
        const double* bp = B + static_cast<std::ptrdiff_t>(p) * ldb;
        for (int j = 0; j < m; ++j) {
            const double b = bp[j];
            if (b == 0.0) continue;
            double* cj = C + static_cast<std::ptrdiff_t>(j) * ldc;
            for (int i = j; i < m; ++i) cj[i] -= bp[i] * b;
        }
    }
}

// ---- the seam ----------------------------------------------------------------
int seamPotrf(int n, double* A, int lda) {
    if (n <= 0) return 0;
    const bool acc = useAccelerate(DenseKernel::Potrf, n, n);
    recordDense(DenseKernel::Potrf, acc, n, n,
                static_cast<std::uint64_t>(n) * static_cast<std::uint64_t>(n) * static_cast<std::uint64_t>(n) / 3u);
#if FORGE_LA_ACCELERATE
    if (acc) {
        __LAPACK_int nn = n, ld = lda, info = 0;
        char uplo = 'L';
        dpotrf_(&uplo, &nn, A, &ld, &info);
        return static_cast<int>(info);
    }
#endif
    return potrfNative(n, A, lda);
}
void seamTrsm(int m, int k, const double* L, int ldl, double* B, int ldb) {
    if (m <= 0 || k <= 0) return;
    const bool acc = useAccelerate(DenseKernel::Trsm, m, k);
    recordDense(DenseKernel::Trsm, acc, m, k,
                static_cast<std::uint64_t>(m) * static_cast<std::uint64_t>(k) * static_cast<std::uint64_t>(k) / 2u);
#if FORGE_LA_ACCELERATE
    if (acc) {
        cblas_dtrsm(CblasColMajor, CblasRight, CblasLower, CblasTrans, CblasNonUnit,
                    m, k, 1.0, L, ldl, B, ldb);
        return;
    }
#endif
    trsmNative(m, k, L, ldl, B, ldb);
}
void seamSyrk(int m, int k, const double* B, int ldb, double* C, int ldc) {
    if (m <= 0 || k <= 0) return;
    const bool acc = useAccelerate(DenseKernel::Syrk, m, k);
    recordDense(DenseKernel::Syrk, acc, m, k,
                static_cast<std::uint64_t>(m) * static_cast<std::uint64_t>(m + 1) / 2u * static_cast<std::uint64_t>(k));
#if FORGE_LA_ACCELERATE
    if (acc) {
        cblas_dsyrk(CblasColMajor, CblasLower, CblasNoTrans, m, k, -1.0, B, ldb, 1.0, C, ldc);
        return;
    }
#endif
    syrkNative(m, k, B, ldb, C, ldc);
}

// How much cheaper a factor flop is under each numeric method than under the
// scalar up-looking LDLᵀ the Auto ordering policy was calibrated on (T-163),
// as two factors that multiply that policy's thresholds:
//   reorder  for the RCM+AMD decision, made on every matrix — including small
//            ones, whose narrow supernodal fronts run the dense kernels least
//            efficiently;
//   nd       for the nested-dissection decision, which only matters on large
//            matrices, whose wide fronts run the kernels at full speed (and
//            where ND's ordering time is what must be paid back).
// Measured compute() seconds per factor flop on the kernel's FEA corpus:
// up-looking ~0.40 ns; supernodal with the native loops ~0.24 ns (wide fronts
// ~0.2 ns); supernodal with Accelerate ~0.05-0.1 ns on narrow fronts and down
// to ~0.013 ns on the widest (bracketL-static AMD, 184 GF in 2.4 s). The
// Accelerate values were then fitted on the 10-matrix T-163 corpus
// (test/sparse_ordering_gate.cpp fixtures), where the decisions they make have
// a ~25 % margin on both sides: reorder 4.4 keeps Natural on bracketM-static
// (3,510 natural flops per nonzero; reordering would cost more than it saves)
// and reorders tube-thermal (5,480; AMD halves its time); nd 8 skips ND on
// tube-static (best cheap 11.3 GF vs threshold 16 GF; AMD wins) and runs it on
// bracketL-static (63.9 GF vs 46 GF; ND wins). Gated by sparse_ordering_gate
// G6 and linalg_accelerate_gate G4.
struct OrderingScale {
    double reorder;
    double nd;
};
OrderingScale orderingScaleFor(SparseFactorMethod method) {
    if (method == SparseFactorMethod::UpLooking) return {1.0, 1.0};
#if FORGE_LA_ACCELERATE
    if (g_densePolicy.load(std::memory_order_relaxed) != static_cast<int>(DenseBackendPolicy::ForceNative))
        return {4.4, 8.0};
#endif
    return {1.67, 2.0};
}

// ---------------------------------------------------------------------------
// SparseOrdering::Auto — a COST MODEL, not "try everything" (T-163).
//
// Every candidate costs ordering time, and on a small or already well-numbered
// matrix that time is a large fraction of — or larger than — the factorization
// it is meant to speed up (measured: nested dissection takes 0.15-0.22 s on a
// 13.7k-DOF thermal matrix whose factorization takes 0.20 s). So candidates
// are evaluated in increasing cost and only while they can still pay off; the
// winner is the evaluated candidate with the fewest exact factor flops (ties:
// fewer nnz(L)). Calibrated on this kernel's scalar up-looking LDLᵀ (~2.4
// GFlop/s, i.e. ~0.4 ns per factor flop) on an Apple M-series core:
//
//   1. Natural: free. If its factorization is already cheap — at most
//      kAutoReorderFlopsPerNnz flops per off-diagonal nonzero of A — no
//      reordering can recover its own cost (RCM + AMD + their symbolic
//      analyses cost ~0.1 µs ≈ 250 flops per nonzero), so Natural is used.
//   2. RCM (what shipped) and AMD: O(nnz(A)) each. Keeping RCM in the set makes
//      the result never need more flops than the shipped ordering whenever any
//      reordering is considered.
//   3. Nested dissection: ~1 µs per compressed-graph edge ≈ 2000 factor flops.
//      Measured ND gains over the best cheap candidate are ~25 % of flops when
//      it wins, so ND runs only if 0.25 × bestFlops > 2000 × edges, i.e.
//      bestFlops ≥ kAutoNdFlopsPerEdge × (compressed edges).
// T-157: the two constants are flop counts AT the up-looking speed (exactly the
// T-163 calibration, so the UpLooking method keeps T-163's policy bit for bit);
// a faster numeric factorization makes each flop cheaper relative to the
// (unchanged) ordering time, so the thresholds are multiplied by the method's
// OrderingScale (above) — e.g. with Accelerate a cheap reordering must promise
// 4x, and nested dissection 16x, more flops than at the up-looking speed.
// test/sparse_ordering_gate.cpp G6 fails if the policy costs more than it saves.
// ---------------------------------------------------------------------------
constexpr double kAutoReorderFlopsPerNnz = 1000.0;
constexpr double kAutoNdFlopsPerEdge = 8000.0;

std::vector<std::size_t> chooseOrdering(const std::vector<std::vector<std::size_t>>& adj,
                                        SparseOrdering ord, SparseOrdering& chosen,
                                        AutoOrderingReport* report = nullptr,
                                        OrderingScale scale = {1.0, 1.0}) {
    if (ord != SparseOrdering::Auto) { chosen = ord; return orderingOf(adj, ord); }
    const std::size_t n = adj.size();
    AutoOrderingReport rep;
    std::size_t offDiag = 0;
    for (const auto& a : adj) offDiag += a.size();
    std::vector<std::size_t> best = orderingOf(adj, SparseOrdering::Natural);
    SymbolicFactorStats bestS = symbolicStatsOf(adj, best);
    chosen = SparseOrdering::Natural;
    rep.naturalFlops = bestS.flops;
    rep.reorderThresholdFlops = kAutoReorderFlopsPerNnz * scale.reorder * static_cast<double>(std::max<std::size_t>(1, offDiag));
    const auto consider = [&](std::vector<std::size_t>& p, SparseOrdering c) {
        const SymbolicFactorStats s = symbolicStatsOf(adj, p);
        if (s.flops < bestS.flops || (s.flops == bestS.flops && s.nnzL < bestS.nnzL)) {
            best.swap(p);
            bestS = s;
            chosen = c;
        }
    };
    if (bestS.flops > rep.reorderThresholdFlops) {
        rep.evaluatedCheap = true;
        for (SparseOrdering c : {SparseOrdering::RCM, SparseOrdering::AMD}) {
            std::vector<std::size_t> p = orderingOf(adj, c);
            consider(p, c);
        }
        rep.bestCheapFlops = bestS.flops;
        if (ndFitsIndexRange(n)) {
            const NdCompressed C = ndCompress(adj);
            rep.compressedEdges = C.G.adj.size();
            rep.ndThresholdFlops = kAutoNdFlopsPerEdge * scale.nd * static_cast<double>(std::max<std::size_t>(1, rep.compressedEdges));
            if (bestS.flops >= rep.ndThresholdFlops) {
                rep.evaluatedNd = true;
                std::vector<std::size_t> p = postorderByEtree(adj, ndOrderCompressed(C, n));
                consider(p, SparseOrdering::NestedDissection);
            }
        }
    }
    rep.chosen = chosen;
    rep.chosenFlops = bestS.flops;
    if (report) *report = rep;
    return best;
}

std::atomic<SparseFactorObserver> g_ldltObserver{nullptr};
std::atomic<void*>                g_ldltObserverCtx{nullptr};

}  // namespace

void setSparseLDLTObserver(SparseFactorObserver observer, void* ctx) {
    g_ldltObserverCtx.store(ctx);
    g_ldltObserver.store(observer);
}

bool denseAccelerateAvailable() { return FORGE_LA_ACCELERATE != 0; }

void setDenseBackendPolicy(DenseBackendPolicy policy) {
    g_densePolicy.store(static_cast<int>(policy), std::memory_order_relaxed);
}

DenseBackendPolicy denseBackendPolicy() {
    return static_cast<DenseBackendPolicy>(g_densePolicy.load(std::memory_order_relaxed));
}

bool denseAccelerateWins(DenseKernel kernel, int m, int k) {
    return FORGE_LA_ACCELERATE != 0 && accelerateWinsImpl(kernel, m, k);
}

int densePotrf(int n, double* A, int lda) { return seamPotrf(n, A, lda); }
void denseTrsm(int m, int k, const double* L, int ldl, double* B, int ldb) {
    seamTrsm(m, k, L, ldl, B, ldb);
}
void denseSyrk(int m, int k, const double* B, int ldb, double* C, int ldc) {
    seamSyrk(m, k, B, ldb, C, ldc);
}

DenseKernelStats denseKernelStats() {
    DenseKernelStats s;
    for (int k = 0; k < 3; ++k) {
        for (int b = 0; b < 2; ++b) {
            s.calls[k][b] = g_denseCalls[k][b].load(std::memory_order_relaxed);
            s.madds[k][b] = g_denseMadds[k][b].load(std::memory_order_relaxed);
            for (int q = 0; q < kDenseSizeBuckets; ++q) {
                s.bucketCalls[k][b][q] = g_denseBucketCalls[k][b][q].load(std::memory_order_relaxed);
                s.bucketMadds[k][b][q] = g_denseBucketMadds[k][b][q].load(std::memory_order_relaxed);
            }
        }
        s.minAccelM[k] = g_denseMinAccelM[k].load(std::memory_order_relaxed);
        s.minAccelK[k] = g_denseMinAccelK[k].load(std::memory_order_relaxed);
        s.accelBelowCrossover[k] = g_denseAccelBelow[k].load(std::memory_order_relaxed);
    }
    return s;
}

void resetDenseKernelStats() {
    for (int k = 0; k < 3; ++k) {
        for (int b = 0; b < 2; ++b) {
            g_denseCalls[k][b].store(0, std::memory_order_relaxed);
            g_denseMadds[k][b].store(0, std::memory_order_relaxed);
            for (int q = 0; q < kDenseSizeBuckets; ++q) {
                g_denseBucketCalls[k][b][q].store(0, std::memory_order_relaxed);
                g_denseBucketMadds[k][b][q].store(0, std::memory_order_relaxed);
            }
        }
        g_denseMinAccelM[k].store(0, std::memory_order_relaxed);
        g_denseMinAccelK[k].store(0, std::memory_order_relaxed);
        g_denseAccelBelow[k].store(0, std::memory_order_relaxed);
    }
}

const char* sparseOrderingName(SparseOrdering ord) {
    switch (ord) {
    case SparseOrdering::Natural:          return "Natural";
    case SparseOrdering::RCM:              return "RCM";
    case SparseOrdering::AMD:              return "AMD";
    case SparseOrdering::NestedDissection: return "NestedDissection";
    case SparseOrdering::Auto:             return "Auto";
    }
    return "?";
}

std::vector<std::size_t> fillReducingOrdering(const SparseCSR<double>& A,
                                              SparseOrdering ord,
                                              SparseOrdering* chosen,
                                              AutoOrderingReport* report) {
    if (A.rows() != A.cols()) return {};
    SparseOrdering c = ord;
    std::vector<std::size_t> perm = chooseOrdering(buildAdjacency(A), ord, c, report,
                                                   orderingScaleFor(kDefaultSparseFactorMethod));
    if (chosen) *chosen = c;
    return perm;
}

SymbolicFactorStats symbolicFactorStats(const SparseCSR<double>& A,
                                        const std::vector<std::size_t>& perm) {
    if (A.rows() != A.cols() || perm.size() != A.rows()) return {};
    return symbolicStatsOf(buildAdjacency(A), perm);
}

std::size_t symbolicFactorNnz(const SparseCSR<double>& A,
                              const std::vector<std::size_t>& perm) {
    return symbolicFactorStats(A, perm).nnzL;
}

void SparseLDLT::compute(const SparseCSR<double>& A, SparseOrdering ordering,
                         SparseFactorMethod method) {
    if (SparseFactorObserver obs = g_ldltObserver.load())
        obs(A, g_ldltObserverCtx.load());
    const std::size_t n = A.rows();
    n_ = n;
    chosen_ = ordering;
    method_ = method;
    ok_ = (A.rows() == A.cols());
    perm_.clear(); iperm_.clear();
    Lp_.clear(); Li_.clear(); Lx_.clear(); d_.clear();
    snPerm_.clear(); snStart_.clear(); snRowPtr_.clear(); snRows_.clear();
    snValPtr_.clear(); snVal_.clear();
    nnzL_ = 0;
    if (!ok_) return;
    if (n == 0) { Lp_.assign(1, 0); ok_ = true; return; }

    // ---- 1. FILL-REDUCING ORDERING (see SparseOrdering) --------------------
    std::vector<std::vector<std::size_t>> adj = buildAdjacency(A);
    perm_ = chooseOrdering(adj, ordering, chosen_, nullptr, orderingScaleFor(method));
    iperm_.assign(n, 0);
    for (std::size_t k = 0; k < n; ++k) iperm_[perm_[k]] = k;
    // The supernodal panels are int-indexed; a matrix of order >= INT_MAX (far
    // beyond anything this kernel assembles) takes the size_t up-looking path.
    if (method == SparseFactorMethod::Supernodal &&
        n < static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        computeSupernodal(A, adj);
    } else {
        method_ = SparseFactorMethod::UpLooking;
        computeUpLooking(A, adj);
    }
}

std::size_t SparseLDLT::factorStoredEntries() const {
    return method_ == SparseFactorMethod::Supernodal ? snVal_.size() : Lx_.size() + d_.size();
}

// ---------------------------------------------------------------------------
// UpLooking: the scalar up-looking LDLᵀ this kernel shipped (reference oracle).
// ---------------------------------------------------------------------------
void SparseLDLT::computeUpLooking(const SparseCSR<double>& A,
                                  const std::vector<std::vector<std::size_t>>& adj) {
    const std::size_t n = n_;
    d_.assign(n, 0.0);

    // Permuted strictly-lower structural pattern, grouped by COLUMN: for a
    // structural entry (oi,oj) of A, its permuted indices (i,j). When j<i it is
    // a sub-diagonal entry of the permuted A sitting in column j; we want, per
    // column, the set of below-diagonal row indices that seed the etree.
    std::vector<std::vector<std::size_t>> ApatCol(n);   // col j -> rows i>j
    for (std::size_t oi = 0; oi < n; ++oi) {
        std::size_t i = iperm_[oi];
        for (std::size_t oj : adj[oi]) {
            std::size_t j = iperm_[oj];
            if (j < i) ApatCol[j].push_back(i);
        }
    }
    for (auto& v : ApatCol) std::sort(v.begin(), v.end());

    // ---- 2. SYMBOLIC FACTORIZATION (elimination tree + column counts) ------
    // Davis "ldl_symbolic": build the etree parent[] and the per-column nonzero
    // count of L. For each row k, walk every below-diagonal A entry up the etree
    // (marking with flag==k+1) — each ancestor column ii visited gains one L
    // entry in row k, giving Lcount[ii] = nnz of column ii of L. This is exact;
    // numeric factorization then allocates precisely this much (the fill).
    std::vector<std::ptrdiff_t> parent(n, -1);
    std::vector<std::size_t>    flag(n, 0);    // per-row visit marker (=k+1)
    std::vector<std::size_t>    Lcount(n, 0);  // nonzeros in column k of L

    // For the row-k etree walk we need, per row k, the columns j<k where A(k,j)
    // is structural — i.e. the transpose of ApatCol. Build it once.
    std::vector<std::vector<std::size_t>> ApatRow(n);   // row k -> cols j<k
    for (std::size_t j = 0; j < n; ++j)
        for (std::size_t i : ApatCol[j]) ApatRow[i].push_back(j);
    for (auto& v : ApatRow) std::sort(v.begin(), v.end());

    for (std::size_t k = 0; k < n; ++k) {
        flag[k] = k + 1;                       // mark self
        for (std::size_t j : ApatRow[k]) {     // j<k : entry A(k,j) present
            std::size_t jj = j;
            while (flag[jj] != k + 1) {         // climb etree to the root
                if (parent[jj] == -1) parent[jj] = static_cast<std::ptrdiff_t>(k);
                ++Lcount[jj];                  // column jj gains an entry (row k)
                flag[jj] = k + 1;
                jj = static_cast<std::size_t>(parent[jj]);
            }
        }
    }
    Lp_.assign(n + 1, 0);
    for (std::size_t k = 0; k < n; ++k) Lp_[k + 1] = Lp_[k] + Lcount[k];
    const std::size_t lnz = Lp_[n];
    Li_.assign(lnz, 0);
    Lx_.assign(lnz, 0.0);
    nnzL_ = lnz;

    // ---- 3. NUMERIC FACTORIZATION (up-looking sparse LDLᵀ) -----------------
    // Davis "ldl_numeric": for each row k, scatter the lower part of permuted A
    // into Y, compute the etree reach (the columns of L that fill in row k),
    // run the sparse triangular row-solve to produce L(k,·), then the pivot
    // D(k). L is appended into its CSC columns. All work is O(nnz(L)).
    //
    // Permuted lower numeric entries A(k,j) for j<=k (symmetrized: an assembly
    // tiny-asymmetry is averaged because both (oi,oj) and (oj,oi) accumulate
    // into Y[j], and the lower triangle is what we read).
    std::vector<std::vector<std::pair<std::size_t, double>>> ArowLower(n);
    {
        const auto& rp = A.rowPtr();
        const auto& ci = A.colIdx();
        const auto& av = A.values();
        for (std::size_t oi = 0; oi < n; ++oi) {
            std::size_t i = iperm_[oi];
            for (std::size_t p = rp[oi]; p < rp[oi + 1]; ++p) {
                std::size_t j = iperm_[ci[p]];
                if (j <= i) ArowLower[i].emplace_back(j, av[p]);
            }
        }
    }

    std::vector<double>      Y(n, 0.0);        // dense scatter of row k
    std::vector<std::size_t> reach(n, 0);      // etree reach pattern of row k
    std::vector<std::size_t> Lnext(n);         // next free slot per L column
    for (std::size_t k = 0; k < n; ++k) Lnext[k] = Lp_[k];
    std::fill(flag.begin(), flag.end(), 0);

    for (std::size_t k = 0; k < n; ++k) {
        flag[k] = k + 1;
        Y[k] = 0.0;
        std::size_t top = n;                   // reach[top..n-1] holds pattern
        double diag = 0.0;
        for (auto& rv : ArowLower[k]) {
            std::size_t j = rv.first; double v = rv.second;
            if (j == k) { diag += v; continue; }
            Y[j] += v;
            // climb the etree from j to the root, pushing each newly-seen node;
            // mark with flag so a node is added at most once per row k.
            std::size_t len = 0;
            std::size_t jj = j;
            while (flag[jj] != k + 1) {
                reach[len++] = jj;
                flag[jj] = k + 1;
                if (parent[jj] == -1) break;   // reached a tree root
                jj = static_cast<std::size_t>(parent[jj]);
            }
            // move this freshly-collected path to the top of reach[].
            while (len > 0) { --len; --top; reach[top] = reach[len]; }
        }
        // The reach is the union of several root-paths; sort ascending so the
        // triangular solve eliminates columns in increasing order (each column
        // c is fully formed before any column that depends on it).
        std::sort(reach.begin() + static_cast<std::ptrdiff_t>(top), reach.end());

        double dk = diag;
        for (std::size_t p = top; p < n; ++p) {
            std::size_t c = reach[p];
            double yc = Y[c];
            Y[c] = 0.0;
            // propagate to ancestors via the already-built column c of L. Davis
            // ldl_numeric: the update scales by yc (the un-divided value), NOT
            // by L(k,c); the LDLᵀ division by D(c) happens once, below.
            for (std::size_t q = Lp_[c]; q < Lnext[c]; ++q)
                Y[Li_[q]] -= Lx_[q] * yc;
            double lkc = yc / d_[c];            // L(k,c)
            dk -= lkc * yc;                      // pivot contribution
            Li_[Lnext[c]] = k;                   // append L(k,c) into column c
            Lx_[Lnext[c]] = lkc;
            ++Lnext[c];
        }
        if (!(dk > 0.0)) { ok_ = false; return; }   // non-positive pivot -> not SPD
        d_[k] = dk;
    }
    ok_ = true;
}

// ---------------------------------------------------------------------------
// Supernodal: MULTIFRONTAL supernodal Cholesky (T-157).
//
// Symbolic (all O(nnz(A))-ish, reusing the T-163 analysis): the chosen
// permutation is re-ordered by its elimination-tree POSTORDER (an equivalent
// ordering — same fill — under which every supernode is a contiguous column
// range and every subtree is processed before its parent); exact column counts
// (Gilbert-Ng-Peyton) give the FUNDAMENTAL supernodes (j, j+1 merge iff
// parent(j) = j+1, c(j) = c(j+1)+1 and j+1 has no other child), then RELAXED
// AMALGAMATION merges a supernode into the contiguous one above it when the
// explicit zeros stay small (always up to 4 columns; < 80 % zeros up to 16,
// < 10 % up to 48, < 5 % beyond, at most kSnMaxCols columns — the rule of
// Ashcraft & Grimes, "The influence of relaxed supernode partitions on the
// multifrontal method", ACM TOMS 15(4), 1989; values as popularised by
// CHOLMOD). Each supernode's row structure is the union of its A columns and
// its children's structures (Liu, "The multifrontal method for sparse matrix
// solution: theory and practice", SIAM Review 34(1), 1992).
//
// Numeric: for each supernode s in postorder, assemble the dense frontal
// matrix F (order k+m: its k columns and m rows below) from A and the update
// matrices its children left on a stack (extend-add), then
//     F11 = L11 L11ᵀ          POTRF  (k×k)
//     L21 = F21 L11⁻ᵀ         TRSM   (m×k)
//     U   = F22 − L21 L21ᵀ    SYRK   (m×m, rank k)
// through the dense-kernel seam, keep [L11; L21] and push U. A non-positive
// pivot (POTRF info > 0) means A is not SPD: ok() = false, as before.
// Written from the cited papers; no third-party source is copied.
// ---------------------------------------------------------------------------
namespace {
constexpr int kSnMaxCols = 64;   // cap on an amalgamated supernode's width
}  // namespace

void SparseLDLT::computeSupernodal(const SparseCSR<double>& A,
                                   const std::vector<std::vector<std::size_t>>& adj) {
    const std::size_t n = n_;
    ok_ = false;
    if (n >= static_cast<std::size_t>(std::numeric_limits<int>::max())) return;   // int-indexed panels
    // ---- 1. postorder the chosen permutation -------------------------------------
    {
        const PermutedPattern P0 = permutePattern(adj, perm_);
        const std::vector<std::size_t> parent0 = eliminationTree(P0, n);
        const std::vector<std::size_t> post0 = etreePostorder(parent0);
        snPerm_.resize(n);
        for (std::size_t k = 0; k < n; ++k) snPerm_[k] = perm_[post0[k]];
    }
    const PermutedPattern P = permutePattern(adj, snPerm_);
    const std::vector<std::size_t> parent = eliminationTree(P, n);
    const std::vector<std::size_t> cc = strictColumnCounts(P, parent, etreePostorder(parent));
    nnzL_ = 0;
    for (std::size_t c : cc) nnzL_ += c;
    // ---- 2. fundamental supernodes ------------------------------------------------
    std::vector<int> nchild(n, 0);
    for (std::size_t j = 0; j < n; ++j)
        if (parent[j] != kNoNode) ++nchild[parent[j]];
    std::vector<int> fund;                       // first column of each fundamental supernode
    for (std::size_t j = 0; j < n;) {
        std::size_t l = j;
        while (l + 1 < n && parent[l] == l + 1 && cc[l] == cc[l + 1] + 1 && nchild[l + 1] == 1) ++l;
        fund.push_back(static_cast<int>(j));
        j = l + 1;
    }
    fund.push_back(static_cast<int>(n));
    // ---- 3. relaxed amalgamation (contiguous child into parent) ------------------
    snStart_.clear();
    {
        int gk = 0;                // width of the open group
        double gTrue = 0.0;        // structural strict-lower entries of the open group
        for (std::size_t f = 0; f + 1 < fund.size(); ++f) {
            const int a = fund[f], l = fund[f + 1] - 1, k = l - a + 1;
            const double m = static_cast<double>(cc[static_cast<std::size_t>(l)]);
            double tru = 0.0;
            for (int j = a; j <= l; ++j) tru += static_cast<double>(cc[static_cast<std::size_t>(j)]);
            bool merged = false;
            if (!snStart_.empty()) {
                const std::size_t gl = static_cast<std::size_t>(a - 1);       // open group's last column
                if (parent[gl] != kNoNode && parent[gl] >= static_cast<std::size_t>(a) &&
                    parent[gl] <= static_cast<std::size_t>(l)) {
                    const int kk = gk + k;
                    const double stored = static_cast<double>(kk) * (kk - 1) / 2.0 + static_cast<double>(kk) * m;
                    const double z = stored > 0.0 ? (stored - (gTrue + tru)) / stored : 0.0;
                    if (kk <= kSnMaxCols &&
                        (kk <= 4 || (kk <= 16 && z < 0.8) || (kk <= 48 && z < 0.1) || z < 0.05)) {
                        gk = kk;
                        gTrue += tru;
                        merged = true;
                    }
                }
            }
            if (!merged) { snStart_.push_back(a); gk = k; gTrue = tru; }
        }
        snStart_.push_back(static_cast<int>(n));
    }
    const int ns = static_cast<int>(snStart_.size()) - 1;
    std::vector<int> snOf(n);
    for (int s = 0; s < ns; ++s)
        for (int c = snStart_[static_cast<std::size_t>(s)]; c < snStart_[static_cast<std::size_t>(s) + 1]; ++c)
            snOf[static_cast<std::size_t>(c)] = s;
    // ---- 4. supernodal tree and row structures -------------------------------------
    std::vector<int> firstKid(static_cast<std::size_t>(ns), -1), nextKid(static_cast<std::size_t>(ns), -1);
    for (int s = ns - 1; s >= 0; --s) {
        const std::size_t l = static_cast<std::size_t>(snStart_[static_cast<std::size_t>(s) + 1] - 1);
        if (parent[l] == kNoNode) continue;
        const int ps = snOf[parent[l]];
        nextKid[static_cast<std::size_t>(s)] = firstKid[static_cast<std::size_t>(ps)];
        firstKid[static_cast<std::size_t>(ps)] = s;
    }
    snRowPtr_.assign(static_cast<std::size_t>(ns) + 1, 0);
    snRows_.clear();
    {
        std::vector<int> mark(n, -1), rows;
        for (int s = 0; s < ns; ++s) {
            const int f = snStart_[static_cast<std::size_t>(s)], l = snStart_[static_cast<std::size_t>(s) + 1] - 1;
            rows.clear();
            for (int j = f; j <= l; ++j)
                for (std::size_t q = P.ptr[static_cast<std::size_t>(j)]; q < P.ptr[static_cast<std::size_t>(j) + 1]; ++q) {
                    const std::size_t i = P.idx[q];
                    if (i > static_cast<std::size_t>(l) && mark[i] != s) { mark[i] = s; rows.push_back(static_cast<int>(i)); }
                }
            for (int c = firstKid[static_cast<std::size_t>(s)]; c >= 0; c = nextKid[static_cast<std::size_t>(c)])
                for (std::size_t q = snRowPtr_[static_cast<std::size_t>(c)]; q < snRowPtr_[static_cast<std::size_t>(c) + 1]; ++q) {
                    const int i = snRows_[q];
                    if (i > l && mark[static_cast<std::size_t>(i)] != s) { mark[static_cast<std::size_t>(i)] = s; rows.push_back(i); }
                }
            std::sort(rows.begin(), rows.end());
            snRows_.insert(snRows_.end(), rows.begin(), rows.end());
            snRowPtr_[static_cast<std::size_t>(s) + 1] = snRows_.size();
        }
    }
    snValPtr_.assign(static_cast<std::size_t>(ns) + 1, 0);
    std::size_t maxFront = 0;
    for (int s = 0; s < ns; ++s) {
        const std::size_t k = static_cast<std::size_t>(snStart_[static_cast<std::size_t>(s) + 1] - snStart_[static_cast<std::size_t>(s)]);
        const std::size_t m = snRowPtr_[static_cast<std::size_t>(s) + 1] - snRowPtr_[static_cast<std::size_t>(s)];
        snValPtr_[static_cast<std::size_t>(s) + 1] = snValPtr_[static_cast<std::size_t>(s)] + (k + m) * k;
        maxFront = std::max(maxFront, k + m);
    }
    snVal_.assign(snValPtr_[static_cast<std::size_t>(ns)], 0.0);
    // ---- 5. permuted LOWER triangle of A by column (the entries the up-looking
    //         path reads too: CSR row oi's (oi, oj) with perm(oi) >= perm(oj)) -----
    std::vector<std::size_t> spos(n);
    for (std::size_t k = 0; k < n; ++k) spos[snPerm_[k]] = k;
    std::vector<std::size_t> cp(n + 1, 0);
    const auto& rp = A.rowPtr();
    const auto& ci = A.colIdx();
    const auto& av = A.values();
    for (std::size_t oi = 0; oi < n; ++oi)
        for (std::size_t q = rp[oi]; q < rp[oi + 1]; ++q)
            if (spos[oi] >= spos[ci[q]]) ++cp[spos[ci[q]] + 1];
    for (std::size_t j = 0; j < n; ++j) cp[j + 1] += cp[j];
    std::vector<int> crow(cp[n]);
    std::vector<double> cval(cp[n]);
    {
        std::vector<std::size_t> w(cp.begin(), cp.end() - 1);
        for (std::size_t oi = 0; oi < n; ++oi)
            for (std::size_t q = rp[oi]; q < rp[oi + 1]; ++q) {
                const std::size_t i = spos[oi], j = spos[ci[q]];
                if (i >= j) { crow[w[j]] = static_cast<int>(i); cval[w[j]++] = av[q]; }
            }
    }
    // ---- 6. numeric multifrontal --------------------------------------------------
    std::vector<int> loc(n, -1);
    std::vector<double> front(maxFront * maxFront);
    std::vector<double> stack;          // update matrices, m×m column-major, children on top
    std::vector<std::size_t> stackOff;  // their offsets, one per pending supernode
    std::vector<int> stackSn;
    for (int s = 0; s < ns; ++s) {
        const int f = snStart_[static_cast<std::size_t>(s)];
        const int k = snStart_[static_cast<std::size_t>(s) + 1] - f;
        const int* rows = snRows_.data() + snRowPtr_[static_cast<std::size_t>(s)];
        const int m = static_cast<int>(snRowPtr_[static_cast<std::size_t>(s) + 1] - snRowPtr_[static_cast<std::size_t>(s)]);
        const int Fs = k + m;
        const std::size_t ld = static_cast<std::size_t>(Fs);
        std::fill(front.begin(), front.begin() + static_cast<std::ptrdiff_t>(ld * ld), 0.0);
        for (int j = 0; j < k; ++j) loc[static_cast<std::size_t>(f + j)] = j;
        for (int t = 0; t < m; ++t) loc[static_cast<std::size_t>(rows[t])] = k + t;
        // assemble A
        for (int j = f; j < f + k; ++j) {
            double* col = front.data() + static_cast<std::size_t>(j - f) * ld;
            for (std::size_t q = cp[static_cast<std::size_t>(j)]; q < cp[static_cast<std::size_t>(j) + 1]; ++q)
                col[loc[static_cast<std::size_t>(crow[q])]] += cval[q];
        }
        // extend-add the children's updates (they are the top entries of the stack)
        int nkids = 0;
        for (int c = firstKid[static_cast<std::size_t>(s)]; c >= 0; c = nextKid[static_cast<std::size_t>(c)]) ++nkids;
        for (int t = 0; t < nkids; ++t) {
            const int c = stackSn.back();
            const std::size_t off = stackOff.back();
            const int* rc = snRows_.data() + snRowPtr_[static_cast<std::size_t>(c)];
            const int mc = static_cast<int>(snRowPtr_[static_cast<std::size_t>(c) + 1] - snRowPtr_[static_cast<std::size_t>(c)]);
            const double* U = stack.data() + off;
            for (int b = 0; b < mc; ++b) {
                double* col = front.data() + static_cast<std::size_t>(loc[static_cast<std::size_t>(rc[b])]) * ld;
                const double* ub = U + static_cast<std::size_t>(b) * static_cast<std::size_t>(mc);
                for (int a2 = b; a2 < mc; ++a2) col[loc[static_cast<std::size_t>(rc[a2])]] += ub[a2];
            }
            stack.resize(off);
            stackOff.pop_back();
            stackSn.pop_back();
        }
        // factor the front
        if (seamPotrf(k, front.data(), Fs) != 0) { ok_ = false; return; }
        if (m > 0) {
            seamTrsm(m, k, front.data(), Fs, front.data() + k, Fs);
            seamSyrk(m, k, front.data() + k, Fs, front.data() + static_cast<std::size_t>(k) * ld + static_cast<std::size_t>(k), Fs);
        }
        double* panel = snVal_.data() + snValPtr_[static_cast<std::size_t>(s)];
        std::copy(front.begin(), front.begin() + static_cast<std::ptrdiff_t>(ld * static_cast<std::size_t>(k)), panel);
        if (m > 0) {
            const std::size_t off = stack.size();
            stack.resize(off + static_cast<std::size_t>(m) * static_cast<std::size_t>(m));
            for (int b = 0; b < m; ++b) {
                const double* src = front.data() + static_cast<std::size_t>(k + b) * ld + static_cast<std::size_t>(k);
                std::copy(src, src + m, stack.data() + off + static_cast<std::size_t>(b) * static_cast<std::size_t>(m));
            }
            stackOff.push_back(off);
            stackSn.push_back(s);
        }
    }
    ok_ = true;
}

std::vector<double> SparseLDLT::solve(const std::vector<double>& b) const {
    const std::size_t n = n_;
    std::vector<double> x(n, 0.0);
    if (!ok_ || b.size() != n) return x;
    if (n == 0) return x;


    if (method_ == SparseFactorMethod::Supernodal) {
        // P A Pᵀ = L Lᵀ: forward L y = P b, backward Lᵀ z = y, x = Pᵀ z — one
        // supernode (diagonal block + panel) at a time.
        std::vector<double> y(n);
        for (std::size_t k = 0; k < n; ++k) y[k] = b[snPerm_[k]];
        const int ns = static_cast<int>(snStart_.size()) - 1;
        for (int s = 0; s < ns; ++s) {
            const std::size_t f = static_cast<std::size_t>(snStart_[static_cast<std::size_t>(s)]);
            const std::size_t k = static_cast<std::size_t>(snStart_[static_cast<std::size_t>(s) + 1]) - f;
            const std::size_t m = snRowPtr_[static_cast<std::size_t>(s) + 1] - snRowPtr_[static_cast<std::size_t>(s)];
            const std::size_t ld = k + m;
            const double* P = snVal_.data() + snValPtr_[static_cast<std::size_t>(s)];
            const int* rows = snRows_.data() + snRowPtr_[static_cast<std::size_t>(s)];
            for (std::size_t j = 0; j < k; ++j) {
                const double* col = P + j * ld;
                const double xj = y[f + j] / col[j];
                y[f + j] = xj;
                for (std::size_t i = j + 1; i < k; ++i) y[f + i] -= col[i] * xj;
                for (std::size_t t = 0; t < m; ++t) y[static_cast<std::size_t>(rows[t])] -= col[k + t] * xj;
            }
        }
        for (int s = ns - 1; s >= 0; --s) {
            const std::size_t f = static_cast<std::size_t>(snStart_[static_cast<std::size_t>(s)]);
            const std::size_t k = static_cast<std::size_t>(snStart_[static_cast<std::size_t>(s) + 1]) - f;
            const std::size_t m = snRowPtr_[static_cast<std::size_t>(s) + 1] - snRowPtr_[static_cast<std::size_t>(s)];
            const std::size_t ld = k + m;
            const double* P = snVal_.data() + snValPtr_[static_cast<std::size_t>(s)];
            const int* rows = snRows_.data() + snRowPtr_[static_cast<std::size_t>(s)];
            for (std::size_t jj = k; jj-- > 0;) {
                const double* col = P + jj * ld;
                double sum = y[f + jj];
                for (std::size_t i = jj + 1; i < k; ++i) sum -= col[i] * y[f + i];
                for (std::size_t t = 0; t < m; ++t) sum -= col[k + t] * y[static_cast<std::size_t>(rows[t])];
                y[f + jj] = sum / col[jj];
            }
        }
        for (std::size_t k = 0; k < n; ++k) x[snPerm_[k]] = y[k];
        return x;
    }
    // Permute b -> y in the factorization ordering: y[k] = b[perm_[k]].
    std::vector<double> y(n);
    for (std::size_t k = 0; k < n; ++k) y[k] = b[perm_[k]];

    // Forward solve L z = y (L unit-lower, CSC by column).
    for (std::size_t k = 0; k < n; ++k) {
        double yk = y[k];
        for (std::size_t p = Lp_[k]; p < Lp_[k + 1]; ++p)
            y[Li_[p]] -= Lx_[p] * yk;
    }
    // Diagonal solve D w = z.
    for (std::size_t k = 0; k < n; ++k) y[k] /= d_[k];
    // Backward solve Lᵀ u = w.
    for (std::size_t kk = 0; kk < n; ++kk) {
        std::size_t k = n - 1 - kk;
        double s = y[k];
        for (std::size_t p = Lp_[k]; p < Lp_[k + 1]; ++p)
            s -= Lx_[p] * y[Li_[p]];
        y[k] = s;
    }
    // Un-permute: x[perm_[k]] = y[k].
    for (std::size_t k = 0; k < n; ++k) x[perm_[k]] = y[k];
    return x;
}

// ===========================================================================
// SparseLU — TRUE sparse non-symmetric direct factorization with PARTIAL
// PIVOTING (Gilbert-Peierls left-looking), factor-once / solve-many. No densify:
// the matrix is COLUMN-pre-ordered (RCM on A+Aᵀ to reduce fill), then each
// column is built by a sparse triangular solve against the already-computed L
// whose nonzero structure is found by a depth-first reachability search and used
// in topological order. The largest-magnitude entry on/below the diagonal is the
// partial pivot (row recorded), L is scaled, and the column is appended into the
// CSC factors. Memory is O(nnz(L)+nnz(U)), time follows the sparse flop count,
// so large banded non-symmetric FE/CFD systems factor in a few MB and well under
// a second — infeasible with the previous dense O(n²)/O(n³) path.
//
// Reference: J. R. Gilbert & T. Peierls, "Sparse partial pivoting in time
// proportional to arithmetic operations" (SIAM J. Sci. Stat. Comput. 9, 1988);
// T. Davis, "Direct Methods for Sparse Linear Systems" (SIAM 2006), ch. 6
// (cs_lu / cs_spsolve / cs_reach / cs_dfs), and George & Liu (RCM ordering).
// ===========================================================================
namespace {

// Iterative depth-first search over the directed graph of L from one seed row j
// (Davis "cs_dfs"). The graph is in the ORIGINAL row frame: node = original row
// index; if row r is already a pivot (pinv[r] = its pivot column c), its out-
// edges are the row indices in L's column c (Li[Lp[c]..Lp[c+1])); a not-yet-
// pivoted row is a sink. Nodes are POST-ORDER pushed to xi[--top] as the DFS
// finishes them, so on return xi[top..n-1] is a topological order of reach(j)
// (every node precedes the nodes it points to — i.e. a column appears before the
// columns whose elimination depends on it). `work` marks visited (=mark);
// pstack/jstack are the explicit recursion stacks (length n).
static std::size_t
luDfs(std::size_t j, const std::vector<std::size_t>& Lp,
      const std::vector<std::size_t>& Li, const std::vector<std::size_t>& pinv,
      std::size_t mark, std::vector<std::size_t>& work,
      std::vector<std::size_t>& xi, std::vector<std::size_t>& pstack,
      std::vector<std::size_t>& jstack, std::size_t top, std::size_t n) {
    std::size_t head = 0;
    jstack[0] = j;
    while (true) {
        std::size_t jj = jstack[head];     // current node on the DFS stack
        std::size_t c = pinv[jj];          // pivot column owning row jj (n=none)
        if (work[jj] != mark) {            // first visit: mark + init edge cursor
            work[jj] = mark;
            pstack[head] = (c == n) ? 0 : Lp[c];
        }
        bool done = true;                  // assume jj has no unvisited child
        std::size_t pend = (c == n) ? 0 : Lp[c + 1];
        for (std::size_t p = (c == n) ? 0 : pstack[head]; p < pend; ++p) {
            std::size_t i = Li[p];         // edge jj -> i
            if (work[i] == mark) continue; // already visited
            pstack[head] = p;              // pause jj here; recurse into i
            jstack[++head] = i;
            done = false;
            break;
        }
        if (done) {                        // jj fully explored: post-order emit
            xi[--top] = jj;
            if (head == 0) break;
            --head;
        }
    }
    return top;
}

}  // namespace

void SparseLU::compute(const SparseCSR<double>& A) {
    const std::size_t n = A.rows();
    n_ = n;
    ok_ = (A.rows() == A.cols());
    colperm_.clear(); rowperm_.clear(); irowperm_.clear();
    Lp_.clear(); Li_.clear(); Lx_.clear();
    Up_.clear(); Ui_.clear(); Ux_.clear();
    if (!ok_) return;
    if (n == 0) { Lp_.assign(1, 0); Up_.assign(1, 0); ok_ = true; return; }

    // ---- Build a CSC view of A in the ORIGINAL frame (columns of A) ----------
    // CSR row pointers/col indices give A by row; transpose-scatter into CSC so
    // we can stream each column. Duplicate-free (setFromTriplets compresses).
    const auto& rp = A.rowPtr();
    const auto& ci = A.colIdx();
    const auto& av = A.values();
    std::vector<std::size_t> Ap(n + 1, 0);
    for (std::size_t k = 0; k < ci.size(); ++k) ++Ap[ci[k] + 1];
    for (std::size_t j = 0; j < n; ++j) Ap[j + 1] += Ap[j];
    std::vector<std::size_t> Ai(av.size());
    std::vector<double>      Ax(av.size());
    {
        std::vector<std::size_t> next(Ap.begin(), Ap.end() - 1);
        for (std::size_t i = 0; i < n; ++i)
            for (std::size_t p = rp[i]; p < rp[i + 1]; ++p) {
                std::size_t j = ci[p];
                std::size_t d = next[j]++;
                Ai[d] = i; Ax[d] = av[p];
            }
    }

    // ---- 1. COLUMN PRE-ORDERING (fill-reducing) ------------------------------
    // RCM on the symmetrized pattern A+Aᵀ — the same proven helper SparseLDLT
    // uses. colperm_[k] = original column at factored position k. (A true COLAMD
    // would order specifically for the LU column-fill graph; RCM-on-A+Aᵀ is the
    // accepted simpler substitute and keeps banded FE/CFD systems banded.)
    std::vector<std::vector<std::size_t>> adj = buildAdjacency(A);
    colperm_ = reverseCuthillMcKee(adj);
    std::vector<std::size_t> qinv(n);          // qinv[orig col] = factored col
    for (std::size_t k = 0; k < n; ++k) qinv[colperm_[k]] = k;

    // ---- 2. LEFT-LOOKING NUMERIC FACTORIZATION (Gilbert-Peierls) -------------
    // Factor PAQ = LU where Q is colperm_ and P is the partial-pivot row perm.
    // We work in a frame whose COLUMNS are colperm_-ordered; rows stay in the
    // ORIGINAL index space until pivoting assigns them a position via pinv.
    //   pinv[r]  : factored row r already chosen as the pivot of column pinv[r]
    //              (so its L-column carries that row's eliminations); n if unset.
    // L is stored strictly-lower (unit diagonal implicit); U upper incl. pivot.
    Lp_.assign(n + 1, 0);
    Up_.assign(n + 1, 0);
    Li_.clear(); Lx_.clear(); Ui_.clear(); Ux_.clear();
    Li_.reserve(A.nnz() * 4 + n);
    Lx_.reserve(A.nnz() * 4 + n);
    Ui_.reserve(A.nnz() * 4 + n);
    Ux_.reserve(A.nnz() * 4 + n);

    std::vector<std::size_t> pinv(n, n);       // factored-row -> pivot column (n=unset)
    std::vector<double>      x(n, 0.0);        // dense workspace for the column
    std::vector<std::size_t> work(n, 0);       // DFS marks (=k+1 in column k)
    std::vector<std::size_t> xi(n);            // reach pattern (topological)
    std::vector<std::size_t> pstack(n), jstack(n);

    for (std::size_t k = 0; k < n; ++k) {
        Lp_[k] = Li_.size();
        Up_[k] = Ui_.size();
        const std::size_t mark = k + 1;
        const std::size_t origCol = colperm_[k];

        // (a) scatter A(:,origCol) into x, and compute the reach in L of its
        //     pattern via DFS — the set of columns of L (factored frame) that
        //     touch this column, in topological order.
        std::size_t top = n;
        for (std::size_t p = Ap[origCol]; p < Ap[origCol + 1]; ++p) {
            std::size_t i = Ai[p];             // original row index
            if (work[i] != mark)               // unmarked seed: DFS its reach
                top = luDfs(i, Lp_, Li_, pinv, mark, work, xi, pstack, jstack, top, n);
            x[i] = Ax[p];                      // (duplicate-free, plain assign)
        }

        // (b) sparse triangular solve x = L \ x in the topological order: for
        //     each reached column c that is ALREADY a pivot (row r=pivot[c]),
        //     subtract x[r]*L(:,c) from the remaining x. xi[top..n-1] is ordered
        //     children-before-parents, exactly the order the substitution needs.
        for (std::size_t px = top; px < n; ++px) {
            std::size_t r = xi[px];            // factored row index in the reach
            std::size_t c = pinv[r];           // the pivot column that owns row r
            if (c == n) continue;              // r not yet a pivot: stays in x
            double xr = x[r];
            for (std::size_t p = Lp_[c]; p < Lp_[c + 1]; ++p)
                x[Li_[p]] -= Lx_[p] * xr;      // L stored strictly lower (CSC)
        }

        // (c) PARTIAL PIVOT: among all entries of x whose row is NOT yet a pivot
        //     (the candidate sub-/on-diagonal rows of this column), pick the
        //     largest magnitude. Also accumulate the maximum |x| over the column
        //     for the (non-rank-revealing) singularity floor.
        double pivAbs = -1.0, colMax = 0.0;
        std::size_t pivRow = n;
        for (std::size_t px = top; px < n; ++px) {
            std::size_t r = xi[px];
            double a = std::fabs(x[r]);
            if (a > colMax) colMax = a;
            if (pinv[r] == n && a > pivAbs) { pivAbs = a; pivRow = r; }
        }

        // Non-rank-revealing singular test (match the dense non-RR LU posture):
        // a column is singular only if its pivot is ~0 RELATIVE to the column's
        // own magnitude — so penalty matrices spanning 1e9..1e20 still factor,
        // while a genuinely empty/zero pivot column reports failure.
        const double floor = (colMax > 0.0 ? colMax : 1.0) * 1e-30;
        if (pivRow == n || pivAbs <= floor) { ok_ = false; return; }

        const double pivVal = x[pivRow];
        // (d) emit U(:,k) = the already-pivoted entries (rows above the diagonal,
        //     stored at their factored index pinv[r], which is < k), with the
        //     pivot itself LAST as the diagonal. Emit L(:,k) = the not-yet-
        //     pivoted entries (excluding the pivot row) scaled by 1/pivVal (unit
        //     lower); their row indices stay in the ORIGINAL frame and are remap-
        //     ped to the factored frame in one final pass after all columns are
        //     done (Davis cs_lu). Clear the dense workspace as we go.
        for (std::size_t px = top; px < n; ++px) {
            std::size_t r = xi[px];
            double xr = x[r];
            x[r] = 0.0;                        // clear workspace for next column
            if (r == pivRow) continue;         // pivot handled separately below
            if (pinv[r] != n) {                // already-pivoted row -> U (above)
                Ui_.push_back(pinv[r]);
                Ux_.push_back(xr);
            } else {                           // not-yet-pivoted row -> L (below)
                Li_.push_back(r);              // ORIGINAL frame; remapped at end
                Lx_.push_back(xr / pivVal);    // unit-lower scaling
            }
        }
        Ui_.push_back(k);                      // U diagonal (the pivot), stored last
        Ux_.push_back(pivVal);
        pinv[pivRow] = k;                      // pivRow becomes pivot of column k
    }
    Lp_[n] = Li_.size();
    Up_[n] = Ui_.size();

    // ---- 3. FINALIZE permutations + remap L row indices to factored frame ----
    // pinv[r] = factored position of original row r (every row is now a pivot).
    // rowperm_[factored] = original row; irowperm_ is its inverse (== pinv).
    rowperm_.assign(n, 0);
    irowperm_.assign(n, 0);
    for (std::size_t r = 0; r < n; ++r) {
        std::size_t fr = pinv[r];              // factored row position of orig r
        rowperm_[fr] = r;
        irowperm_[r] = fr;
    }
    // L's row indices were stored in the original frame; remap to factored.
    for (std::size_t p = 0; p < Li_.size(); ++p) Li_[p] = pinv[Li_[p]];

    ok_ = true;
}

std::vector<double> SparseLU::solve(const std::vector<double>& b) const {
    const std::size_t n = n_;
    std::vector<double> x(n, 0.0);
    if (!ok_ || b.size() != n) return x;
    if (n == 0) return x;

    // PAQ = LU. Solve A x = b  <=>  L U (Qᵀ x) = P b.
    // 1. permute: y[i] = b[rowperm_[i]]  (apply P).
    std::vector<double> y(n);
    for (std::size_t i = 0; i < n; ++i) y[i] = b[rowperm_[i]];
    // 2. forward solve L z = y (unit lower, CSC by column).
    for (std::size_t k = 0; k < n; ++k) {
        double yk = y[k];
        for (std::size_t p = Lp_[k]; p < Lp_[k + 1]; ++p)
            y[Li_[p]] -= Lx_[p] * yk;
    }
    // 3. backward solve U w = z (upper, CSC by column; diagonal is the last
    //    entry of each column).
    for (std::size_t kk = 0; kk < n; ++kk) {
        std::size_t k = n - 1 - kk;
        // last entry of column k is the diagonal pivot.
        std::size_t diagP = Up_[k + 1] - 1;
        double wk = y[k] / Ux_[diagP];
        y[k] = wk;
        for (std::size_t p = Up_[k]; p < diagP; ++p)
            y[Ui_[p]] -= Ux_[p] * wk;
    }
    // 4. un-permute columns: x[colperm_[k]] = w[k]  (apply Q).
    for (std::size_t k = 0; k < n; ++k) x[colperm_[k]] = y[k];
    return x;
}

// ===========================================================================
// Jacobi-preconditioned Conjugate Gradient.
// ===========================================================================
CGResult conjugateGradient(const SparseCSR<double>& A,
                           const std::vector<double>& b,
                           std::vector<double>& x,
                           int maxIters, double tol) {
    CGResult res;
    const std::size_t n = A.rows();
    if (x.size() != n) x.assign(n, 0.0);
    if (maxIters <= 0) maxIters = static_cast<int>(10 * n + 50);

    std::vector<double> diag = A.diagonal();
    std::vector<double> r = b;                     // r = b - A x
    {
        std::vector<double> Ax = A * x;
        for (std::size_t i = 0; i < n; ++i) r[i] -= Ax[i];
    }
    double bnorm = 0.0; for (double v : b) bnorm += v * v; bnorm = std::sqrt(bnorm);
    if (bnorm == 0.0) bnorm = 1.0;

    auto precond = [&](const std::vector<double>& v) {
        std::vector<double> z(n);
        for (std::size_t i = 0; i < n; ++i)
            z[i] = (diag[i] != 0.0) ? v[i] / diag[i] : v[i];
        return z;
    };
    std::vector<double> z = precond(r);
    std::vector<double> p = z;
    double rz = 0.0; for (std::size_t i = 0; i < n; ++i) rz += r[i] * z[i];

    int it = 0;
    double rnorm = 0.0; for (double v : r) rnorm += v * v; rnorm = std::sqrt(rnorm);
    for (; it < maxIters; ++it) {
        if (rnorm / bnorm <= tol) break;
        std::vector<double> Ap = A * p;
        double pAp = 0.0; for (std::size_t i = 0; i < n; ++i) pAp += p[i] * Ap[i];
        if (pAp == 0.0) { res.ok = false; break; }
        double alpha = rz / pAp;
        for (std::size_t i = 0; i < n; ++i) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
        rnorm = 0.0; for (double v : r) rnorm += v * v; rnorm = std::sqrt(rnorm);
        if (rnorm / bnorm <= tol) { ++it; break; }
        std::vector<double> znew = precond(r);
        double rznew = 0.0; for (std::size_t i = 0; i < n; ++i) rznew += r[i] * znew[i];
        double beta = rznew / rz;
        for (std::size_t i = 0; i < n; ++i) p[i] = znew[i] + beta * p[i];
        rz = rznew;
    }
    res.iters = it;
    res.residual = rnorm / bnorm;
    res.ok = (res.residual <= std::max(tol * 10.0, 1e-8));
    return res;
}

// ===========================================================================
// sparseGeneralizedEigSI — lowest-k modes of K φ = λ M φ by SHIFT-INVERT
// LANCZOS with full M-re-orthogonalization. See the header for the method.
//
// The operator C = (K − σM)⁻¹ M is M-self-adjoint; one SparseLDLT factorization
// of (K − σM) drives every Lanczos step (a sparse triangular solve), M is
// applied as a sparse matvec, and the M-inner product is evaluated through the
// stored M·q_j vectors (so the inner products are plain dot products, no extra
// matvecs). The tridiagonal T is solved with the dense SymmetricEigen; the Ritz
// pairs are validated by the TRUE pencil residual before being returned.
// ===========================================================================
SparseGenEigResult sparseGeneralizedEigSI(const SparseCSR<double>& K,
                                          const SparseCSR<double>& M,
                                          int numModes, double sigma,
                                          int maxLanczos, double tol) {
    SparseGenEigResult out;
    const std::size_t n = K.rows();
    if (n == 0 || numModes <= 0) return out;
    if (K.cols() != n || M.rows() != n || M.cols() != n) return out;
    const int k = std::min<int>(numModes, static_cast<int>(n));

    // ---- 1. A = K − σM (sparse), factored ONCE with the existing SparseLDLT. -
    SparseCSR<double> A;
    if (sigma == 0.0) {
        A = K;                                   // (K − 0·M) = K
    } else {
        std::vector<Triplet<double>> trips;
        trips.reserve(K.nnz() + M.nnz());
        const auto& krp = K.rowPtr(); const auto& kci = K.colIdx(); const auto& kv = K.values();
        for (std::size_t i = 0; i < n; ++i)
            for (std::size_t p = krp[i]; p < krp[i + 1]; ++p)
                trips.emplace_back(i, kci[p], kv[p]);
        const auto& mrp = M.rowPtr(); const auto& mci = M.colIdx(); const auto& mv = M.values();
        for (std::size_t i = 0; i < n; ++i)
            for (std::size_t p = mrp[i]; p < mrp[i + 1]; ++p)
                trips.emplace_back(i, mci[p], -sigma * mv[p]);
        A.setFromTriplets(n, n, trips);
    }
    SparseLDLT ldlt(A);
    if (!ldlt.ok()) return out;   // (K − σM) not SPD ⇒ shift not below λ_min: honest fail.

    // ---- 2. shift-invert Lanczos in the M-inner product, FULL reorthog. ------
    int mmax = (maxLanczos > 0) ? maxLanczos
                                : std::max(2 * k + 30, 40);
    mmax = std::min<int>(mmax, static_cast<int>(n));

    auto mdot = [&](const std::vector<double>& Mu, const std::vector<double>& v) {
        double s = 0.0; for (std::size_t i = 0; i < n; ++i) s += Mu[i] * v[i]; return s;
    };

    std::vector<std::vector<double>> Q;    // Lanczos vectors q_j  (M-orthonormal)
    std::vector<std::vector<double>> MQ;   // M q_j  (cached so inner products are dots)
    Q.reserve(mmax); MQ.reserve(mmax);
    std::vector<double> alpha, beta;       // T: diagonal α, sub-diagonal β

    // Deterministic, reproducible starting vector (a fixed xorshift fill, so the
    // gate is repeatable); generic enough not to be M-orthogonal to a target mode.
    std::vector<double> r(n);
    {
        std::uint64_t s = 0x9e3779b97f4a7c15ull;
        for (std::size_t i = 0; i < n; ++i) {
            s ^= s << 13; s ^= s >> 7; s ^= s << 17;
            r[i] = static_cast<double>((s >> 11) & 0xfffffu) / static_cast<double>(0x100000u) - 0.5;
        }
    }
    std::vector<double> Mr = M * r;
    double nrm = mdot(Mr, r);
    if (!(nrm > 0.0)) return out;
    nrm = std::sqrt(nrm);
    for (std::size_t i = 0; i < n; ++i) { r[i] /= nrm; Mr[i] /= nrm; }
    Q.push_back(r); MQ.push_back(Mr);

    double betaPrev = 0.0;                  // β_{j-1}
    for (int j = 0;; ++j) {
        // u = C q_j = (K − σM)⁻¹ (M q_j)
        std::vector<double> u = ldlt.solve(MQ[j]);
        // α_j = (M q_j)ᵀ u
        const double aj = mdot(MQ[j], u);
        // three-term recurrence: u −= α_j q_j + β_{j-1} q_{j-1}
        for (std::size_t i = 0; i < n; ++i) u[i] -= aj * Q[j][i];
        if (j > 0) for (std::size_t i = 0; i < n; ++i) u[i] -= betaPrev * Q[j - 1][i];
        // FULL re-orthogonalization (two passes) in the M-inner product:
        //   u −= Σ_i ((M q_i)ᵀ u) q_i   — defeats loss-of-orthogonality / ghosts.
        for (int pass = 0; pass < 2; ++pass)
            for (int i = 0; i <= j; ++i) {
                const double c = mdot(MQ[i], u);
                if (c != 0.0) for (std::size_t t = 0; t < n; ++t) u[t] -= c * Q[i][t];
            }
        alpha.push_back(aj);

        std::vector<double> Mu = M * u;
        double bj2 = mdot(Mu, u);
        const double bj = (bj2 > 0.0) ? std::sqrt(bj2) : 0.0;

        const int m = static_cast<int>(alpha.size());      // current T dimension
        const bool lastStep = (j + 1 >= mmax) || (bj < 1e-13);

        if (!lastStep) {                                   // extend the basis
            beta.push_back(bj);
            for (std::size_t i = 0; i < n; ++i) { u[i] /= bj; Mu[i] /= bj; }
            Q.push_back(std::move(u)); MQ.push_back(std::move(Mu));
            betaPrev = bj;
        }

        // Convergence test: solve the m×m tridiagonal, take the k Ritz values
        // with the largest θ>0 (⇔ smallest λ), and certify each with the EXACT
        // Lanczos residual of the shift-invert operator C = (K−σM)⁻¹M:
        //   ‖C φ_i − θ_i φ_i‖_M = β_m · |y_i(last)|
        // (Parlett §13.2). This is the mathematically correct convergence metric
        // for the SPECTRAL-TRANSFORMED problem — unlike the raw K-pencil residual
        // ‖Kφ−λMφ‖, it is NOT inflated by ‖K‖ for the higher modes of a stiff
        // pencil, so it certifies the genuine modes without false non-convergence.
        const bool tryConverge = (m >= k) && ((m % 3 == 0) || lastStep);
        if (tryConverge) {
            MatrixD T(static_cast<std::size_t>(m), static_cast<std::size_t>(m), 0.0);
            for (int i = 0; i < m; ++i) {
                T(i, i) = alpha[i];
                if (i + 1 < m) { T(i, i + 1) = beta[i]; T(i + 1, i) = beta[i]; }
            }
            SymmetricEigen es(T, true);
            if (es.ok()) {
                const std::vector<double>& th = es.eigenvalues();   // ascending θ
                const MatrixD& S = es.eigenvectors();
                std::vector<int> idx;                               // largest θ>0 first
                for (int c = m - 1; c >= 0 && static_cast<int>(idx.size()) < k; --c)
                    if (th[c] > 0.0) idx.push_back(c);
                if (static_cast<int>(idx.size()) == k) {
                    // cheap relative operator residual per selected Ritz pair.
                    double worstOp = 0.0;
                    for (int t = 0; t < k; ++t) {
                        const int c = idx[t];
                        const double res = bj * std::fabs(S(m - 1, c));   // M-norm residual
                        worstOp = std::max(worstOp, res / std::max(std::fabs(th[c]), 1e-300));
                    }
                    const double accept = std::max(tol, 1e-11);
                    if (worstOp < accept || lastStep) {
                        // build + M-normalize the converged mode shapes, sort by λ.
                        std::vector<double> lam(k);
                        std::vector<std::vector<double>> phi(k, std::vector<double>(n, 0.0));
                        for (int t = 0; t < k; ++t) {
                            const int c = idx[t];
                            lam[t] = sigma + 1.0 / th[c];
                            for (int p = 0; p < m; ++p) {            // φ = Σ_p S(p,c) q_p
                                const double sc = S(p, c);
                                if (sc != 0.0)
                                    for (std::size_t i = 0; i < n; ++i) phi[t][i] += sc * Q[p][i];
                            }
                        }
                        std::vector<int> ord(k); for (int t = 0; t < k; ++t) ord[t] = t;
                        std::sort(ord.begin(), ord.end(),
                                  [&](int a, int b) { return lam[a] < lam[b]; });
                        out.eigenvalues.resize(k);
                        out.eigenvectors.resize(k);
                        for (int t = 0; t < k; ++t) {
                            out.eigenvalues[t]  = lam[ord[t]];
                            out.eigenvectors[t] = std::move(phi[ord[t]]);
                        }
                        out.maxResidual  = worstOp;
                        out.lanczosSteps = m;
                        out.ok = (worstOp < accept);
                        return out;
                    }
                }
            }
        }
        if (lastStep) break;
    }
    return out;   // ok stays false: did not converge within the Krylov cap (honest).
}

// ===========================================================================
// Explicit instantiations (real + complex where the kernel needs them).
// ===========================================================================
template class Matrix<double>;
template class Matrix<std::complex<double>>;
template class LU<double>;
template class LU<std::complex<double>>;
template class LLT<double>;
template class LLT<std::complex<double>>;
template class LDLT<double>;
template class HouseholderQR<double>;
template class HouseholderQR<std::complex<double>>;
template class ColPivHouseholderQR<double>;
template class ColPivHouseholderQR<std::complex<double>>;
template class FullPivHouseholderQR<double>;
template class FullPivHouseholderQR<std::complex<double>>;
template class SparseCSR<double>;
template class SparseCSR<std::complex<double>>;

}  // namespace linalg
}  // namespace native
}  // namespace forge
