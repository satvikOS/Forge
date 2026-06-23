// forge/native/linalg/linalg_test.cpp
//
// Standalone validation gate for forge::native::linalg — the in-house, Eigen-free
// linear algebra library (NUMERICS TRACK #1). Pure C++20 for the LIBRARY under
// test; Eigen is linked IN THIS TEST ONLY as a numerical ORACLE (never by the
// library proper), so every routine is cross-checked to machine precision
// against the reference AND against analytic closed forms.
//
// Build & run (the native gate does this automatically; manual form):
//   clang++ -std=c++20 -O2 -I forge-kernel/include \
//       -DFORGE_LINALG_ORACLE -I /opt/homebrew/opt/eigen/include/eigen3 \
//       forge-kernel/src/native/linalg/LinAlg.cpp \
//       forge-kernel/test/native/linalg/linalg_test.cpp -o /tmp/k_linalg && /tmp/k_linalg
//
// ORACLE NOTE (honest): run_native.sh compiles WITHOUT -DFORGE_LINALG_ORACLE and
// WITHOUT the Eigen include, so in the no-deps native job this gate validates the
// library against ANALYTIC CLOSED FORMS ONLY (still a full pass/fail). The Eigen
// cross-checks compile in only when -DFORGE_LINALG_ORACLE is defined, keeping the
// dependency-free contract intact while letting a developer (and this report) get
// the exact error-vs-Eigen numbers on demand.
//
// WHAT IS VALIDATED (the SPEC), each vs Eigen (when oracle on) AND vs analytic:
//   LU      — general dense solve A x = b; vs known x; vs Eigen .solve(); inverse.
//   LLT     — SPD solve of a known SPD system; A = L Lᵀ reconstruction; vs Eigen.
//   LDLT    — symmetric INDEFINITE KKT saddle [M Jᵀ; J 0]; known solution; residual.
//   QR      — overdetermined least-squares to a known polynomial; QᵀQ = I; vs Eigen.
//   SymEig  — 1-D Laplacian tridiagonal: analytic λ_k = 2-2cos(kπ/(n+1)); A v=λ v;
//             orthonormal V; vs Eigen SelfAdjointEigenSolver.
//   GenEig  — K φ = λ M φ with a known (K,M); 2-DOF spring-mass closed form;
//             M-orthonormality; vs Eigen GeneralizedSelfAdjointEigenSolver.
//   Sparse  — 2-D Poisson stiffness via triplet->CSR; SparseLDLT direct solve and
//             Jacobi-PCG, both vs a dense reference solve; CSR matvec vs dense.
//   Complex — LU + QR on a complex system (Circuit AC / ShortCircuit path).
//
// A fresh std::random_device seed is printed so any failure reproduces. The max
// error per routine (vs Eigen + vs analytic) is printed regardless of pass/fail.

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstdint>
#include <cstdio>
#include <random>
#include <vector>

#include "forge/native/linalg/LinAlg.hpp"

#ifdef FORGE_LINALG_ORACLE
#include <Eigen/Dense>
#include <Eigen/Sparse>
#endif

using namespace forge::native::linalg;
using cd = std::complex<double>;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) ++g_pass;
    else      std::printf("  [FAIL] %s\n", name);
}

static double maxAbsDiff(const std::vector<double>& a, const std::vector<double>& b) {
    double m = 0.0;
    for (std::size_t i = 0; i < a.size(); ++i) m = std::max(m, std::fabs(a[i] - b[i]));
    return m;
}

int main() {
    std::printf("== forge::native::linalg (in-house Eigen-free linear algebra) gate ==\n");
#ifdef FORGE_LINALG_ORACLE
    std::printf("oracle = ON  (cross-checking against Eigen to machine precision)\n");
#else
    std::printf("oracle = OFF (analytic-closed-form validation only; Eigen-free build)\n");
#endif
    std::random_device rd;
    const std::uint64_t seed =
        (static_cast<std::uint64_t>(rd()) << 32) ^ static_cast<std::uint64_t>(rd());
    std::printf("seed = %llu\n", static_cast<unsigned long long>(seed));
    std::mt19937_64 rng(seed);
    std::uniform_real_distribution<double> U(-1.0, 1.0);

    // =======================================================================
    // 1. LU — general dense solve A x = b.
    // =======================================================================
    {
        const std::size_t n = 12;
        MatrixD A(n, n);
        std::vector<double> xtrue(n);
        for (std::size_t i = 0; i < n; ++i) {
            xtrue[i] = U(rng) * 5.0;
            for (std::size_t j = 0; j < n; ++j) A(i, j) = U(rng);
            A(i, i) += static_cast<double>(n);  // make well-conditioned
        }
        std::vector<double> b(n, 0.0);
        for (std::size_t i = 0; i < n; ++i)
            for (std::size_t j = 0; j < n; ++j) b[i] += A(i, j) * xtrue[j];

        LU<double> lu(A, /*fullPivot=*/true);
        std::vector<double> x = lu.solve(b);
        double errAnalytic = maxAbsDiff(x, xtrue);

        // residual ||A x - b||_inf
        std::vector<double> Ax = A * x;
        double resid = 0.0; for (std::size_t i = 0; i < n; ++i) resid = std::max(resid, std::fabs(Ax[i] - b[i]));

        // inverse check: A * A^-1 = I
        MatrixD Ainv = lu.inverse();
        MatrixD AAi = A * Ainv;
        double invErr = 0.0;
        for (std::size_t i = 0; i < n; ++i)
            for (std::size_t j = 0; j < n; ++j)
                invErr = std::max(invErr, std::fabs(AAi(i, j) - (i == j ? 1.0 : 0.0)));

        double errEigen = -1.0;
#ifdef FORGE_LINALG_ORACLE
        Eigen::MatrixXd Ae(n, n); Eigen::VectorXd be(n);
        for (std::size_t i = 0; i < n; ++i) { be(i) = b[i]; for (std::size_t j = 0; j < n; ++j) Ae(i, j) = A(i, j); }
        Eigen::VectorXd xe = Ae.fullPivLu().solve(be);
        errEigen = 0.0; for (std::size_t i = 0; i < n; ++i) errEigen = std::max(errEigen, std::fabs(x[i] - xe(i)));
#endif
        std::printf("[LU]    analytic_err=%.3e  resid=%.3e  inv_err=%.3e  eigen_err=%.3e\n",
                    errAnalytic, resid, invErr, errEigen);
        check(errAnalytic < 1e-9, "LU: solve matches known x");
        check(resid < 1e-9, "LU: residual ||Ax-b||_inf small");
        check(invErr < 1e-9, "LU: A*inv(A)=I");
#ifdef FORGE_LINALG_ORACLE
        check(errEigen < 1e-9, "LU: matches Eigen fullPivLu to 1e-9");
#endif
    }

    // =======================================================================
    // 2. LLT — Cholesky of a known SPD system.
    // =======================================================================
    {
        const std::size_t n = 10;
        // SPD = B Bᵀ + n I  (guaranteed positive-definite)
        MatrixD B(n, n);
        for (std::size_t i = 0; i < n; ++i) for (std::size_t j = 0; j < n; ++j) B(i, j) = U(rng);
        MatrixD A = B * B.transpose();
        for (std::size_t i = 0; i < n; ++i) A(i, i) += static_cast<double>(n);

        std::vector<double> xtrue(n); for (auto& v : xtrue) v = U(rng) * 3.0;
        std::vector<double> b(n, 0.0);
        for (std::size_t i = 0; i < n; ++i) for (std::size_t j = 0; j < n; ++j) b[i] += A(i, j) * xtrue[j];

        LLT<double> llt(A);
        check(llt.ok(), "LLT: SPD factorization succeeded");
        std::vector<double> x = llt.solve(b);
        double errAnalytic = maxAbsDiff(x, xtrue);

        // reconstruct A = L Lᵀ
        const MatrixD& L = llt.matrixL();
        MatrixD LLt = L * L.transpose();
        double reconErr = 0.0;
        for (std::size_t i = 0; i < n; ++i) for (std::size_t j = 0; j < n; ++j)
            reconErr = std::max(reconErr, std::fabs(LLt(i, j) - A(i, j)));

        double errEigen = -1.0;
#ifdef FORGE_LINALG_ORACLE
        Eigen::MatrixXd Ae(n, n); Eigen::VectorXd be(n);
        for (std::size_t i = 0; i < n; ++i) { be(i) = b[i]; for (std::size_t j = 0; j < n; ++j) Ae(i, j) = A(i, j); }
        Eigen::VectorXd xe = Ae.llt().solve(be);
        errEigen = 0.0; for (std::size_t i = 0; i < n; ++i) errEigen = std::max(errEigen, std::fabs(x[i] - xe(i)));
#endif
        std::printf("[LLT]   analytic_err=%.3e  recon_err=%.3e  eigen_err=%.3e\n",
                    errAnalytic, reconErr, errEigen);
        check(errAnalytic < 1e-9, "LLT: solve matches known x");
        check(reconErr < 1e-10, "LLT: A = L Lᵀ reconstruction exact");
#ifdef FORGE_LINALG_ORACLE
        check(errEigen < 1e-9, "LLT: matches Eigen LLT to 1e-9");
#endif
    }

    // =======================================================================
    // 3. LDLT — symmetric INDEFINITE KKT saddle [M Jᵀ; J 0].
    //    This is the multibody KKT pattern; M SPD (n x n), J (m x n), zero block.
    // =======================================================================
    {
        const std::size_t nb = 6, m = 2, N = nb + m;
        MatrixD Mblk(nb, nb), J(m, nb);
        {   // M SPD
            MatrixD C(nb, nb);
            for (std::size_t i = 0; i < nb; ++i) for (std::size_t j = 0; j < nb; ++j) C(i, j) = U(rng);
            MatrixD Mm = C * C.transpose();
            for (std::size_t i = 0; i < nb; ++i) Mm(i, i) += static_cast<double>(nb);
            Mblk = Mm;
        }
        for (std::size_t i = 0; i < m; ++i) for (std::size_t j = 0; j < nb; ++j) J(i, j) = U(rng) * 2.0;

        MatrixD K(N, N, 0.0);
        for (std::size_t i = 0; i < nb; ++i) for (std::size_t j = 0; j < nb; ++j) K(i, j) = Mblk(i, j);
        for (std::size_t i = 0; i < m; ++i) for (std::size_t j = 0; j < nb; ++j) {
            K(nb + i, j) = J(i, j);
            K(j, nb + i) = J(i, j);   // Jᵀ
        }
        // zero (or small -eps) lower-right block => symmetric INDEFINITE
        std::vector<double> ztrue(N); for (auto& v : ztrue) v = U(rng) * 4.0;
        std::vector<double> rhs(N, 0.0);
        for (std::size_t i = 0; i < N; ++i) for (std::size_t j = 0; j < N; ++j) rhs[i] += K(i, j) * ztrue[j];

        LDLT<double> ldlt(K);
        check(ldlt.ok(), "LDLT: indefinite KKT factorization succeeded");
        check(!ldlt.isPositive(), "LDLT: KKT correctly reported NOT positive-definite");
        std::vector<double> z = ldlt.solve(rhs);
        double errAnalytic = maxAbsDiff(z, ztrue);
        std::vector<double> Kz = K * z;
        double resid = 0.0; for (std::size_t i = 0; i < N; ++i) resid = std::max(resid, std::fabs(Kz[i] - rhs[i]));

        double errEigen = -1.0;
#ifdef FORGE_LINALG_ORACLE
        Eigen::MatrixXd Ke(N, N); Eigen::VectorXd re(N);
        for (std::size_t i = 0; i < N; ++i) { re(i) = rhs[i]; for (std::size_t j = 0; j < N; ++j) Ke(i, j) = K(i, j); }
        Eigen::VectorXd ze = Ke.fullPivLu().solve(re);
        errEigen = 0.0; for (std::size_t i = 0; i < N; ++i) errEigen = std::max(errEigen, std::fabs(z[i] - ze(i)));
#endif
        std::printf("[LDLT]  analytic_err=%.3e  KKT_resid=%.3e  eigen_err=%.3e\n",
                    errAnalytic, resid, errEigen);
        check(errAnalytic < 1e-8, "LDLT: KKT solve matches known solution");
        check(resid < 1e-8, "LDLT: KKT residual small");
#ifdef FORGE_LINALG_ORACLE
        check(errEigen < 1e-8, "LDLT: KKT solution matches Eigen fullPivLu to 1e-8");
#endif
    }

    // =======================================================================
    // 4. QR — overdetermined least-squares fit to a known polynomial.
    //    Fit degree-3 poly to exact samples => recover exact coefficients.
    // =======================================================================
    {
        const std::size_t m = 40, n = 4;
        std::vector<double> coef = {1.5, -2.0, 0.75, 0.3};  // known
        MatrixD A(m, n); std::vector<double> b(m, 0.0);
        for (std::size_t i = 0; i < m; ++i) {
            double t = -1.0 + 2.0 * i / (m - 1);
            double p = 1.0;
            for (std::size_t j = 0; j < n; ++j) { A(i, j) = p; b[i] += coef[j] * p; p *= t; }
        }
        HouseholderQR<double> qr(A);
        check(qr.ok(), "QR: factorization succeeded");
        std::vector<double> x = qr.solve(b);
        double errAnalytic = maxAbsDiff(x, coef);

        // QᵀQ = I
        MatrixD Q = qr.matrixQ();
        MatrixD QtQ = Q.transpose() * Q;
        double orthErr = 0.0;
        for (std::size_t i = 0; i < m; ++i) for (std::size_t j = 0; j < m; ++j)
            orthErr = std::max(orthErr, std::fabs(QtQ(i, j) - (i == j ? 1.0 : 0.0)));

        double errEigen = -1.0;
#ifdef FORGE_LINALG_ORACLE
        Eigen::MatrixXd Ae(m, n); Eigen::VectorXd be(m);
        for (std::size_t i = 0; i < m; ++i) { be(i) = b[i]; for (std::size_t j = 0; j < n; ++j) Ae(i, j) = A(i, j); }
        Eigen::VectorXd xe = Ae.colPivHouseholderQr().solve(be);
        errEigen = 0.0; for (std::size_t i = 0; i < n; ++i) errEigen = std::max(errEigen, std::fabs(x[i] - xe(i)));
#endif
        std::printf("[QR]    analytic_err=%.3e  orth_err=%.3e  eigen_err=%.3e\n",
                    errAnalytic, orthErr, errEigen);
        check(errAnalytic < 1e-9, "QR: least-squares recovers known polynomial coefficients");
        check(orthErr < 1e-10, "QR: QᵀQ = I");
#ifdef FORGE_LINALG_ORACLE
        check(errEigen < 1e-9, "QR: matches Eigen colPivHouseholderQr to 1e-9");
#endif
    }

    // =======================================================================
    // 5. SymmetricEigen — 1-D Laplacian tridiagonal (2 on diag, -1 off).
    //    Analytic eigenvalues: λ_k = 2 - 2 cos(kπ/(n+1)), k=1..n.
    // =======================================================================
    {
        const std::size_t n = 30;
        MatrixD A(n, n, 0.0);
        for (std::size_t i = 0; i < n; ++i) {
            A(i, i) = 2.0;
            if (i + 1 < n) { A(i, i + 1) = -1.0; A(i + 1, i) = -1.0; }
        }
        std::vector<double> analytic(n);
        for (std::size_t k = 1; k <= n; ++k)
            analytic[k - 1] = 2.0 - 2.0 * std::cos(M_PI * k / (n + 1));
        std::sort(analytic.begin(), analytic.end());

        SymmetricEigen es(A, true);
        check(es.ok(), "SymEig: solve succeeded");
        const std::vector<double>& ev = es.eigenvalues();
        const MatrixD& V = es.eigenvectors();

        double evalErr = 0.0;
        for (std::size_t i = 0; i < n; ++i) evalErr = std::max(evalErr, std::fabs(ev[i] - analytic[i]));
        bool ascending = true;
        for (std::size_t i = 1; i < n; ++i) if (ev[i] < ev[i - 1] - 1e-12) ascending = false;

        // A v_i = λ_i v_i
        double eigRelErr = 0.0;
        for (std::size_t c = 0; c < n; ++c) {
            std::vector<double> v(n); for (std::size_t i = 0; i < n; ++i) v[i] = V(i, c);
            std::vector<double> Av = A * v;
            for (std::size_t i = 0; i < n; ++i) eigRelErr = std::max(eigRelErr, std::fabs(Av[i] - ev[c] * v[i]));
        }
        // orthonormality VᵀV = I
        double orthErr = 0.0;
        for (std::size_t i = 0; i < n; ++i)
            for (std::size_t j = 0; j < n; ++j) {
                double s = 0.0; for (std::size_t k = 0; k < n; ++k) s += V(k, i) * V(k, j);
                orthErr = std::max(orthErr, std::fabs(s - (i == j ? 1.0 : 0.0)));
            }

        double errEigen = -1.0;
#ifdef FORGE_LINALG_ORACLE
        Eigen::MatrixXd Ae(n, n);
        for (std::size_t i = 0; i < n; ++i) for (std::size_t j = 0; j < n; ++j) Ae(i, j) = A(i, j);
        Eigen::SelfAdjointEigenSolver<Eigen::MatrixXd> se(Ae);
        errEigen = 0.0; for (std::size_t i = 0; i < n; ++i) errEigen = std::max(errEigen, std::fabs(ev[i] - se.eigenvalues()(i)));
#endif
        std::printf("[SymEig] analytic_eval_err=%.3e  eig_rel_err=%.3e  orth_err=%.3e  eigen_err=%.3e\n",
                    evalErr, eigRelErr, orthErr, errEigen);
        check(evalErr < 1e-10, "SymEig: eigenvalues match analytic 1-D Laplacian λ_k=2-2cos(kπ/(n+1))");
        check(ascending, "SymEig: eigenvalues ascending");
        check(eigRelErr < 1e-9, "SymEig: A v = λ v for every eigenpair");
        check(orthErr < 1e-9, "SymEig: eigenvectors orthonormal (VᵀV=I)");
#ifdef FORGE_LINALG_ORACLE
        check(errEigen < 1e-10, "SymEig: eigenvalues match Eigen SelfAdjointEigenSolver to 1e-10");
#endif
    }

    // =======================================================================
    // 6. GeneralizedSymmetricEigen — K φ = λ M φ. 2-DOF spring-mass closed form:
    //    K = k[[2,-1],[-1,1]], M = diag(m,m) -> λ = (k/m)*{(3-√5)/2, (3+√5)/2}.
    //    Plus a larger random (K SPD, M SPD) case validated by residual + M-orth.
    // =======================================================================
    {
        // (a) analytic 2-DOF
        const double k = 1000.0, mm = 2.0;
        MatrixD K2(2, 2), M2(2, 2, 0.0);
        K2(0, 0) = 2 * k; K2(0, 1) = -k; K2(1, 0) = -k; K2(1, 1) = k;
        M2(0, 0) = mm; M2(1, 1) = mm;
        GeneralizedSymmetricEigen ge2(K2, M2, true);
        check(ge2.ok(), "GenEig: 2-DOF reduction succeeded");
        double lam0 = (k / mm) * (3.0 - std::sqrt(5.0)) / 2.0;
        double lam1 = (k / mm) * (3.0 + std::sqrt(5.0)) / 2.0;
        double genAnalyticErr = std::max(std::fabs(ge2.eigenvalues()[0] - lam0),
                                         std::fabs(ge2.eigenvalues()[1] - lam1));

        // (b) larger random K (sym) , M (SPD)
        const std::size_t n = 8;
        MatrixD Kr(n, n), Mr(n, n);
        {
            MatrixD S(n, n);
            for (std::size_t i = 0; i < n; ++i) for (std::size_t j = 0; j < n; ++j) S(i, j) = U(rng);
            MatrixD Sym = S + S.transpose();           // symmetric (indefinite ok for K)
            Kr = Sym;
            MatrixD C(n, n);
            for (std::size_t i = 0; i < n; ++i) for (std::size_t j = 0; j < n; ++j) C(i, j) = U(rng);
            MatrixD Mspd = C * C.transpose();
            for (std::size_t i = 0; i < n; ++i) Mspd(i, i) += static_cast<double>(n);
            Mr = Mspd;
        }
        GeneralizedSymmetricEigen ge(Kr, Mr, true);
        check(ge.ok(), "GenEig: random K,M reduction succeeded");
        const std::vector<double>& gl = ge.eigenvalues();
        const MatrixD& gv = ge.eigenvectors();
        // residual ||K φ - λ M φ||
        double genResid = 0.0;
        for (std::size_t c = 0; c < n; ++c) {
            std::vector<double> phi(n); for (std::size_t i = 0; i < n; ++i) phi[i] = gv(i, c);
            std::vector<double> Kp = Kr * phi, Mp = Mr * phi;
            for (std::size_t i = 0; i < n; ++i) genResid = std::max(genResid, std::fabs(Kp[i] - gl[c] * Mp[i]));
        }
        // M-orthonormality φᵢᵀ M φⱼ = δᵢⱼ
        double mOrthErr = 0.0;
        for (std::size_t a = 0; a < n; ++a) {
            std::vector<double> pa(n); for (std::size_t i = 0; i < n; ++i) pa[i] = gv(i, a);
            std::vector<double> Mpa = Mr * pa;
            for (std::size_t b = 0; b < n; ++b) {
                double s = 0.0; for (std::size_t i = 0; i < n; ++i) s += gv(i, b) * Mpa[i];
                mOrthErr = std::max(mOrthErr, std::fabs(s - (a == b ? 1.0 : 0.0)));
            }
        }
        double errEigen = -1.0;
#ifdef FORGE_LINALG_ORACLE
        Eigen::MatrixXd Ke(n, n), Me(n, n);
        for (std::size_t i = 0; i < n; ++i) for (std::size_t j = 0; j < n; ++j) { Ke(i, j) = Kr(i, j); Me(i, j) = Mr(i, j); }
        Eigen::GeneralizedSelfAdjointEigenSolver<Eigen::MatrixXd> gse(Ke, Me);
        errEigen = 0.0; for (std::size_t i = 0; i < n; ++i) errEigen = std::max(errEigen, std::fabs(gl[i] - gse.eigenvalues()(i)));
#endif
        std::printf("[GenEig] analytic_2dof_err=%.3e  resid=%.3e  M_orth_err=%.3e  eigen_err=%.3e\n",
                    genAnalyticErr, genResid, mOrthErr, errEigen);
        check(genAnalyticErr < 1e-7, "GenEig: 2-DOF spring-mass eigenvalues match closed form");
        check(genResid < 1e-8, "GenEig: ||Kφ - λMφ|| small for all modes");
        check(mOrthErr < 1e-9, "GenEig: eigenvectors M-orthonormal (φᵢᵀMφⱼ=δᵢⱼ)");
#ifdef FORGE_LINALG_ORACLE
        check(errEigen < 1e-8, "GenEig: eigenvalues match Eigen GeneralizedSelfAdjointEigenSolver to 1e-8");
#endif
    }

    // =======================================================================
    // 7. Sparse — 2-D Poisson stiffness via triplet->CSR; SparseLDLT + PCG.
    //    5-point Laplacian on a g x g grid (SPD), known RHS, compare to dense.
    // =======================================================================
    {
        const int g = 12;
        const std::size_t n = static_cast<std::size_t>(g) * g;
        std::vector<Triplet<double>> trips;
        auto id = [&](int x, int y) { return static_cast<std::size_t>(y * g + x); };
        for (int y = 0; y < g; ++y) for (int x = 0; x < g; ++x) {
            std::size_t i = id(x, y);
            trips.emplace_back(i, i, 4.0);
            if (x > 0)     trips.emplace_back(i, id(x - 1, y), -1.0);
            if (x < g - 1) trips.emplace_back(i, id(x + 1, y), -1.0);
            if (y > 0)     trips.emplace_back(i, id(x, y - 1), -1.0);
            if (y < g - 1) trips.emplace_back(i, id(x, y + 1), -1.0);
        }
        SparseCSR<double> A;
        A.setFromTriplets(n, n, trips);

        std::vector<double> xtrue(n); for (auto& v : xtrue) v = U(rng);
        std::vector<double> b = A * xtrue;  // RHS consistent with known solution

        // CSR matvec vs dense
        MatrixD Ad = A.toDense();
        std::vector<double> bd = Ad * xtrue;
        double matvecErr = maxAbsDiff(b, bd);

        // direct sparse LDLT
        SparseLDLT sl(A);
        check(sl.ok(), "Sparse: SparseLDLT SPD factorization succeeded");
        std::vector<double> xd = sl.solve(b);
        double directErr = maxAbsDiff(xd, xtrue);

        // PCG
        std::vector<double> xcg(n, 0.0);
        CGResult cg = conjugateGradient(A, b, xcg, 0, 1e-12);
        double cgErr = maxAbsDiff(xcg, xtrue);

        double errEigen = -1.0;
#ifdef FORGE_LINALG_ORACLE
        std::vector<Eigen::Triplet<double>> et;
        for (auto& t : trips) et.emplace_back((int)t.row, (int)t.col, t.value);
        Eigen::SparseMatrix<double> Ae(n, n); Ae.setFromTriplets(et.begin(), et.end());
        Ae.makeCompressed();
        Eigen::VectorXd be(n); for (std::size_t i = 0; i < n; ++i) be(i) = b[i];
        Eigen::SimplicialLDLT<Eigen::SparseMatrix<double>> ld(Ae);
        Eigen::VectorXd xe = ld.solve(be);
        errEigen = 0.0; for (std::size_t i = 0; i < n; ++i) errEigen = std::max(errEigen, std::fabs(xd[i] - xe(i)));
#endif
        std::printf("[Sparse] n=%zu nnz=%zu matvec_err=%.3e direct_err=%.3e pcg_err=%.3e pcg_iters=%d pcg_resid=%.3e eigen_err=%.3e\n",
                    n, A.nnz(), matvecErr, directErr, cgErr, cg.iters, cg.residual, errEigen);
        check(matvecErr < 1e-12, "Sparse: CSR matvec matches dense");
        check(directErr < 1e-9, "Sparse: SparseLDLT solve matches known solution (FE-sized SPD)");
        check(cg.ok && cgErr < 1e-7, "Sparse: Jacobi-PCG converges to the solution");
#ifdef FORGE_LINALG_ORACLE
        check(errEigen < 1e-9, "Sparse: SparseLDLT matches Eigen SimplicialLDLT to 1e-9");
#endif
    }

    // =======================================================================
    // 8. Complex — LU + QR on a complex system (Circuit AC / ShortCircuit path).
    // =======================================================================
    {
        const std::size_t n = 6;
        Matrix<cd> A(n, n);
        std::vector<cd> xtrue(n);
        for (std::size_t i = 0; i < n; ++i) {
            xtrue[i] = cd(U(rng), U(rng));
            for (std::size_t j = 0; j < n; ++j) A(i, j) = cd(U(rng), U(rng));
            A(i, i) += cd(static_cast<double>(n), static_cast<double>(n));
        }
        std::vector<cd> b(n, cd(0, 0));
        for (std::size_t i = 0; i < n; ++i) for (std::size_t j = 0; j < n; ++j) b[i] += A(i, j) * xtrue[j];

        LU<cd> lu(A, true);
        std::vector<cd> x = lu.solve(b);
        double luErr = 0.0; for (std::size_t i = 0; i < n; ++i) luErr = std::max(luErr, std::abs(x[i] - xtrue[i]));

        HouseholderQR<cd> qr(A);
        std::vector<cd> xq = qr.solve(b);
        double qrErr = 0.0; for (std::size_t i = 0; i < n; ++i) qrErr = std::max(qrErr, std::abs(xq[i] - xtrue[i]));

        double errEigen = -1.0;
#ifdef FORGE_LINALG_ORACLE
        Eigen::MatrixXcd Ae(n, n); Eigen::VectorXcd be(n);
        for (std::size_t i = 0; i < n; ++i) { be(i) = b[i]; for (std::size_t j = 0; j < n; ++j) Ae(i, j) = A(i, j); }
        Eigen::VectorXcd xe = Ae.fullPivLu().solve(be);
        errEigen = 0.0; for (std::size_t i = 0; i < n; ++i) errEigen = std::max(errEigen, std::abs(x[i] - xe(i)));
#endif
        std::printf("[Cplx]  lu_err=%.3e  qr_err=%.3e  eigen_err=%.3e\n", luErr, qrErr, errEigen);
        check(luErr < 1e-9, "Complex: LU solve matches known complex x");
        check(qrErr < 1e-9, "Complex: QR solve matches known complex x");
#ifdef FORGE_LINALG_ORACLE
        check(errEigen < 1e-9, "Complex: LU matches Eigen complex fullPivLu to 1e-9");
#endif
    }

    // =======================================================================
    // 9. Extension helpers — dense row/col/block + std::vector ops + general
    //    SparseLU (the FE-assembly surface for the Fea/Cfd/MoldFlow/Welding swap).
    // =======================================================================
    {
        MatrixD A(4, 4);
        for (std::size_t i = 0; i < 4; ++i)
            for (std::size_t j = 0; j < 4; ++j) A(i, j) = static_cast<double>(10 * i + j);
        auto r1 = A.row(1);   // {10,11,12,13}
        auto c2 = A.col(2);   // {2,12,22,32}
        check(r1[0] == 10 && r1[1] == 11 && r1[2] == 12 && r1[3] == 13, "Ext: Matrix::row");
        check(c2[0] == 2 && c2[1] == 12 && c2[2] == 22 && c2[3] == 32, "Ext: Matrix::col");
        MatrixD B(4, 4);
        B.setRow(2, std::vector<double>{1, 2, 3, 4});
        B.setCol(0, std::vector<double>{5, 6, 7, 8});  // overrides B(2,0) -> 7
        check(B(2, 1) == 2 && B(2, 3) == 4 && B(0, 0) == 5 && B(3, 0) == 8 && B(2, 0) == 7,
              "Ext: setRow/setCol");
        auto blk = A.block(1, 1, 2, 2);  // {{11,12},{21,22}}
        check(blk.rows() == 2 && blk.cols() == 2 && blk(0, 0) == 11 && blk(1, 1) == 22,
              "Ext: Matrix::block");
        MatrixD C(4, 4);
        C.setBlock(2, 2, blk);
        check(C(2, 2) == 11 && C(3, 3) == 22 && C(2, 3) == 12, "Ext: setBlock");
        C.addBlock(2, 2, blk);
        check(C(2, 2) == 22 && C(3, 3) == 44, "Ext: addBlock accumulates");

        std::vector<double> u{1, 2, 3, 4, 5}, v{10, 20, 30, 40, 50};
        auto seg = vseg(u, 1, 3);  // {2,3,4}
        check(seg.size() == 3 && seg[0] == 2 && seg[2] == 4, "Ext: vseg");
        std::vector<double> w(5, 0.0);
        vsetseg(w, 2, std::vector<double>{7, 8});   // {0,0,7,8,0}
        vaddseg(w, 1, std::vector<double>{1, 1, 1}); // {0,1,8,9,0}
        check(w[2] == 8 && w[3] == 9 && w[1] == 1, "Ext: vsetseg/vaddseg");
        auto sps = vadd(u, v); auto dff = vsub(v, u); auto scl = vscale(u, 2.0);
        check(sps[0] == 11 && dff[0] == 9 && scl[4] == 10, "Ext: vadd/vsub/vscale");
        check(std::abs(vdot(u, v) - 550.0) < 1e-12, "Ext: vdot");
        std::vector<double> y{1, 1, 1, 1, 1};
        vaxpy(y, 2.0, u);  // {3,5,7,9,11}
        check(y[0] == 3 && y[4] == 11, "Ext: vaxpy y += a*x");

        // SparseLU on a NON-symmetric sparse system (super=+1, sub=-2): vs known x + dense LU.
        const std::size_t n = 5;
        std::vector<Triplet<double>> trips;
        for (std::size_t i = 0; i < n; ++i) {
            trips.emplace_back(i, i, 4.0);
            if (i + 1 < n) trips.emplace_back(i, i + 1, 1.0);
            if (i > 0)     trips.emplace_back(i, i - 1, -2.0);
        }
        SparseCSR<double> S; S.setFromTriplets(n, n, trips);
        std::vector<double> xtrue(n);
        for (std::size_t i = 0; i < n; ++i) xtrue[i] = 1.0 + 0.3 * static_cast<double>(i);
        std::vector<double> b = S * xtrue;
        SparseLU slu(S);
        std::vector<double> x = slu.solve(b);
        double luErr = 0.0; for (std::size_t i = 0; i < n; ++i) luErr = std::max(luErr, std::abs(x[i] - xtrue[i]));
        std::vector<double> xd = LU<double>(S.toDense()).solve(b);
        double crossErr = 0.0; for (std::size_t i = 0; i < n; ++i) crossErr = std::max(crossErr, std::abs(x[i] - xd[i]));
        std::printf("[Ext]   sparseLU_err=%.3e  vs_denseLU=%.3e\n", luErr, crossErr);
        check(slu.ok(), "Ext: SparseLU factorization succeeded (non-symmetric)");
        check(luErr < 1e-9, "Ext: SparseLU solve matches known solution");
        check(crossErr < 1e-12, "Ext: SparseLU matches dense LU of the same system");
    }

    // =======================================================================
    // 10. ColPivHouseholderQR — rank-revealing dense QR (the PlaneGCS prereq).
    // =======================================================================
    {
        // (a) full-rank overdetermined least-squares vs a known polynomial fit.
        const std::size_t m = 8, n = 3;
        MatrixD A(m, n);
        std::vector<double> xtrue{1.5, -2.0, 0.75};
        std::vector<double> b(m, 0.0);
        for (std::size_t i = 0; i < m; ++i) {
            double t = 0.2 + 0.3 * static_cast<double>(i);
            A(i, 0) = 1.0; A(i, 1) = t; A(i, 2) = t * t;
            for (std::size_t j = 0; j < n; ++j) b[i] += A(i, j) * xtrue[j];
        }
        ColPivHouseholderQR<double> qr(A);
        std::vector<double> x = qr.solve(b);
        double err = 0.0; for (std::size_t j = 0; j < n; ++j) err = std::max(err, std::abs(x[j] - xtrue[j]));
        check(qr.rank() == n, "ColPivQR: full column rank detected");
        check(err < 1e-9, "ColPivQR: least-squares recovers known coefficients");

        // (b) square nonsingular exact solve.
        MatrixD S(3, 3);
        S(0,0)=4; S(0,1)=1; S(0,2)=2; S(1,0)=1; S(1,1)=5; S(1,2)=0; S(2,0)=2; S(2,1)=0; S(2,2)=3;
        std::vector<double> xs{2, -1, 3}, bs(3, 0.0);
        for (std::size_t i = 0; i < 3; ++i) for (std::size_t j = 0; j < 3; ++j) bs[i] += S(i, j) * xs[j];
        ColPivHouseholderQR<double> qs(S);
        std::vector<double> sol = qs.solve(bs);
        double serr = 0.0; for (std::size_t i = 0; i < 3; ++i) serr = std::max(serr, std::abs(sol[i] - xs[i]));
        check(qs.rank() == 3, "ColPivQR: nonsingular 3x3 full rank");
        check(serr < 1e-12, "ColPivQR: square exact solve");

        // (c) rank-deficient: col2 = 2·col0 ⇒ rank 2; solve stays finite (basic soln).
        MatrixD Rd(4, 3);
        for (std::size_t i = 0; i < 4; ++i) { double t = 1.0 + static_cast<double>(i); Rd(i,0)=t; Rd(i,1)=t*t; Rd(i,2)=2.0*t; }
        std::vector<double> rb{3, 5, 7, 9};
        ColPivHouseholderQR<double> qd(Rd);
        std::vector<double> rx = qd.solve(rb);
        bool finite = true; for (double v : rx) if (!std::isfinite(v)) finite = false;
        check(qd.rank() == 2, "ColPivQR: rank-deficient (col2=2·col0) detects rank 2");
        check(finite, "ColPivQR: rank-deficient basic solution is finite");

        double errEigen = -1.0;
#ifdef FORGE_LINALG_ORACLE
        Eigen::MatrixXd Ae(m, n); Eigen::VectorXd be(m);
        for (std::size_t i = 0; i < m; ++i) { be(i) = b[i]; for (std::size_t j = 0; j < n; ++j) Ae(i, j) = A(i, j); }
        Eigen::VectorXd xe = Ae.colPivHouseholderQr().solve(be);
        errEigen = 0.0; for (std::size_t j = 0; j < n; ++j) errEigen = std::max(errEigen, std::abs(x[j] - xe(j)));
#endif
        std::printf("[ColPivQR] ls_err=%.3e square_err=%.3e rankdef=%zu eigen_err=%.3e\n",
                    err, serr, qd.rank(), errEigen);
#ifdef FORGE_LINALG_ORACLE
        check(errEigen < 1e-9, "ColPivQR: full-rank solve matches Eigen colPivHouseholderQr");
#endif
    }

    std::printf("RESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
