// forge_eigen_shim.hpp
//
// A drop-in `namespace Eigen` COMPATIBILITY SHIM backed entirely by the in-house
// forge::native::linalg library. Its sole purpose is to let the vendored FreeCAD
// PlaneGCS sketch solver (GCS.h/GCS.cpp/SubSystem.*/qp_eq.*) compile and run with
// ZERO real Eigen — every PlaneGCS source file stays byte-identical; only the
// resolution of `#include <Eigen/...>` changes (this shim dir is placed on the
// include path BEFORE any real Eigen).
//
//   * PURE C++20 stdlib + forge::native::linalg. NO real Eigen anywhere.
//   * EAGER evaluation: every operator returns a CONCRETE Matrix/Vector, so the
//     PlaneGCS expression chains (grad - JA.transpose()*lambda, h*h.transpose(),
//     (b.transpose()*b).norm(), Y.transpose()*(B*xdir+grad), …) all work.
//   * Five tiny lvalue/proxy types (BlockRef, TriangularViewProxy, RowVec,
//     Scalar1x1, PermutationMatrix) cover the handful of in-place / view sites.
//
// VERSION MACROS — these are what defuse the two hardest PlaneGCS code paths:
//   EIGEN_VERSION = 3*10000 + 4*100 + 0 = 30400.
//     >30290  -> GCS.cpp defines EIGEN_STOCK_FULLPIVLU_COMPUTE, which COMPILES OUT
//               the custom FullPivLU::compute Eigen-internal surgery (GCS.cpp
//               ~110-221). We never implement that block.
//     >=30202 -> GCS.h defines EIGEN_SPARSEQR_COMPATIBLE, leaving the SparseQR
//               branches COMPILED IN. We therefore provide a DENSIFY adapter
//               (SparseMatrix<double> over a dense Matrix; SparseQR forwarding to
//               an internal FullPivHouseholderQR) so those branches compile AND
//               run correctly. Sketch DOF < autoQRThreshold(1000) so dense is the
//               right tradeoff (PlaneGCS auto-picks DenseQR below that anyway).
//
// The numerics are faithful: every routine simply routes to forge::native::linalg
// (which is itself validated against Eigen to ~1e-10 by its own gate).

#ifndef FORGE_PLANEGCS_EIGEN_SHIM_HPP
#define FORGE_PLANEGCS_EIGEN_SHIM_HPP

// ---------------------------------------------------------------------------
// Version macros. Must be visible BEFORE GCS.h computes EIGEN_VERSION.
// ---------------------------------------------------------------------------
#ifndef EIGEN_WORLD_VERSION
#  define EIGEN_WORLD_VERSION 3
#endif
#ifndef EIGEN_MAJOR_VERSION
#  define EIGEN_MAJOR_VERSION 4
#endif
#ifndef EIGEN_MINOR_VERSION
#  define EIGEN_MINOR_VERSION 0
#endif

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <ostream>
#include <stdexcept>
#include <vector>

#include "forge/native/linalg/LinAlg.hpp"

namespace Eigen {

// ===========================================================================
// Index type + compile-time tag enums / constants.
// PlaneGCS uses Eigen::Index implicitly; we expose a signed index so that
// `int(v.size())` and `v.size() != int(n)` comparisons behave like Eigen.
// ===========================================================================
using Index = std::ptrdiff_t;

// Eigen::Dynamic is -1; the other tags are plain compile-time ints used as
// template arguments (Upper/Lower/Infinity/OnTheRight/OnTheLeft) or run-time
// no-op flags.
enum : int {
    Dynamic     = -1,
    Upper       = 0x2,
    Lower       = 0x1,
    OnTheLeft   = 1,
    OnTheRight  = 2
};
// lpNorm<Infinity>() — Infinity is a distinct compile-time tag (a large int,
// matching Eigen's Infinity = 0x7fffffff sentinel).
enum : int { Infinity = 0x7fffffff };

// ===========================================================================
// NumTraits<T> — only NumTraits<double>::epsilon() / ::Scalar are referenced,
// and only inside the dead custom-FullPivLU block (compiled out). Provided so
// the name resolves regardless.
// ===========================================================================
template <class T>
struct NumTraits {
    using Real   = T;
    using Scalar = T;
    static T epsilon()       { return std::numeric_limits<T>::epsilon(); }
    static T dummy_precision(){ return std::numeric_limits<T>::epsilon(); }
    static T highest()       { return (std::numeric_limits<T>::max)(); }
    static T lowest()        { return -(std::numeric_limits<T>::max)(); }
};

// ===========================================================================
// Threading no-ops (PlaneGCS calls Eigen::setNbThreads(1) / Eigen::nbThreads()).
// ===========================================================================
inline void setNbThreads(int) {}
inline int  nbThreads() { return 1; }

// ===========================================================================
// IOFormat stub — only used under _GCS_DEBUG (which PlaneGCS #undef's). Provided
// trivially so EIGEN_DEFAULT_IO_FORMAT-style code would still parse.
// ===========================================================================
struct IOFormat {
    IOFormat(int = 0, int = 0,
             const std::string& = " ", const std::string& = "\n",
             const std::string& = "",  const std::string& = "",
             const std::string& = "",  const std::string& = "") {}
};

// ---------------------------------------------------------------------------
// Forward declarations.
// ---------------------------------------------------------------------------
class MatrixXd;
class VectorXd;
class RowVec;
class Scalar1x1;
class BlockRef;
class TriangularViewProxy;
class TriangularTransposeSolveProxy;
template <int Rows, int Cols> class PermutationMatrix;

// small alias used by forge
using FMat = forge::native::linalg::MatrixD;

// ===========================================================================
// VectorXd — column vector over std::vector<double>. Exposes BOTH operator[](i)
// and operator()(i), a signed .size(), and the full eager arithmetic surface.
// ===========================================================================
class VectorXd {
public:
    VectorXd() = default;
    explicit VectorXd(Index n) : v_(static_cast<std::size_t>(n < 0 ? 0 : n), 0.0) {}
    VectorXd(const std::vector<double>& v) : v_(v) {}
    VectorXd(std::vector<double>&& v) : v_(std::move(v)) {}

    // element access (both Eigen idioms)
    double&       operator[](Index i)       { return v_[static_cast<std::size_t>(i)]; }
    const double& operator[](Index i) const { return v_[static_cast<std::size_t>(i)]; }
    double&       operator()(Index i)       { return v_[static_cast<std::size_t>(i)]; }
    const double& operator()(Index i) const { return v_[static_cast<std::size_t>(i)]; }

    Index size() const { return static_cast<Index>(v_.size()); }

    const std::vector<double>& raw() const { return v_; }
    std::vector<double>&       raw()       { return v_; }

    void setZero() { std::fill(v_.begin(), v_.end(), 0.0); }
    void setZero(Index n) { v_.assign(static_cast<std::size_t>(n < 0 ? 0 : n), 0.0); }
    void resize(Index n)  { v_.assign(static_cast<std::size_t>(n < 0 ? 0 : n), 0.0); }

    // --- norms / dots
    double norm() const { return forge::native::linalg::norm2(v_); }
    double squaredNorm() const { return forge::native::linalg::vdot(v_, v_); }
    double dot(const VectorXd& o) const { return forge::native::linalg::vdot(v_, o.v_); }

    template <int P>
    double lpNorm() const {
        if constexpr (P == Infinity) {
            return forge::native::linalg::normInf(v_);
        } else if constexpr (P == 1) {
            double s = 0.0;
            for (double x : v_) s += std::abs(x);
            return s;
        } else {
            // Generic p-norm fallback (not exercised by PlaneGCS).
            double s = 0.0;
            for (double x : v_) s += std::pow(std::abs(x), static_cast<double>(P));
            return std::pow(s, 1.0 / static_cast<double>(P));
        }
    }

    // --- transpose -> RowVec proxy (outer product / inner product idioms)
    RowVec transpose() const;

    // --- vector arithmetic (eager)
    VectorXd operator+(const VectorXd& o) const {
        return VectorXd(forge::native::linalg::vadd(v_, o.v_));
    }
    VectorXd operator-(const VectorXd& o) const {
        return VectorXd(forge::native::linalg::vsub(v_, o.v_));
    }
    VectorXd operator-() const {
        return VectorXd(forge::native::linalg::vscale(v_, -1.0));
    }
    VectorXd operator*(double s) const {
        return VectorXd(forge::native::linalg::vscale(v_, s));
    }

    VectorXd& operator+=(const VectorXd& o) {
        for (std::size_t i = 0; i < v_.size(); ++i) v_[i] += o.v_[i];
        return *this;
    }
    VectorXd& operator-=(const VectorXd& o) {
        for (std::size_t i = 0; i < v_.size(); ++i) v_[i] -= o.v_[i];
        return *this;
    }
    VectorXd& operator*=(double s) {
        for (double& x : v_) x *= s;
        return *this;
    }

private:
    std::vector<double> v_;
};

// scalar * VectorXd
inline VectorXd operator*(double s, const VectorXd& v) { return v * s; }

// ===========================================================================
// Scalar1x1 — the result of an inner product written in Eigen's
// (rowvec * colvec) form, e.g. (b.transpose()*b). Exposes .norm() == abs(value)
// so the idiom `(expr).norm()` compiles unchanged. Implicitly converts to double.
// ===========================================================================
class Scalar1x1 {
public:
    explicit Scalar1x1(double v) : v_(v) {}
    double norm() const { return std::abs(v_); }
    double value() const { return v_; }
    operator double() const { return v_; }
private:
    double v_;
};

// ===========================================================================
// RowVec — VectorXd::transpose(). Two products:
//   (a) RowVec * VectorXd  -> Scalar1x1   (inner product; .norm() = |dot|)
//   (b) VectorXd * RowVec  -> MatrixXd    (rank-1 outer product)
// Also streams space-separated (printResidual's `std::cout << r.transpose()`).
// ===========================================================================
class RowVec {
public:
    explicit RowVec(const std::vector<double>& v) : v_(v) {}
    const std::vector<double>& raw() const { return v_; }
    Index size() const { return static_cast<Index>(v_.size()); }

    // RowVec * VectorXd -> Scalar1x1 (inner product)
    Scalar1x1 operator*(const VectorXd& c) const {
        return Scalar1x1(forge::native::linalg::vdot(v_, c.raw()));
    }
private:
    std::vector<double> v_;
};

inline RowVec VectorXd::transpose() const { return RowVec(v_); }

inline std::ostream& operator<<(std::ostream& os, const RowVec& r) {
    const auto& v = r.raw();
    for (std::size_t i = 0; i < v.size(); ++i) {
        if (i) os << ' ';
        os << v[i];
    }
    return os;
}

// ===========================================================================
// MatrixXd — dense matrix over forge::native::linalg::MatrixD. EAGER everywhere.
// ===========================================================================
class MatrixXd {
public:
    MatrixXd() = default;
    MatrixXd(Index r, Index c)
        : m_(static_cast<std::size_t>(r < 0 ? 0 : r),
             static_cast<std::size_t>(c < 0 ? 0 : c), 0.0) {}
    MatrixXd(const FMat& m) : m_(m) {}
    MatrixXd(FMat&& m) : m_(std::move(m)) {}

    // ---- statics
    static MatrixXd Identity(Index n, Index /*n2*/) {
        return MatrixXd(FMat::Identity(static_cast<std::size_t>(n < 0 ? 0 : n)));
    }
    static MatrixXd Zero(Index r, Index c) { return MatrixXd(r, c); }

    // ---- dims
    Index rows() const { return static_cast<Index>(m_.rows()); }
    Index cols() const { return static_cast<Index>(m_.cols()); }
    Index size() const { return static_cast<Index>(m_.size()); }

    // ---- element access
    double& operator()(Index i, Index j) {
        return m_(static_cast<std::size_t>(i), static_cast<std::size_t>(j));
    }
    double operator()(Index i, Index j) const {
        return m_(static_cast<std::size_t>(i), static_cast<std::size_t>(j));
    }

    const FMat& raw() const { return m_; }
    FMat&       raw()       { return m_; }

    // ---- resize / fill
    void resize(Index r, Index c) {
        m_.resize(static_cast<std::size_t>(r < 0 ? 0 : r),
                  static_cast<std::size_t>(c < 0 ? 0 : c), 0.0);
    }
    void setZero() { m_.setZero(); }
    void setZero(Index r, Index c) { resize(r, c); }  // Eigen: resize + zero

    // ---- transpose / adjoint (eager copies)
    MatrixXd transpose() const { return MatrixXd(m_.transpose()); }
    MatrixXd adjoint() const   { return MatrixXd(m_.adjoint()); }

    // ---- products (eager)
    MatrixXd operator*(const MatrixXd& B) const { return MatrixXd(m_ * B.m_); }
    VectorXd operator*(const VectorXd& x) const { return VectorXd(m_ * x.raw()); }

    // ---- additive (eager)
    MatrixXd operator+(const MatrixXd& B) const { return MatrixXd(m_ + B.m_); }
    MatrixXd operator-(const MatrixXd& B) const { return MatrixXd(m_ - B.m_); }
    MatrixXd operator-() const {
        FMat r(m_.rows(), m_.cols(), 0.0);
        for (std::size_t i = 0; i < m_.rows(); ++i)
            for (std::size_t j = 0; j < m_.cols(); ++j) r(i, j) = -m_(i, j);
        return MatrixXd(std::move(r));
    }

    // compound updates (rank-1/rank-2 BFGS/SQP/LM updates)
    MatrixXd& operator+=(const MatrixXd& B) {
        for (std::size_t i = 0; i < m_.rows(); ++i)
            for (std::size_t j = 0; j < m_.cols(); ++j) m_(i, j) += B.m_(i, j);
        return *this;
    }
    MatrixXd& operator-=(const MatrixXd& B) {
        for (std::size_t i = 0; i < m_.rows(); ++i)
            for (std::size_t j = 0; j < m_.cols(); ++j) m_(i, j) -= B.m_(i, j);
        return *this;
    }

    // ---- scalar scaling
    MatrixXd operator*(double s) const {
        FMat r(m_.rows(), m_.cols(), 0.0);
        for (std::size_t i = 0; i < m_.rows(); ++i)
            for (std::size_t j = 0; j < m_.cols(); ++j) r(i, j) = m_(i, j) * s;
        return MatrixXd(std::move(r));
    }
    MatrixXd& operator*=(double s) {
        for (std::size_t i = 0; i < m_.rows(); ++i)
            for (std::size_t j = 0; j < m_.cols(); ++j) m_(i, j) *= s;
        return *this;
    }

    // ---- diagonal() -> VectorXd (eager copy)
    VectorXd diagonal() const {
        std::size_t n = std::min(m_.rows(), m_.cols());
        std::vector<double> d(n);
        for (std::size_t i = 0; i < n; ++i) d[i] = m_(i, i);
        return VectorXd(std::move(d));
    }

    // ---- contiguous slices (eager copies)
    MatrixXd topRows(Index k) const {
        std::size_t kk = static_cast<std::size_t>(k < 0 ? 0 : k);
        return MatrixXd(m_.block(0, 0, kk, m_.cols()));
    }
    MatrixXd leftCols(Index k) const {
        std::size_t kk = static_cast<std::size_t>(k < 0 ? 0 : k);
        return MatrixXd(m_.block(0, 0, m_.rows(), kk));
    }
    MatrixXd rightCols(Index k) const {
        std::size_t kk = static_cast<std::size_t>(k < 0 ? 0 : k);
        std::size_t j0 = m_.cols() - kk;
        return MatrixXd(m_.block(0, j0, m_.rows(), kk));
    }

    // ---- block(i,j,p,q): returns a BlockRef that is BOTH an rvalue read
    //      (implicit-convert to MatrixXd) AND an lvalue compound-assign target.
    BlockRef block(Index i, Index j, Index p, Index q);
    MatrixXd block(Index i, Index j, Index p, Index q) const;

    // ---- triangularView<Upper>() -> proxy (assign-to-MatrixXd zeros strict
    //      lower; .transpose().solve<OnTheRight>(B) does right-side tri solve).
    template <int UpLo>
    TriangularViewProxy triangularView() const;

    // ---- fluent decompositions (defined after the solver classes below)
    class FullPivLuWrap            fullPivLu() const;
    class LdltWrap                 ldlt() const;
    class ColPivHouseholderQrWrap  colPivHouseholderQr() const;
    class FullPivHouseholderQrWrap fullPivHouseholderQr() const;

    // ---- sparseView() -> SparseMatrix<double> (densify adapter; defined later)
    class SparseMatrixD sparseView() const;

private:
    FMat m_;
};

// scalar * MatrixXd
inline MatrixXd operator*(double s, const MatrixXd& M) { return M * s; }

// VectorXd * RowVec -> MatrixXd (rank-1 outer product). Defined here (needs
// MatrixXd complete).
inline MatrixXd operator*(const VectorXd& col, const RowVec& row) {
    const auto& a = col.raw();
    const auto& b = row.raw();
    FMat r(a.size(), b.size(), 0.0);
    for (std::size_t i = 0; i < a.size(); ++i)
        for (std::size_t j = 0; j < b.size(); ++j) r(i, j) = a[i] * b[j];
    return MatrixXd(std::move(r));
}

// scalar * (VectorXd*RowVec) is just MatrixXd*scalar — already covered.

// ostream for MatrixXd (debug LogMatrix; cosmetic, only under _GCS_DEBUG).
inline std::ostream& operator<<(std::ostream& os, const MatrixXd& M) {
    for (Index i = 0; i < M.rows(); ++i) {
        for (Index j = 0; j < M.cols(); ++j) {
            if (j) os << ' ';
            os << M(i, j);
        }
        if (i + 1 < M.rows()) os << '\n';
    }
    return os;
}

// ===========================================================================
// BlockRef — MatrixXd::block(i,j,p,q) lvalue proxy.
//   * implicit conversion to MatrixXd for rvalue reads.
//   * operator-=(MatrixXd) writes back into the parent (the one lvalue site:
//       R.block(row,i+1,1,k) -= coef * R.block(i,i+1,1,k)).
// ===========================================================================
class BlockRef {
public:
    BlockRef(MatrixXd& parent, Index i0, Index j0, Index p, Index q)
        : parent_(&parent), i0_(i0), j0_(j0), p_(p), q_(q) {}

    // rvalue read
    MatrixXd eval() const {
        return const_cast<const MatrixXd*>(parent_)->block(i0_, j0_, p_, q_);
    }
    operator MatrixXd() const { return eval(); }

    BlockRef& operator-=(const MatrixXd& rhs) {
        for (Index a = 0; a < p_; ++a)
            for (Index b = 0; b < q_; ++b)
                (*parent_)(i0_ + a, j0_ + b) -= rhs(a, b);
        return *this;
    }
    BlockRef& operator+=(const MatrixXd& rhs) {
        for (Index a = 0; a < p_; ++a)
            for (Index b = 0; b < q_; ++b)
                (*parent_)(i0_ + a, j0_ + b) += rhs(a, b);
        return *this;
    }
    BlockRef& operator=(const MatrixXd& rhs) {
        for (Index a = 0; a < p_; ++a)
            for (Index b = 0; b < q_; ++b)
                (*parent_)(i0_ + a, j0_ + b) = rhs(a, b);
        return *this;
    }

private:
    MatrixXd* parent_;
    Index i0_, j0_, p_, q_;
};

inline BlockRef MatrixXd::block(Index i, Index j, Index p, Index q) {
    return BlockRef(*this, i, j, p, q);
}
inline MatrixXd MatrixXd::block(Index i, Index j, Index p, Index q) const {
    std::size_t ii = static_cast<std::size_t>(i), jj = static_cast<std::size_t>(j);
    std::size_t pp = static_cast<std::size_t>(p < 0 ? 0 : p);
    std::size_t qq = static_cast<std::size_t>(q < 0 ? 0 : q);
    return MatrixXd(m_.block(ii, jj, pp, qq));
}

// ===========================================================================
// TriangularViewProxy / right-side triangular solve.
//   triangularView<Upper>():
//     (a) implicit-convert to MatrixXd  -> upper triangle (incl diag), strict
//         lower zeroed.   (R = qrJT.matrixQR().triangularView<Upper>())
//     (b) .transpose().solve<OnTheRight>(B) -> MatrixXd solving X * T = B where
//         T is the upper-triangular source (so X * R^T = B, i.e. right-side
//         lower-triangular solve against R^T).   (qp_eq.cpp)
// ===========================================================================
class TriangularTransposeSolveProxy {
public:
    // T_ is the UPPER-triangular source matrix (square, dim = constr_num).
    explicit TriangularTransposeSolveProxy(MatrixXd T) : T_(std::move(T)) {}

    // Solve X * T_^T = B  (B is r x n, T_ is n x n upper-tri, X is r x n).
    // T_^T is LOWER triangular; we solve column-block by forward substitution.
    template <int Side>
    MatrixXd solve(const MatrixXd& B) const {
        static_assert(Side == OnTheRight,
                      "shim TriangularView solve only supports OnTheRight");
        const Index r = B.rows();
        const Index n = T_.rows();  // = T_.cols()
        MatrixXd X(r, n);
        // X * T_^T = B  ==> for each row of X independently:
        //   sum_k X(row,k) * T_(j,k) = B(row,j)   (since (T_^T)(k,j) = T_(j,k))
        // T_ upper-triangular => T_(j,k) nonzero only for k >= j, with diagonal
        // T_(j,j). Solve for X(row,j) from j = n-1 down to 0:
        //   X(row,j) = ( B(row,j) - sum_{k>j} X(row,k)*T_(j,k) ) / T_(j,j)
        for (Index row = 0; row < r; ++row) {
            for (Index j = n - 1; j >= 0; --j) {
                double acc = B(row, j);
                for (Index k = j + 1; k < n; ++k) acc -= X(row, k) * T_(j, k);
                double diag = T_(j, j);
                X(row, j) = (diag != 0.0) ? acc / diag : 0.0;
                if (j == 0) break;  // guard underflow for signed index
            }
        }
        return X;
    }

private:
    MatrixXd T_;
};

class TriangularViewProxy {
public:
    // src is the FULL source matrix; we view its upper triangle.
    explicit TriangularViewProxy(MatrixXd src) : src_(std::move(src)) {}

    // (a) materialize: upper triangle (incl diagonal), strict-lower zeroed.
    MatrixXd eval() const {
        const Index r = src_.rows(), c = src_.cols();
        MatrixXd out(r, c);
        for (Index i = 0; i < r; ++i)
            for (Index j = 0; j < c; ++j)
                out(i, j) = (j >= i) ? src_(i, j) : 0.0;
        return out;
    }
    operator MatrixXd() const { return eval(); }

    // (b) .transpose() -> right-side triangular solve handle. The source must be
    // square here (topRows(constr_num) already applied by the caller).
    TriangularTransposeSolveProxy transpose() const {
        return TriangularTransposeSolveProxy(eval());
    }

private:
    MatrixXd src_;
};

template <int UpLo>
inline TriangularViewProxy MatrixXd::triangularView() const {
    static_assert(UpLo == Upper, "shim triangularView supports <Upper> only");
    return TriangularViewProxy(*this);
}

// ===========================================================================
// PermutationMatrix<Dynamic,Dynamic> — mutable permutation:
//   setIdentity(n); applyTranspositionOnTheRight(i,j); indices()[k];
//   transpose(); operator*(MatrixXd) (column reorder); cast-to-MatrixXd.
// Stored as std::vector<int> indices_ where indices_[k] = source position that
// lands in slot k (Eigen "indices" convention).
// ===========================================================================
template <int Rows, int Cols>
class PermutationMatrix {
public:
    PermutationMatrix() = default;
    explicit PermutationMatrix(Index n) { setIdentity(n); }

    void setIdentity(Index n) {
        indices_.resize(static_cast<std::size_t>(n < 0 ? 0 : n));
        for (std::size_t i = 0; i < indices_.size(); ++i)
            indices_[i] = static_cast<int>(i);
    }

    // Eigen semantics: swap the entries at positions i and j of the index array.
    void applyTranspositionOnTheRight(Index i, Index j) {
        std::swap(indices_[static_cast<std::size_t>(i)],
                  indices_[static_cast<std::size_t>(j)]);
    }

    Index size() const { return static_cast<Index>(indices_.size()); }

    const std::vector<int>& indices() const { return indices_; }
    std::vector<int>&       indices()       { return indices_; }

    // transpose() -> inverse permutation.
    PermutationMatrix transpose() const {
        PermutationMatrix inv;
        inv.indices_.resize(indices_.size());
        for (std::size_t k = 0; k < indices_.size(); ++k)
            inv.indices_[static_cast<std::size_t>(indices_[k])] = static_cast<int>(k);
        return inv;
    }

    // P * M : Eigen applies the permutation to the ROWS such that the result
    // equals dense(P) * M. dense(P)(k, indices_[k]) = 1, so
    //   (P*M)(k, :) = M(indices_[k], :).
    MatrixXd operator*(const MatrixXd& M) const {
        const Index n = static_cast<Index>(indices_.size());
        MatrixXd out(n, M.cols());
        for (Index k = 0; k < n; ++k)
            for (Index j = 0; j < M.cols(); ++j)
                out(k, j) = M(indices_[static_cast<std::size_t>(k)], j);
        return out;
    }

    // cast-to-MatrixXd : the dense permutation matrix (debug only).
    operator MatrixXd() const {
        const Index n = static_cast<Index>(indices_.size());
        MatrixXd out(n, n);
        for (Index k = 0; k < n; ++k)
            out(k, indices_[static_cast<std::size_t>(k)]) = 1.0;
        return out;
    }

private:
    std::vector<int> indices_;
};

// M * P : right-multiply by a permutation, Eigen-faithfully. Eigen's
// PermutationMatrix with indices()[k]=p_k represents dense(P) with a 1 at
// (p_k, k), so right-multiplication GATHERS columns:
//     (M * P)(i, k) = M(i, indices[k]).
// This is the inverse of the scatter form, and is exactly what makes the
// reconstruction identity hold: with P = colsPermutation(), the chain
//     (Q * R_upper) * colsPermutation().transpose()
// places column k of R into column indices[k] (== forge's R·Pᵀ formula),
// because transpose() supplies the inverse permutation and the gather then
// re-scatters it. Verified to machine precision for non-involution perms.
template <int R, int C>
inline MatrixXd operator*(const MatrixXd& M, const PermutationMatrix<R, C>& P) {
    const auto& idx = P.indices();
    MatrixXd out(M.rows(), static_cast<Index>(idx.size()));
    for (Index i = 0; i < M.rows(); ++i)
        for (std::size_t k = 0; k < idx.size(); ++k)
            out(i, static_cast<Index>(k)) = M(i, idx[k]);
    return out;
}

// ===========================================================================
// IntDiagSizeVectorType — integer transposition vector returned by
// FullPivHouseholderQR::rowsTranspositions(). Exposes .coeff(k), .resize(),
// .coeffRef(k) and ostream<< (debug). Modeled as a small int vector.
// ===========================================================================
class IntDiagSizeVectorType {
public:
    IntDiagSizeVectorType() = default;
    explicit IntDiagSizeVectorType(const std::vector<int>& v) : v_(v) {}

    int  coeff(Index k) const { return v_[static_cast<std::size_t>(k)]; }
    int& coeffRef(Index k)    { return v_[static_cast<std::size_t>(k)]; }
    void resize(Index n) { v_.assign(static_cast<std::size_t>(n < 0 ? 0 : n), 0); }
    Index size() const { return static_cast<Index>(v_.size()); }
    const std::vector<int>& raw() const { return v_; }

private:
    std::vector<int> v_;
};

inline std::ostream& operator<<(std::ostream& os, const IntDiagSizeVectorType& m) {
    const auto& v = m.raw();
    for (std::size_t i = 0; i < v.size(); ++i) { if (i) os << ' '; os << v[i]; }
    return os;
}

// ===========================================================================
// Generic dense Matrix<Scalar,Rows,Cols,Opts,MaxR,MaxC>. Only needs to
// NAME-RESOLVE: the sole user is the dead custom-FullPivLU block (compiled out)
// via `Matrix<double,-1,-1,0,-1,-1>` = MatrixdType. We make the double/dynamic
// specialization alias MatrixXd so any incidental use still works; the general
// template is an empty (incomplete-ish) shell that simply parses.
// ===========================================================================
template <class Scalar, int Rows = Dynamic, int Cols = Dynamic,
          int Opts = 0, int MaxR = Dynamic, int MaxC = Dynamic>
class Matrix {
    // Intentionally minimal: PlaneGCS never instantiates this outside the dead
    // FullPivLU block. Provide just enough to be a complete, default-usable type.
public:
    Matrix() = default;
};

// ===========================================================================
// FullPivLU<MatrixXd> — backed by forge LU(A, fullPivot=true). Only .solve()
// (and the implicit decomposition object from .fullPivLu()) is used; the custom
// ::compute override is compiled OUT.
//
// IMPORTANT — RECTANGULAR SYSTEMS. Eigen's FullPivLU is defined for ANY m×n A,
// and FullPivLU::solve(b) returns a length-`A.cols()` vector solving A x = b
// (a basic/particular solution; for an underdetermined consistent system the
// free columns are zeroed). The DogLeg Gauss-Newton step uses this on a WIDE
// Jacobian:  h_gn = Jx.fullPivLu().solve(-fx)  where Jx is csize×xsize with
// csize < xsize (e.g. a single distance constraint is 1×4). forge's dense
// `LU` is SQUARE-ONLY: LU::compute() no-ops on a non-square A (ok_=false,
// early return) and LU::solve() sizes its output to `rows()`, NOT `cols()`.
// Feeding the wide Jx through `LU` therefore returned a length-`rows` (=1)
// vector instead of length-`cols` (=4); the subsequent `Jx * h_gn` then read
// 3 doubles past the end of h_gn — a heap-buffer-overflow whose result is
// memory-layout-dependent (the classic "adding prints makes it pass" UB).
//
// FIX: route NON-SQUARE A through forge's rank-revealing FullPivHouseholderQR,
// whose solve() returns the length-`cols` basic solution and reproduces Eigen
// FullPivLU::solve to machine precision for the rectangular case (verified vs
// real Eigen). Square A keeps the faithful LU full-pivot path (Eigen FullPivLU
// is an LU full-pivot decomposition; for the square Gram (Jx·Jxᵀ) used by the
// LeastNorm step that is the exact analogue). PlaneGCS only ever consumes
// .solve() from a fullPivLu() temporary (never .rank()/.ok() of it), so this
// dispatch is transparent to every call site.
// ===========================================================================
template <class MatT = MatrixXd>
class FullPivLU {
public:
    FullPivLU() = default;
    explicit FullPivLU(const MatrixXd& A)
        : square_(A.rows() == A.cols()) {
        if (square_) {
            lu_.compute(A.raw(), /*fullPivot=*/true, /*rankRevealing=*/true);
        } else {
            qr_.compute(A.raw());
        }
    }

    VectorXd solve(const VectorXd& b) const {
        if (square_) {
            return VectorXd(lu_.solve(b.raw()));
        }
        return VectorXd(qr_.solve(b.raw()));
    }
    bool ok() const { return square_ ? lu_.ok() : qr_.ok(); }
    std::size_t rank() const { return square_ ? lu_.rank() : qr_.rank(); }

private:
    bool square_ = true;
    forge::native::linalg::LU<double> lu_;
    forge::native::linalg::FullPivHouseholderQR<double> qr_;
};

// ===========================================================================
// LDLT<MatrixXd> — backed by forge LDLT. Used as (G).ldlt().solve(-fx) on the
// PSD Gram J*J^T (may be exactly rank-deficient; forge LDLT returns a finite
// result which the DogLeg caller residual-checks).
// ===========================================================================
template <class MatT = MatrixXd>
class LDLT {
public:
    LDLT() = default;
    explicit LDLT(const MatrixXd& A) : ldlt_(A.raw()) {}

    VectorXd solve(const VectorXd& b) const {
        return VectorXd(ldlt_.solve(b.raw()));
    }
    bool ok() const { return ldlt_.ok(); }

private:
    forge::native::linalg::LDLT<double> ldlt_;
};

// ===========================================================================
// ColPivHouseholderQR<MatrixXd> — backed by forge ColPivHouseholderQR. Used as
// ZTHZ.colPivHouseholderQr().solve(rhs) in qp_eq.
// ===========================================================================
template <class MatT = MatrixXd>
class ColPivHouseholderQR {
public:
    ColPivHouseholderQR() = default;
    explicit ColPivHouseholderQR(const MatrixXd& A) : qr_(A.raw()) {}

    VectorXd solve(const VectorXd& b) const {
        return VectorXd(qr_.solve(b.raw()));
    }
    std::size_t rank() const { return qr_.rank(); }
    bool ok() const { return qr_.ok(); }

private:
    forge::native::linalg::ColPivHouseholderQR<double> qr_;
};

// ===========================================================================
// FullPivHouseholderQR<MatrixXd> — the central diagnose + qp_eq decomposition.
// Thin wrapper over forge FullPivHouseholderQR<double>.
//   compute / rows / cols / rank / setThreshold / matrixQR / matrixQ /
//   colsPermutation -> PermutationMatrix / rowsTranspositions -> IntDiagSize.
// ===========================================================================
template <class MatT = MatrixXd>
class FullPivHouseholderQR {
public:
    using IntDiagSizeVectorType = ::Eigen::IntDiagSizeVectorType;

    FullPivHouseholderQR() = default;
    explicit FullPivHouseholderQR(const MatrixXd& A) { compute(A); }

    void compute(const MatrixXd& A) { qr_.compute(A.raw()); }

    Index rows() const { return static_cast<Index>(qr_.rows()); }
    Index cols() const { return static_cast<Index>(qr_.cols()); }
    std::size_t rank() const { return qr_.rank(); }
    void setThreshold(double t) { qr_.setThreshold(t); }

    // matrixQR(): packed factor (R on/above diag) as a MatrixXd.
    MatrixXd matrixQR() const { return MatrixXd(qr_.matrixQR()); }

    // matrixQ(): explicit m x m Q (row-perm folded in).
    MatrixXd matrixQ() const { return MatrixXd(qr_.matrixQ()); }

    // colsPermutation(): forge gives perm_ as the column permutation indices
    // (column k of qr_ == column perm_[k] of A) which is exactly Eigen's
    // colsPermutation().indices().
    PermutationMatrix<Dynamic, Dynamic> colsPermutation() const {
        const auto& p = qr_.colsPermutation();
        PermutationMatrix<Dynamic, Dynamic> P(static_cast<Index>(p.size()));
        auto& idx = P.indices();
        for (std::size_t k = 0; k < p.size(); ++k) idx[k] = static_cast<int>(p[k]);
        return P;
    }

    // rowsTranspositions(): raw row transpositions (length min(m,n)).
    IntDiagSizeVectorType rowsTranspositions() const {
        const auto& rt = qr_.rowsTranspositions();
        std::vector<int> v(rt.size());
        for (std::size_t k = 0; k < rt.size(); ++k) v[k] = static_cast<int>(rt[k]);
        return IntDiagSizeVectorType(v);
    }

    VectorXd solve(const VectorXd& b) const {
        return VectorXd(qr_.solve(b.raw()));
    }
    bool ok() const { return qr_.ok(); }

private:
    forge::native::linalg::FullPivHouseholderQR<double> qr_;
};

// ===========================================================================
// Fluent decomposition wrappers returned by MatrixXd::fullPivLu()/ldlt()/etc.
// They store the decomposition so that `.solve()` works on the temporary, and
// expose the few extra accessors used (matrixQR/matrixQ/colsPermutation/...).
// ===========================================================================
class FullPivLuWrap {
public:
    explicit FullPivLuWrap(const MatrixXd& A) : d_(A) {}
    VectorXd solve(const VectorXd& b) const { return d_.solve(b); }
    std::size_t rank() const { return d_.rank(); }
    bool ok() const { return d_.ok(); }
private:
    FullPivLU<MatrixXd> d_;
};

class LdltWrap {
public:
    explicit LdltWrap(const MatrixXd& A) : d_(A) {}
    VectorXd solve(const VectorXd& b) const { return d_.solve(b); }
    bool ok() const { return d_.ok(); }
private:
    LDLT<MatrixXd> d_;
};

class ColPivHouseholderQrWrap {
public:
    explicit ColPivHouseholderQrWrap(const MatrixXd& A) : d_(A) {}
    VectorXd solve(const VectorXd& b) const { return d_.solve(b); }
    std::size_t rank() const { return d_.rank(); }
    bool ok() const { return d_.ok(); }
private:
    ColPivHouseholderQR<MatrixXd> d_;
};

class FullPivHouseholderQrWrap {
public:
    explicit FullPivHouseholderQrWrap(const MatrixXd& A) : d_(A) {}
    VectorXd solve(const VectorXd& b) const { return d_.solve(b); }
    std::size_t rank() const { return d_.rank(); }
    Index rows() const { return d_.rows(); }
    Index cols() const { return d_.cols(); }
    MatrixXd matrixQR() const { return d_.matrixQR(); }
    MatrixXd matrixQ() const { return d_.matrixQ(); }
    PermutationMatrix<Dynamic, Dynamic> colsPermutation() const {
        return d_.colsPermutation();
    }
    IntDiagSizeVectorType rowsTranspositions() const {
        return d_.rowsTranspositions();
    }
    bool ok() const { return d_.ok(); }
private:
    FullPivHouseholderQR<MatrixXd> d_;
};

inline FullPivLuWrap            MatrixXd::fullPivLu() const { return FullPivLuWrap(*this); }
inline LdltWrap                 MatrixXd::ldlt() const { return LdltWrap(*this); }
inline ColPivHouseholderQrWrap  MatrixXd::colPivHouseholderQr() const {
    return ColPivHouseholderQrWrap(*this);
}
inline FullPivHouseholderQrWrap MatrixXd::fullPivHouseholderQr() const {
    return FullPivHouseholderQrWrap(*this);
}

// ===========================================================================
// COLAMDOrdering<Int> — name-resolving ordering tag (the densify SparseQR
// ignores ordering; sketches < 1000 DOF so dense is fine).
// ===========================================================================
template <class StorageIndex = int>
class COLAMDOrdering {
public:
    COLAMDOrdering() = default;
};

// ===========================================================================
// SparseMatrix<double> densify adapter. Wraps a dense MatrixXd. Provides exactly
// the operations the PlaneGCS sparse branches use:
//   = J.sparseView();  .makeCompressed();  .rows();  .cols();
//   .topRows(n);  .transpose();   (chained)
// ===========================================================================
class SparseMatrixD {
public:
    SparseMatrixD() = default;
    explicit SparseMatrixD(MatrixXd m) : m_(std::move(m)) {}

    Index rows() const { return m_.rows(); }
    Index cols() const { return m_.cols(); }

    void makeCompressed() {}  // no-op for the dense backing

    SparseMatrixD topRows(Index k) const { return SparseMatrixD(m_.topRows(k)); }
    SparseMatrixD transpose() const { return SparseMatrixD(m_.transpose()); }

    const MatrixXd& dense() const { return m_; }

private:
    MatrixXd m_;
};

// keep the template spelling SparseMatrix<double> resolving to the dense adapter
template <class Scalar> class SparseMatrix;
template <> class SparseMatrix<double> : public SparseMatrixD {
public:
    SparseMatrix() = default;
    SparseMatrix(const SparseMatrixD& s) : SparseMatrixD(s) {}
    SparseMatrix& operator=(const SparseMatrixD& s) {
        SparseMatrixD::operator=(s); return *this;
    }
};

inline SparseMatrixD MatrixXd::sparseView() const { return SparseMatrixD(*this); }

// matrixR() return wrapper for SparseQR: a dense matrix that supports
// .triangularView<Upper>() and .topRows(n) — MatrixXd already does. We just
// return MatrixXd directly.

// ===========================================================================
// SparseQR<SparseMatrix<double>, COLAMDOrdering<int>> — densify adapter that
// forwards everything to an internal FullPivHouseholderQR on the dense matrix.
//   compute / rows / cols / setPivotThreshold / rank / matrixR / matrixQ /
//   colsPermutation.
// Sketch DOF < autoQRThreshold(1000) so dense backing is the correct tradeoff;
// PlaneGCS also auto-prefers DenseQR below that threshold.
// ===========================================================================
template <class MatType = SparseMatrix<double>, class Ordering = COLAMDOrdering<int>>
class SparseQR {
public:
    SparseQR() = default;

    void compute(const SparseMatrixD& S) { qr_.compute(S.dense()); }

    Index rows() const { return qr_.rows(); }
    Index cols() const { return qr_.cols(); }
    void setPivotThreshold(double t) { qr_.setThreshold(t); }
    std::size_t rank() const { return qr_.rank(); }

    // matrixR(): packed R (upper part) — same layout as dense matrixQR().
    MatrixXd matrixR() const { return qr_.matrixQR(); }

    // matrixQ(): explicit Q (only requested under a disabled debug macro).
    MatrixXd matrixQ() const { return qr_.matrixQ(); }

    PermutationMatrix<Dynamic, Dynamic> colsPermutation() const {
        return qr_.colsPermutation();
    }

private:
    FullPivHouseholderQR<MatrixXd> qr_;
};

// ---------------------------------------------------------------------------
// Convenience: `using namespace Eigen;` (qp_eq.cpp) brings the unqualified
// names MatrixXd / VectorXd / FullPivHouseholderQR / Upper / OnTheRight into
// scope — already in this namespace, nothing extra required.
// ---------------------------------------------------------------------------

}  // namespace Eigen

#endif  // FORGE_PLANEGCS_EIGEN_SHIM_HPP
