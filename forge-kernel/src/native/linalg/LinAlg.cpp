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
void LU<T>::compute(const Matrix<T>& A, bool fullPivot) {
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
    const Real tol = (maxA > 0 ? maxA : Real(1)) *
                     std::numeric_limits<Real>::epsilon() * Real(n) * Real(16);

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
// SparseLDLT — factor the sparse SPD matrix (densify-and-factor, exact + stable
// for the moderate-DOF FE blocks; CSR is the assembly interchange format).
// ===========================================================================
void SparseLDLT::compute(const SparseCSR<double>& A) {
    const std::size_t n = A.rows();
    n_ = n; ok_ = (A.rows() == A.cols());
    L_ = Matrix<double>(n, n, 0.0);
    d_.assign(n, 0.0);
    if (!ok_) return;

    Matrix<double> M = A.toDense();
    // symmetrize (assembly may have produced tiny asymmetry)
    for (std::size_t i = 0; i < n; ++i)
        for (std::size_t j = i + 1; j < n; ++j) {
            double m = 0.5 * (M(i, j) + M(j, i));
            M(i, j) = M(j, i) = m;
        }
    // LDLᵀ for SPD (all D pivots > 0)
    for (std::size_t j = 0; j < n; ++j) {
        double dj = M(j, j);
        for (std::size_t k = 0; k < j; ++k) dj -= L_(j, k) * L_(j, k) * d_[k];
        if (!(dj > 0.0)) { ok_ = false; return; }
        d_[j] = dj;
        L_(j, j) = 1.0;
        for (std::size_t i = j + 1; i < n; ++i) {
            double s = M(i, j);
            for (std::size_t k = 0; k < j; ++k) s -= L_(i, k) * L_(j, k) * d_[k];
            L_(i, j) = s / dj;
        }
    }
}

std::vector<double> SparseLDLT::solve(const std::vector<double>& b) const {
    const std::size_t n = n_;
    std::vector<double> y(b);
    for (std::size_t i = 0; i < n; ++i) {
        double s = y[i];
        for (std::size_t k = 0; k < i; ++k) s -= L_(i, k) * y[k];
        y[i] = s;  // L unit lower
    }
    for (std::size_t i = 0; i < n; ++i) y[i] /= d_[i];
    for (std::size_t ii = 0; ii < n; ++ii) {
        std::size_t i = n - 1 - ii;
        double s = y[i];
        for (std::size_t k = i + 1; k < n; ++k) s -= L_(k, i) * y[k];
        y[i] = s;
    }
    return y;
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
template class SparseCSR<double>;
template class SparseCSR<std::complex<double>>;

}  // namespace linalg
}  // namespace native
}  // namespace forge
