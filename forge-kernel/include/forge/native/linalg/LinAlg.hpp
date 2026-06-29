// forge/native/linalg/LinAlg.hpp
//
// forge::native::linalg — an in-house, pure-C++20, standard-library-only linear
// algebra library: the planned REPLACEMENT for Eigen across the Forge kernel's
// FE / multibody / CFD / circuit / modal solvers.
//
//   NO Eigen. NO OCCT. NO WASM. NO third-party dependency of ANY kind — just a
//   C++20 compiler and <vector>/<array>/<complex>/<cmath>. This module is
//   STANDALONE: nothing here includes a Forge kernel header that pulls in Eigen,
//   and nothing here links against Eigen. (The validation gate in
//   test/native/linalg/linalg_test.cpp links Eigen IN THE TEST ONLY, purely as a
//   numerical oracle to cross-check this library to machine precision; the
//   library proper is Eigen-free and that is enforced by the no-deps native
//   build in run_native.sh.)
//
// WHY THIS EXISTS (recon, KERNEL_INHOUSE_ROADMAP / NUMERICS TRACK #1):
//   Eigen is currently the kernel's dense+sparse backbone. The exact API surface
//   the production solvers consume was enumerated; every routine below maps 1:1
//   to one or more of those call sites so a later increment can swap them
//   mechanically. The Eigen analogue is named in each block.
//
//   Dense decompositions
//     LU<T>            partial-pivot LU solve / general dense A x = b / inverse
//                      <- Eigen FullPivLU/PartialPivLU  (PowerFlow, ShortCircuit,
//                         MultibodyDynamics KKT, general .solve())
//     LLT<T>           Cholesky of SPD A = L Lᵀ, solve
//                      <- Eigen LLT  (Fea Q6 9x9 condensation; dense SPD)
//     LDLT<T>          symmetric (incl. INDEFINITE) A = P L D Lᵀ Pᵀ with
//                      Bunch-Kaufman 1x1/2x2 pivoting, solve
//                      <- Eigen LDLT  (MultibodyDynamics M a = rhs AND the
//                         indefinite KKT saddle [M Jᵀ; J -εI]; ThermalNetwork;
//                         FrameTruss)
//     HouseholderQR<T> Householder QR + least-squares solve of overdetermined
//                      A x ≈ b  (and exact square solve)
//                      <- Eigen colPivHouseholderQr  (NurbsFit, Circuit MNA DC/AC)
//
//   Dense eigensolvers (the MODAL core)
//     SymmetricEigen<T>          Householder tridiagonalization -> implicit-shift
//                                QL with Wilkinson shift + eigenvector
//                                accumulation; ALL eigenpairs, ascending
//                                eigenvalues, orthonormal eigenvectors.
//                                <- Eigen SelfAdjointEigenSolver  (Mohr 3x3, and
//                                   the building block of the generalized solver)
//     GeneralizedSymmetricEigen  K φ = λ M φ via Cholesky-of-M reduction
//                                (M = L Lᵀ, C = L⁻¹ K L⁻ᵀ, standard symmetric
//                                eig of C, back-transform φ = L⁻ᵀ y). Ascending
//                                λ, M-orthonormal eigenvectors.
//                                <- Eigen GeneralizedSelfAdjointEigenSolver
//                                   (Fea modal, FeaContact buckling, FrameTruss)
//
//   Sparse (the FE workhorse)
//     Triplet<T> / fromTriplets  triplet -> compressed-sparse-row assembler,
//                                mirroring Eigen's Triplet + setFromTriplets so
//                                the FE assembly loops swap 1:1.
//     SparseCSR<T>               CSR storage, y = A x, diagonal, symmetric check.
//     SparseLDLT<T>              up-looking sparse Cholesky/LDLT of a sparse SPD
//                                matrix with factor-once / solve-many.
//                                <- Eigen SimplicialLDLT  (10 FE/CFD sites)
//     conjugateGradient          Jacobi-preconditioned CG for sparse SPD systems
//                                (the large-DOF iterative path).
//
// HONEST POSTURE: these are double-precision (or std::complex) floating-point
// factorizations. They are numerically stabilized by pivoting (LU full/partial,
// LDLT Bunch-Kaufman) and orthogonal transforms (QR, symmetric eig), and are
// validated by the gate against BOTH Eigen (to ~1e-10) AND analytic closed forms
// (1-D Laplacian eigenvalues λ_k = 2-2cos(kπ/(n+1)), known SPD solves, a known
// KKT saddle, 2-D Poisson CG, a known generalized eigenproblem). No bit-exactness
// is claimed; what is guaranteed is the stated residual/error bound.

#ifndef FORGE_NATIVE_LINALG_LINALG_HPP
#define FORGE_NATIVE_LINALG_LINALG_HPP

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstddef>
#include <type_traits>
#include <vector>

namespace forge {
namespace native {
namespace linalg {

// ===========================================================================
// Scalar helpers — make the templates work for both `double` and
// `std::complex<double>` (Circuit AC / ShortCircuit / PowerFlow need complex).
// ===========================================================================
template <class T> struct ScalarTraits {
    using Real = T;
    static Real absval(const T& x) { return std::abs(x); }
    static T    conj(const T& x) { return x; }
    static Real realpart(const T& x) { return x; }
    static bool finite(const T& x) { return std::isfinite(x); }
};
template <class R> struct ScalarTraits<std::complex<R>> {
    using Real = R;
    static Real absval(const std::complex<R>& x) { return std::abs(x); }
    static std::complex<R> conj(const std::complex<R>& x) { return std::conj(x); }
    static Real realpart(const std::complex<R>& x) { return x.real(); }
    static bool finite(const std::complex<R>& x) {
        return std::isfinite(x.real()) && std::isfinite(x.imag());
    }
};

// ===========================================================================
// Dense matrix (row-major, runtime dims). Minimal but complete for the kernel.
// ===========================================================================
template <class T>
class Matrix {
public:
    Matrix() : r_(0), c_(0) {}
    Matrix(std::size_t r, std::size_t c, const T& v = T(0))
        : r_(r), c_(c), a_(r * c, v) {}

    std::size_t rows() const { return r_; }
    std::size_t cols() const { return c_; }
    std::size_t size() const { return a_.size(); }

    T&       operator()(std::size_t i, std::size_t j)       { return a_[i * c_ + j]; }
    const T& operator()(std::size_t i, std::size_t j) const { return a_[i * c_ + j]; }

    T*       data()       { return a_.data(); }
    const T* data() const { return a_.data(); }

    void setZero() { std::fill(a_.begin(), a_.end(), T(0)); }
    void resize(std::size_t r, std::size_t c, const T& v = T(0)) {
        r_ = r; c_ = c; a_.assign(r * c, v);
    }

    static Matrix Identity(std::size_t n) {
        Matrix m(n, n, T(0));
        for (std::size_t i = 0; i < n; ++i) m(i, i) = T(1);
        return m;
    }
    static Matrix Zero(std::size_t r, std::size_t c) { return Matrix(r, c, T(0)); }

    Matrix transpose() const {
        Matrix t(c_, r_);
        for (std::size_t i = 0; i < r_; ++i)
            for (std::size_t j = 0; j < c_; ++j) t(j, i) = (*this)(i, j);
        return t;
    }
    // conjugate transpose (Hermitian adjoint) — equals transpose for real T.
    Matrix adjoint() const {
        Matrix t(c_, r_);
        for (std::size_t i = 0; i < r_; ++i)
            for (std::size_t j = 0; j < c_; ++j)
                t(j, i) = ScalarTraits<T>::conj((*this)(i, j));
        return t;
    }

    Matrix operator*(const Matrix& B) const {
        Matrix C(r_, B.c_, T(0));
        for (std::size_t i = 0; i < r_; ++i)
            for (std::size_t k = 0; k < c_; ++k) {
                const T aik = (*this)(i, k);
                for (std::size_t j = 0; j < B.c_; ++j) C(i, j) += aik * B(k, j);
            }
        return C;
    }
    std::vector<T> operator*(const std::vector<T>& x) const {
        std::vector<T> y(r_, T(0));
        for (std::size_t i = 0; i < r_; ++i) {
            T s = T(0);
            for (std::size_t j = 0; j < c_; ++j) s += (*this)(i, j) * x[j];
            y[i] = s;
        }
        return y;
    }
    Matrix operator+(const Matrix& B) const {
        Matrix C(r_, c_);
        for (std::size_t i = 0; i < a_.size(); ++i) C.a_[i] = a_[i] + B.a_[i];
        return C;
    }
    Matrix operator-(const Matrix& B) const {
        Matrix C(r_, c_);
        for (std::size_t i = 0; i < a_.size(); ++i) C.a_[i] = a_[i] - B.a_[i];
        return C;
    }

    bool allFinite() const {
        for (const T& x : a_) if (!ScalarTraits<T>::finite(x)) return false;
        return true;
    }

    // --- row / column / block accessors (the Eigen .row()/.col()/.block() analogs
    //     the FE assembly loops use; explicit copies, no expression-template view).
    std::vector<T> row(std::size_t i) const {
        std::vector<T> v(c_);
        for (std::size_t j = 0; j < c_; ++j) v[j] = (*this)(i, j);
        return v;
    }
    std::vector<T> col(std::size_t j) const {
        std::vector<T> v(r_);
        for (std::size_t i = 0; i < r_; ++i) v[i] = (*this)(i, j);
        return v;
    }
    void setRow(std::size_t i, const std::vector<T>& v) {
        for (std::size_t j = 0; j < c_; ++j) (*this)(i, j) = v[j];
    }
    void setCol(std::size_t j, const std::vector<T>& v) {
        for (std::size_t i = 0; i < r_; ++i) (*this)(i, j) = v[i];
    }
    // p×q submatrix whose top-left is (i0,j0).
    Matrix block(std::size_t i0, std::size_t j0, std::size_t p, std::size_t q) const {
        Matrix s(p, q);
        for (std::size_t i = 0; i < p; ++i)
            for (std::size_t j = 0; j < q; ++j) s(i, j) = (*this)(i0 + i, j0 + j);
        return s;
    }
    // write / accumulate a sub-block at (i0,j0): the Eigen `block(...) = X` / `+= X`.
    void setBlock(std::size_t i0, std::size_t j0, const Matrix& s) {
        for (std::size_t i = 0; i < s.rows(); ++i)
            for (std::size_t j = 0; j < s.cols(); ++j) (*this)(i0 + i, j0 + j) = s(i, j);
    }
    void addBlock(std::size_t i0, std::size_t j0, const Matrix& s) {
        for (std::size_t i = 0; i < s.rows(); ++i)
            for (std::size_t j = 0; j < s.cols(); ++j) (*this)(i0 + i, j0 + j) += s(i, j);
    }

private:
    std::size_t r_, c_;
    std::vector<T> a_;
};

using MatrixD = Matrix<double>;
using MatrixC = Matrix<std::complex<double>>;

// vector helpers (free functions, std::vector is the "Vector")
template <class T> using Vector = std::vector<T>;

template <class T>
typename ScalarTraits<T>::Real normInf(const std::vector<T>& v) {
    typename ScalarTraits<T>::Real m = 0;
    for (const T& x : v) { auto a = ScalarTraits<T>::absval(x); if (a > m) m = a; }
    return m;
}
template <class T>
typename ScalarTraits<T>::Real norm2(const std::vector<T>& v) {
    typename ScalarTraits<T>::Real s = 0;
    for (const T& x : v) { auto a = ScalarTraits<T>::absval(x); s += a * a; }
    return std::sqrt(s);
}
inline std::array<double, 3> cross3(const std::array<double, 3>& a,
                                    const std::array<double, 3>& b) {
    return {{a[1] * b[2] - a[2] * b[1],
             a[2] * b[0] - a[0] * b[2],
             a[0] * b[1] - a[1] * b[0]}};
}

// --- std::vector arithmetic helpers (the Eigen VectorXd op analogs the FE loops
//     use; explicit, allocation-light). vdot is the PLAIN (non-conjugated) dot —
//     correct for the real-double FE/CFD systems; complex callers must conjugate
//     explicitly. vseg/vsetseg/vaddseg are the .segment()/.head()/.tail() analogs.
template <class T>
std::vector<T> vseg(const std::vector<T>& v, std::size_t i, std::size_t k) {
    return std::vector<T>(v.begin() + static_cast<std::ptrdiff_t>(i),
                          v.begin() + static_cast<std::ptrdiff_t>(i + k));
}
template <class T>
void vsetseg(std::vector<T>& v, std::size_t i, const std::vector<T>& s) {
    for (std::size_t j = 0; j < s.size(); ++j) v[i + j] = s[j];
}
template <class T>
void vaddseg(std::vector<T>& v, std::size_t i, const std::vector<T>& s) {
    for (std::size_t j = 0; j < s.size(); ++j) v[i + j] += s[j];
}
template <class T>
std::vector<T> vadd(const std::vector<T>& a, const std::vector<T>& b) {
    std::vector<T> r(a.size());
    for (std::size_t i = 0; i < a.size(); ++i) r[i] = a[i] + b[i];
    return r;
}
template <class T>
std::vector<T> vsub(const std::vector<T>& a, const std::vector<T>& b) {
    std::vector<T> r(a.size());
    for (std::size_t i = 0; i < a.size(); ++i) r[i] = a[i] - b[i];
    return r;
}
template <class T>
std::vector<T> vscale(const std::vector<T>& a, const T& s) {
    std::vector<T> r(a.size());
    for (std::size_t i = 0; i < a.size(); ++i) r[i] = a[i] * s;
    return r;
}
template <class T>
T vdot(const std::vector<T>& a, const std::vector<T>& b) {
    T s = T(0);
    for (std::size_t i = 0; i < a.size(); ++i) s += a[i] * b[i];
    return s;
}
template <class T>
void vaxpy(std::vector<T>& y, const T& a, const std::vector<T>& x) {  // y += a*x
    for (std::size_t i = 0; i < y.size(); ++i) y[i] += a * x[i];
}

// ===========================================================================
// LU — partial-pivot LU with optional full pivoting. General dense A x = b,
// inverse, determinant. Works for real and complex T.
//   <- Eigen FullPivLU / PartialPivLU / .fullPivLu().solve() / .inverse()
// ===========================================================================
template <class T>
class LU {
public:
    LU() = default;
    explicit LU(const Matrix<T>& A, bool fullPivot = true, bool rankRevealing = true) {
        compute(A, fullPivot, rankRevealing);
    }
    // rankRevealing=true (default): a pivot below maxA·eps·n·16 marks the matrix
    // numerically singular (correct for rank queries on general matrices).
    // rankRevealing=false: only a near-exact-zero pivot (maxA·1e-30) marks it
    // singular — the LAPACK/Eigen-SparseLU posture for factoring a well-posed but
    // wide-dynamic-range system (e.g. a penalty-method FE matrix spanning 1e9..1e20).
    void compute(const Matrix<T>& A, bool fullPivot = true, bool rankRevealing = true);

    bool ok() const { return ok_; }
    std::size_t rank() const { return rank_; }
    // solve A x = b (b length n). Returns x; on singular A, x has the
    // min-norm-ish least-squares of the non-deficient part (ok()=false set).
    std::vector<T> solve(const std::vector<T>& b) const;
    Matrix<T> solve(const Matrix<T>& B) const;  // multiple RHS (columns)
    Matrix<T> inverse() const;
    T determinant() const;

private:
    Matrix<T> lu_;
    std::vector<std::size_t> p_, q_;  // row perm, col perm (full pivot)
    int sign_ = 1;
    std::size_t n_ = 0, rank_ = 0;
    bool full_ = true, ok_ = false;
};

// ===========================================================================
// LLT — Cholesky of a symmetric/Hermitian POSITIVE-DEFINITE matrix, A = L Lᵀ.
//   <- Eigen LLT  (Fea Q6 condensation, dense SPD systems)
// ===========================================================================
template <class T>
class LLT {
public:
    LLT() = default;
    explicit LLT(const Matrix<T>& A) { compute(A); }
    void compute(const Matrix<T>& A);
    bool ok() const { return ok_; }          // false if not positive-definite
    std::vector<T> solve(const std::vector<T>& b) const;
    Matrix<T> solve(const Matrix<T>& B) const;
    const Matrix<T>& matrixL() const { return L_; }  // lower-triangular factor

private:
    Matrix<T> L_;
    std::size_t n_ = 0;
    bool ok_ = false;
};

// ===========================================================================
// LDLT — symmetric (incl. INDEFINITE) factorization A = P L D Lᵀ Pᵀ via
// Bunch-Kaufman 1x1 / 2x2 pivoting. This is the correct factorization for the
// multibody KKT saddle [M Jᵀ; J -εI] which is symmetric indefinite.
//   <- Eigen LDLT  (MultibodyDynamics M a=rhs and KKT, ThermalNetwork, FrameTruss)
// ===========================================================================
template <class T>
class LDLT {
public:
    LDLT() = default;
    explicit LDLT(const Matrix<T>& A) { compute(A); }
    void compute(const Matrix<T>& A);
    bool ok() const { return ok_; }          // false only if exactly singular
    bool isPositive() const { return positive_; }  // all 1x1 pivots > 0
    std::vector<T> solve(const std::vector<T>& b) const;

private:
    // Block factorization stored implicitly: L (unit lower, with block columns),
    // D as a sequence of 1x1 / 2x2 blocks, and a permutation.
    Matrix<T> L_;
    std::vector<T> d1_;                       // 1x1 pivot, or 2x2 stored in d1/d2/off
    std::vector<int> blockSize_;              // 1 or 2, indexed by leading position
    std::vector<std::array<T, 4>> block2_;    // [d00,d01,d10,d11] for 2x2 pivots
    std::vector<std::size_t> perm_;
    std::size_t n_ = 0;
    bool ok_ = false, positive_ = false;
};

// ===========================================================================
// HouseholderQR — A = Q R via Householder reflectors. Least-squares solve of
// overdetermined A x ≈ b (and exact solve when square nonsingular).
//   <- Eigen colPivHouseholderQr().solve()  (NurbsFit, Circuit MNA DC/AC)
// ===========================================================================
template <class T>
class HouseholderQR {
public:
    HouseholderQR() = default;
    explicit HouseholderQR(const Matrix<T>& A) { compute(A); }
    void compute(const Matrix<T>& A);
    bool ok() const { return ok_; }
    // minimizes ||A x - b||_2 for m>=n; exact for square nonsingular.
    std::vector<T> solve(const std::vector<T>& b) const;
    Matrix<T> matrixQ() const;   // explicit m x m Q (for QᵀQ=I checks)
    const Matrix<T>& matrixR() const { return R_; }  // m x n, upper-triangular top

private:
    Matrix<T> qr_;               // packed reflectors below diag, R on/above diag
    Matrix<T> R_;
    std::vector<T> beta_;        // reflector scales
    std::vector<T> v0store_;     // leading (k-th) reflector component per column
    std::size_t m_ = 0, n_ = 0;
    bool ok_ = false;
};

// ===========================================================================
// ColPivHouseholderQR — RANK-REVEALING Householder QR with column pivoting:
// A P = Q R, |R₀₀| ≥ |R₁₁| ≥ … . solve() returns the basic least-squares solution
// (free columns set to 0) for square / over- / under-determined AND rank-deficient
// A — the robust dense QR the geometric-constraint solver needs.
//   <- Eigen ColPivHouseholderQR / FullPivHouseholderQR  (PlaneGCS DogLeg/LM/SQP;
//      also lets AssemblySolver drop its dense-normal-equations workaround)
// ===========================================================================
template <class T>
class ColPivHouseholderQR {
public:
    ColPivHouseholderQR() = default;
    explicit ColPivHouseholderQR(const Matrix<T>& A) { compute(A); }
    void compute(const Matrix<T>& A);
    bool ok() const { return ok_; }
    std::size_t rank() const { return rank_; }     // numerical rank (pivot threshold)
    std::vector<T> solve(const std::vector<T>& b) const;  // basic min-residual solution

private:
    Matrix<T> qr_;                     // R on/above diag, reflectors below
    std::vector<T> beta_, v0_;         // reflector scales + leading components
    std::vector<std::size_t> perm_;    // column k of qr_ == column perm_[k] of A
    std::size_t m_ = 0, n_ = 0, rank_ = 0;
    bool ok_ = false;
};

// ===========================================================================
// FullPivHouseholderQR — RANK-REVEALING Householder QR with FULL pivoting
// (both rows AND columns). At each step k the entry of largest magnitude in the
// active trailing submatrix qr_(k:m, k:n) is brought to position (k,k) by a row
// transposition AND a column transposition before the reflector is built. This
// is the most numerically prudent (and rank-faithful) dense QR, and is an exact
// 1:1 reimplementation of Eigen's FullPivHouseholderQR semantics — including the
// packed-matrix layout (R on/above the diagonal, the Householder essential part
// below, the new pivot/diagonal stored on the diagonal), the tail-only row swap,
// the τ ("hCoeffs") reflector scaling, the cols-permutation built from the raw
// column transpositions, and the row-transposition-aware explicit Q. It is the
// keystone for removing the last Eigen dependency: PlaneGCS reconstructs
// Aᵀ = Q·R·Pᵀ from exactly this decomposition and its null/range split depends
// on the precise full pivoting.
//
//   Reconstruction identity (verified to machine precision vs Eigen):
//       matrixQ() * R_upper * Pᵀ == A
//   where R_upper is the m×n upper-triangular part of matrixQR(), P is
//   colsPermutation(), and matrixQ() already folds in the row transpositions.
//
//   <- Eigen FullPivHouseholderQR  (PlaneGCS sketch solver: it uses
//      Eigen::FullPivHouseholderQR; replacing it removes the last Eigen include)
// ===========================================================================
template <class T>
class FullPivHouseholderQR {
public:
    FullPivHouseholderQR() = default;
    explicit FullPivHouseholderQR(const Matrix<T>& A) { compute(A); }
    void compute(const Matrix<T>& A);

    bool ok() const { return ok_; }                 // false if non-finite input or m==0
    std::size_t rows() const { return m_; }          // ORIGINAL dims of A
    std::size_t cols() const { return n_; }
    std::size_t rank() const;                        // numerical rank (uses threshold)

    // Prescribed rank threshold (the Eigen setThreshold analog). 0 (default) =>
    // use eps*min(m,n) automatically. Stored; rank() recomputes from it, so it
    // may be set before OR after compute().
    void setThreshold(double t) { prescribed_ = t; }

    // Packed factor: R on/above the diagonal, Householder essential parts below,
    // the new pivot on each diagonal entry (Eigen matrixQR() layout).
    const Matrix<T>& matrixQR() const { return qr_; }

    // Explicit m×m orthogonal/unitary Q INCLUDING the row transpositions, so that
    // matrixQ() * R_upper * Pᵀ == A.
    Matrix<T> matrixQ() const;

    // Column permutation P: column k of qr_ == column perm_[k] of A, i.e. A·P
    // brings A's column perm_[k] into position k (Eigen colsPermutation indices).
    const std::vector<std::size_t>& colsPermutation() const { return perm_; }

    // rowTrans_[k] = the row swapped to position k at step k (Eigen
    // rowsTranspositions); length min(m,n).
    const std::vector<std::size_t>& rowsTranspositions() const { return rowTrans_; }

    // min-residual / basic solution (exact for square nonsingular, least-squares
    // for full column rank, free columns zeroed for rank-deficient A).
    std::vector<T> solve(const std::vector<T>& b) const;

private:
    Matrix<T> qr_;                      // packed reflectors + R (Eigen layout)
    std::vector<T> hcoeffs_;            // τ per reflector step (Eigen hCoeffs)
    std::vector<std::size_t> rowTrans_; // raw row transpositions, length min(m,n)
    std::vector<std::size_t> colTrans_; // raw column transpositions, length min(m,n)
    std::vector<std::size_t> perm_;     // column permutation (derived from colTrans_)
    std::size_t m_ = 0, n_ = 0, nonzero_ = 0;
    double prescribed_ = 0.0;
    bool ok_ = false;
};

// ===========================================================================
// SymmetricEigen — real symmetric dense eigensolver. Householder
// tridiagonalization -> implicit-shift QL with Wilkinson shift, eigenvectors
// accumulated. Eigenvalues ASCENDING, eigenvectors orthonormal (columns of V).
//   <- Eigen SelfAdjointEigenSolver
// ===========================================================================
class SymmetricEigen {
public:
    SymmetricEigen() = default;
    explicit SymmetricEigen(const MatrixD& A, bool computeVectors = true) {
        compute(A, computeVectors);
    }
    void compute(const MatrixD& A, bool computeVectors = true);
    bool ok() const { return ok_; }
    const std::vector<double>& eigenvalues() const { return eval_; }
    // column i of V is the unit eigenvector for eigenvalues()[i].
    const MatrixD& eigenvectors() const { return V_; }

private:
    std::vector<double> eval_;
    MatrixD V_;
    bool ok_ = false;
};

// ===========================================================================
// GeneralizedSymmetricEigen — K φ = λ M φ, K symmetric, M symmetric POSITIVE
// DEFINITE. Cholesky-of-M reduction: M = L Lᵀ, C = L⁻¹ K L⁻ᵀ symmetric, solve
// standard symmetric eig of C, back-transform φ = L⁻ᵀ y. Eigenvalues ASCENDING,
// eigenvectors M-orthonormal (φᵢᵀ M φⱼ = δᵢⱼ). This is the MODAL solver core.
//   <- Eigen GeneralizedSelfAdjointEigenSolver(K, M, Ax_lBx | ComputeEigenvectors)
// ===========================================================================
class GeneralizedSymmetricEigen {
public:
    GeneralizedSymmetricEigen() = default;
    GeneralizedSymmetricEigen(const MatrixD& K, const MatrixD& M,
                              bool computeVectors = true) {
        compute(K, M, computeVectors);
    }
    // ok()=false if M is not positive-definite.
    void compute(const MatrixD& K, const MatrixD& M, bool computeVectors = true);
    bool ok() const { return ok_; }
    const std::vector<double>& eigenvalues() const { return eval_; }
    const MatrixD& eigenvectors() const { return V_; }  // columns = M-orthonormal modes

private:
    std::vector<double> eval_;
    MatrixD V_;
    bool ok_ = false;
};

// ===========================================================================
// Sparse: triplet -> CSR assembler (mirrors Eigen Triplet + setFromTriplets).
// ===========================================================================
template <class T>
struct Triplet {
    std::size_t row, col;
    T value;
    Triplet() : row(0), col(0), value(T(0)) {}
    Triplet(std::size_t r, std::size_t c, const T& v) : row(r), col(c), value(v) {}
};

template <class T>
class SparseCSR {
public:
    SparseCSR() : rows_(0), cols_(0) {}
    SparseCSR(std::size_t rows, std::size_t cols) : rows_(rows), cols_(cols) {}

    std::size_t rows() const { return rows_; }
    std::size_t cols() const { return cols_; }
    std::size_t nnz() const { return val_.size(); }

    const std::vector<std::size_t>& rowPtr() const { return rowPtr_; }
    const std::vector<std::size_t>& colIdx() const { return colIdx_; }
    const std::vector<T>&           values() const { return val_; }

    // Assemble from triplets, SUMMING duplicates (exactly Eigen's setFromTriplets
    // semantics) and producing sorted, compressed CSR.
    void setFromTriplets(std::size_t rows, std::size_t cols,
                         const std::vector<Triplet<T>>& trips);

    std::vector<T> operator*(const std::vector<T>& x) const;  // y = A x
    std::vector<T> diagonal() const;
    Matrix<T> toDense() const;
    T coeff(std::size_t i, std::size_t j) const;  // O(row nnz) lookup

private:
    std::size_t rows_, cols_;
    std::vector<std::size_t> rowPtr_, colIdx_;
    std::vector<T> val_;
};

// ---------------------------------------------------------------------------
// Sparse SPD direct solver — up-looking sparse Cholesky (LDLT form), factor
// once / solve many. Operates on the symmetric SPD matrix given in CSR.
//   <- Eigen SimplicialLDLT  (the 10 FE/CFD/normal-equation sites)
// ---------------------------------------------------------------------------
class SparseLDLT {
public:
    SparseLDLT() = default;
    explicit SparseLDLT(const SparseCSR<double>& A) { compute(A); }
    void compute(const SparseCSR<double>& A);
    bool ok() const { return ok_; }              // false if not SPD
    std::vector<double> solve(const std::vector<double>& b) const;

    // Diagnostic (for the large-scale test): number of stored nonzeros in the
    // strictly-lower factor L. Memory footprint is O(nnz(L)), NOT O(n²).
    std::size_t factorNnz() const { return Lx_.size(); }

private:
    // TRUE sparse LDLᵀ. The matrix is reordered by a fill-reducing permutation
    // (Reverse Cuthill-McKee), symbolically analyzed (elimination tree + column
    // counts give the exact fill), then factored up-looking. L is stored in
    // compressed-sparse-COLUMN form (strictly lower, unit diagonal implicit);
    // D is the diagonal of the LDLᵀ decomposition of the PERMUTED matrix.
    //
    // perm_[k]  = original index placed at permuted position k  (P: new<-old)
    // iperm_[i] = permuted position of original index i          (Pᵀ)
    std::vector<std::size_t> perm_, iperm_;
    std::vector<std::size_t> Lp_;   // column pointers into Li_/Lx_  (size n+1)
    std::vector<std::size_t> Li_;   // row indices of L (strictly lower)
    std::vector<double>      Lx_;   // numeric values of L
    std::vector<double>      d_;    // diagonal D of the permuted factorization
    std::size_t n_ = 0;
    bool ok_ = false;
};

// ---------------------------------------------------------------------------
// Sparse GENERAL (non-symmetric / indefinite) direct solver — TRUE sparse LU
// with partial pivoting (Gilbert-Peierls left-looking), factor-once / solve-many.
// For the moderate-to-large-DOF non-SPD FE systems Eigen solved with SparseLU
// (MoldFlow filling pressure, WeldingFea mechanical residual-stress). Memory is
// O(nnz(L)+nnz(U)), time is O(flops on the sparse pattern), so large banded
// non-symmetric FE/CFD systems (n in the 10⁴–10⁵ range) factor in a few MB and
// well under a second — infeasible with the previous dense O(n²)/O(n³) densify.
//   <- Eigen SparseLU
// ---------------------------------------------------------------------------
class SparseLU {
public:
    SparseLU() = default;
    explicit SparseLU(const SparseCSR<double>& A) { compute(A); }
    void compute(const SparseCSR<double>& A);
    bool ok() const { return ok_; }                  // false if non-square or singular
    std::vector<double> solve(const std::vector<double>& b) const;

    // Diagnostic (for the large-scale test): stored nonzeros in the factors L
    // (unit lower) + U (upper). Memory footprint is O(this), NOT O(n²).
    std::size_t factorNnz() const { return Lx_.size() + Ux_.size(); }

private:
    // TRUE sparse LU with partial pivoting. The matrix is COLUMN-pre-ordered by
    // a fill-reducing permutation (RCM on A+Aᵀ), then factored left-looking
    // (Gilbert-Peierls): for each column k a sparse triangular solve against the
    // already-built L drives a depth-first reachability/topological order, the
    // largest-magnitude entry on/below the diagonal is chosen as the partial
    // pivot (its row recorded), and L/U columns are appended. L (unit lower) and
    // U (upper, incl. the pivot diagonal) are stored in compressed-sparse-COLUMN
    // form. Solve applies the row perm to b, sparse-forward against L, sparse-
    // backward against U, then un-permutes the columns. All O(nnz(L)+nnz(U)).
    //
    // colperm_[k]  = original column placed at factored position k (Q: new<-old)
    // rowperm_[i]  = original row at factored row position i        (P: new<-old)
    // irowperm_[r] = factored row position of original row r        (Pᵀ)
    std::vector<std::size_t> colperm_;            // column ordering (size n)
    std::vector<std::size_t> rowperm_, irowperm_; // pivot row permutation (size n)
    std::vector<std::size_t> Lp_;   // column pointers into Li_/Lx_ (size n+1)
    std::vector<std::size_t> Li_;   // row indices of L, strict lower (factored frame)
    std::vector<double>      Lx_;   // numeric values of L (unit diagonal implicit)
    std::vector<std::size_t> Up_;   // column pointers into Ui_/Ux_ (size n+1)
    std::vector<std::size_t> Ui_;   // row indices of U incl. diagonal (factored frame)
    std::vector<double>      Ux_;   // numeric values of U
    std::size_t n_ = 0;
    bool ok_ = false;
};

// ---------------------------------------------------------------------------
// Jacobi-preconditioned Conjugate Gradient for sparse SPD systems (the large-
// DOF iterative path: CFD pressure-Poisson, big K u = f).
// ---------------------------------------------------------------------------
struct CGResult {
    bool ok = false;
    int iters = 0;
    double residual = 0.0;   // final ||b - A x||_2 / ||b||_2
};
CGResult conjugateGradient(const SparseCSR<double>& A,
                           const std::vector<double>& b,
                           std::vector<double>& x,
                           int maxIters = 0,        // 0 => 10*n
                           double tol = 1e-12);

// ---------------------------------------------------------------------------
// Sparse generalized symmetric eigensolver — the LOWEST-k modes of the pencil
//   K φ = λ M φ
// via SHIFT-INVERT LANCZOS. This is the large-DOF MODAL path: it lifts the
// dense GeneralizedSymmetricEigen O(n³)/O(n²)-memory cap (≈1500 DOF) so a modal
// solve runs on realistic meshes (10³–10⁵ DOF) by touching K and M only through
// sparse matrix-vector products and ONE sparse factorization.
//
//   K — symmetric, POSITIVE DEFINITE on the analysed (BC-reduced) DOF set, or
//       symmetric-indefinite if a negative shift σ is supplied.
//   M — symmetric POSITIVE DEFINITE (consistent or lumped mass).
//
// METHOD (Ericsson–Ruhe / Parlett, "The Symmetric Eigenvalue Problem", ch. 13;
// shift-invert spectral transformation): the operator
//       C = (K − σM)⁻¹ M
// is SELF-ADJOINT in the M-inner product ⟨x,y⟩_M = xᵀMy, and its eigenvalues θ
// map to the pencil's eigenvalues CLOSEST to the shift via  λ = σ + 1/θ. Because
// shift-invert sends the eigenvalues nearest σ to the EXTREMES of C's spectrum,
// a few Lanczos steps capture them. We:
//   1. form (K − σM) sparsely and factor it ONCE with the existing SparseLDLT
//      (SPD whenever σ < λ_min; σ = 0 is correct for an SPD constrained K — no
//      new factorizer is written);
//   2. run Lanczos in the M-inner product, building the tridiagonal T with FULL
//      re-orthogonalization against ALL stored Lanczos vectors (this defeats the
//      classic loss-of-M-orthogonality → ghost / spurious-eigenvalue failure);
//   3. solve the small k×k tridiagonal eigenproblem densely (SymmetricEigen);
//   4. map θ → λ = σ + 1/θ, recover φ = V·y, and M-normalize; convergence is
//      certified by the TRUE pencil residual ‖Kφ − λMφ‖₂ / ‖λMφ‖₂ of every
//      returned mode (so a non-converged mode is never silently returned).
//
// NO Eigen / ARPACK / Spectra: native Lanczos on the in-house SparseLDLT +
// SymmetricEigen. ok()=false (honest) if (K − σM) is not SPD under the shift, or
// the requested modes do not converge within the Krylov-dimension cap.
// ---------------------------------------------------------------------------
struct SparseGenEigResult {
    bool ok = false;
    std::vector<double> eigenvalues;                 // ascending λ (= ω² in modal)
    std::vector<std::vector<double>> eigenvectors;   // M-orthonormal φ, each length n
    int    lanczosSteps = 0;                         // Krylov dimension actually used
    double maxResidual  = 0.0;                        // max ‖Kφ−λMφ‖₂/‖λMφ‖₂ over modes
};

SparseGenEigResult sparseGeneralizedEigSI(const SparseCSR<double>& K,
                                          const SparseCSR<double>& M,
                                          int numModes,
                                          double sigma     = 0.0,  // shift (0 ⇒ SPD K)
                                          int    maxLanczos = 0,    // 0 ⇒ auto cap
                                          double tol        = 1e-10);

} // namespace linalg
} // namespace native
} // namespace forge

#endif // FORGE_NATIVE_LINALG_LINALG_HPP
