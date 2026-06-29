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
//   SparseLDLT — symmetric factorization driven from CSR assembly.
//   conjugateGradient — Hestenes-Stiefel CG with Jacobi preconditioner.

#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <utility>
#include <vector>

namespace forge {
namespace native {
namespace linalg {

namespace {

template <class T>
typename ScalarTraits<T>::Real absT(const T& x) { return ScalarTraits<T>::absval(x); }

}  // namespace

// ===========================================================================
// LU
// ===========================================================================
template <class T>
void LU<T>::compute(const Matrix<T>& A, bool fullPivot, bool rankRevealing) {
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

}  // namespace

void SparseLDLT::compute(const SparseCSR<double>& A) {
    const std::size_t n = A.rows();
    n_ = n;
    ok_ = (A.rows() == A.cols());
    perm_.clear(); iperm_.clear();
    Lp_.clear(); Li_.clear(); Lx_.clear();
    d_.assign(n, 0.0);
    if (!ok_) return;
    if (n == 0) { Lp_.assign(1, 0); ok_ = true; return; }

    // ---- 1. FILL-REDUCING ORDERING (Reverse Cuthill-McKee) ----------------
    std::vector<std::vector<std::size_t>> adj = buildAdjacency(A);
    perm_ = reverseCuthillMcKee(adj);
    iperm_.assign(n, 0);
    for (std::size_t k = 0; k < n; ++k) iperm_[perm_[k]] = k;

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

std::vector<double> SparseLDLT::solve(const std::vector<double>& b) const {
    const std::size_t n = n_;
    std::vector<double> x(n, 0.0);
    if (!ok_ || b.size() != n) return x;
    if (n == 0) return x;

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
