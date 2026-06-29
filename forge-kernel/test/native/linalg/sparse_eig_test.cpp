// forge-kernel/test/native/linalg/sparse_eig_test.cpp
//
// Validation gate for forge::native::linalg::sparseGeneralizedEigSI — the SPARSE
// SHIFT-INVERT LANCZOS generalized eigensolver that lifts the dense ≈1500-DOF cap
// in forge.fea.solveModal so a MODAL solve runs on realistic meshes.
//
// This gate is Eigen-free and OCCT-free: it builds the generalized eigenproblems
// (K φ = λ M φ) directly from textbook finite-element matrices and validates the
// sparse solver against (a) the EXISTING dense GeneralizedSymmetricEigen oracle
// on a small problem, (b) sharp ANALYTIC closed forms at SCALE (> 1500 DOF), and
// (c) the genuine pencil residual ‖Kφ − λMφ‖/‖λMφ‖ (proving no ghost modes).
//
// WHAT IS VALIDATED (the increment, #62 native implicit FEA):
//   1. A/B vs dense — a clamped Euler–Bernoulli beam (≤1500 DOF): the lowest 6
//      eigenvalues from sparseGeneralizedEigSI agree with dense
//      GeneralizedSymmetricEigen to ~1e-6 relative. Proves CORRECTNESS.
//   2. SCALE known-answer (Euler–Bernoulli) — a cantilever meshed to > 1500 DOF
//      (the OLD dense cap would have REFUSED this): the fundamental frequency
//      matches the analytic value f₁ = (β₁L)²/(2π)·√(EI/ρAL⁴), β₁L = 1.875104,
//      to < 2 %. Proves the sparse solver PRESERVES the (already-proven) element
//      accuracy at scale, and that it RUNS past the cap.
//   3. SCALE known-answer (analytic spectrum) — a 1-D Laplacian generalized
//      problem at n > 1500 with M = I: the lowest 6 λ match the closed form
//      λ_k = 2 − 2cos(kπ/(n+1)) to tight tolerance, with tiny residual. Proves
//      no loss-of-orthogonality / ghost eigenvalues at scale.
//
// Build/run is wired by test/native/run_native.sh (globs test/native/linalg/*.cpp).

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "forge/native/linalg/LinAlg.hpp"

using namespace forge::native::linalg;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const char* name) {
    ++g_total;
    if (cond) ++g_pass;
    else      std::printf("  [FAIL] %s\n", name);
}

// ---------------------------------------------------------------------------
// Assemble a clamped (cantilever) Euler–Bernoulli beam as a generalized
// eigenproblem K_ff φ = λ M_ff φ over the FREE DOFs (the root node's w,θ are
// removed — the "constrained-DOFs-removed" form for which σ=0 is correct).
//
// Per 2-node Hermitian-cubic beam element (length Le, bending stiffness EI,
// mass-per-length ρA), DOFs {w_i, θ_i, w_j, θ_j}:
//   Ke = EI/Le³ · [[12,6Le,-12,6Le],[6Le,4Le²,-6Le,2Le²],
//                  [-12,-6Le,12,-6Le],[6Le,2Le²,-6Le,4Le²]]
//   Me = ρA·Le/420 · [[156,22Le,54,-13Le],[22Le,4Le²,13Le,-3Le²],
//                     [54,13Le,156,-22Le],[-13Le,-3Le²,-22Le,4Le²]]
// Node 0 is clamped (w0=θ0=0), so the free DOFs are nodes 1..nEl (2 each):
// global free index of (node a, dof d) is 2*(a-1)+d for a>=1.
// ---------------------------------------------------------------------------
static void buildCantilever(int nEl, double L, double EI, double rhoA,
                            SparseCSR<double>& K, SparseCSR<double>& M,
                            std::size_t& nFree) {
    const double Le = L / nEl;
    const int nNodes = nEl + 1;
    nFree = static_cast<std::size_t>(2 * (nNodes - 1));   // node 0 clamped

    const double ke = EI / (Le * Le * Le);
    double Kl[4][4] = {
        { 12.0,      6.0 * Le,   -12.0,     6.0 * Le   },
        { 6.0 * Le,  4.0 * Le * Le, -6.0 * Le, 2.0 * Le * Le },
        { -12.0,    -6.0 * Le,    12.0,    -6.0 * Le   },
        { 6.0 * Le,  2.0 * Le * Le, -6.0 * Le, 4.0 * Le * Le },
    };
    const double me = rhoA * Le / 420.0;
    double Ml[4][4] = {
        { 156.0,      22.0 * Le,    54.0,      -13.0 * Le   },
        { 22.0 * Le,  4.0 * Le * Le, 13.0 * Le, -3.0 * Le * Le },
        { 54.0,       13.0 * Le,    156.0,     -22.0 * Le   },
        { -13.0 * Le, -3.0 * Le * Le, -22.0 * Le, 4.0 * Le * Le },
    };

    // global free DOF index of (node a in [0..nNodes-1], local dof d in {0,1}):
    // node 0 clamped -> -1; node a>=1 -> 2*(a-1)+d.
    auto gdof = [&](int node, int d) -> int {
        if (node == 0) return -1;
        return 2 * (node - 1) + d;
    };

    std::vector<Triplet<double>> kt, mt;
    kt.reserve(static_cast<std::size_t>(nEl) * 16);
    mt.reserve(static_cast<std::size_t>(nEl) * 16);
    for (int e = 0; e < nEl; ++e) {
        const int na = e, nb = e + 1;
        int g[4] = { gdof(na, 0), gdof(na, 1), gdof(nb, 0), gdof(nb, 1) };
        for (int i = 0; i < 4; ++i) {
            if (g[i] < 0) continue;
            for (int j = 0; j < 4; ++j) {
                if (g[j] < 0) continue;
                kt.emplace_back((std::size_t)g[i], (std::size_t)g[j], ke * Kl[i][j]);
                mt.emplace_back((std::size_t)g[i], (std::size_t)g[j], me * Ml[i][j]);
            }
        }
    }
    K.setFromTriplets(nFree, nFree, kt);
    M.setFromTriplets(nFree, nFree, mt);
}

// infinity norm (max abs row sum) of a CSR matrix.
static double infNorm(const SparseCSR<double>& A) {
    const auto& rp = A.rowPtr(); const auto& v = A.values();
    double m = 0.0;
    for (std::size_t i = 0; i + 1 < rp.size(); ++i) {
        double s = 0.0;
        for (std::size_t p = rp[i]; p < rp[i + 1]; ++p) s += std::fabs(v[p]);
        m = std::max(m, s);
    }
    return m;
}

// Standard normwise relative BACKWARD ERROR for a generalized eigenpair
// (LAPACK xSYGV/xDRGT residual test):
//   η = ‖Kφ − λMφ‖_∞ / ((‖K‖_∞ + |λ|‖M‖_∞)·‖φ‖_∞)
// Unlike the raw ratio ‖Kφ−λMφ‖/‖λMφ‖, this normalizes out ‖K‖, so it is NOT
// inflated for a stiff (high-cond) pencil; η ~ machine precision certifies the
// pair is a genuine eigenpair to full working accuracy.
static double backwardError(const SparseCSR<double>& K, const SparseCSR<double>& M,
                            double nK, double nM, double lam,
                            const std::vector<double>& phi) {
    std::vector<double> Kp = K * phi, Mp = M * phi;
    double rinf = 0.0, pinf = 0.0;
    for (std::size_t i = 0; i < phi.size(); ++i) {
        rinf = std::max(rinf, std::fabs(Kp[i] - lam * Mp[i]));
        pinf = std::max(pinf, std::fabs(phi[i]));
    }
    double denom = (nK + std::fabs(lam) * nM) * std::max(pinf, 1e-300);
    return rinf / std::max(denom, 1e-300);
}

// max relative pencil residual ‖Kφ − λMφ‖/‖λMφ‖ over a result set.
static double pencilResidual(const SparseCSR<double>& K, const SparseCSR<double>& M,
                             const SparseGenEigResult& r) {
    double worst = 0.0;
    for (std::size_t t = 0; t < r.eigenvalues.size(); ++t) {
        std::vector<double> Kp = K * r.eigenvectors[t];
        std::vector<double> Mp = M * r.eigenvectors[t];
        double rn = 0.0, dn = 0.0;
        for (std::size_t i = 0; i < Kp.size(); ++i) {
            double rr = Kp[i] - r.eigenvalues[t] * Mp[i];
            double dd = r.eigenvalues[t] * Mp[i];
            rn += rr * rr; dn += dd * dd;
        }
        worst = std::max(worst, (dn > 0.0) ? std::sqrt(rn / dn) : std::sqrt(rn));
    }
    return worst;
}

int main() {
    std::printf("== forge::native::linalg sparse shift-invert Lanczos modal gate ==\n");

    // =======================================================================
    // 1. A/B vs dense GeneralizedSymmetricEigen — small clamped beam (≤1500 DOF).
    //    Identical K,M fed to both; lowest 6 eigenvalues must agree to ~1e-6 rel.
    // =======================================================================
    {
        const int nEl = 40;                              // free DOF = 2*40 = 80
        SparseCSR<double> K, M; std::size_t nf = 0;
        buildCantilever(nEl, /*L=*/1.0, /*EI=*/2800.0, /*rhoA=*/3.12, K, M, nf);
        check(nf <= 1500, "AB: small problem is under the dense cap");

        const int k = 6;
        // sparse shift-invert Lanczos
        SparseGenEigResult sp = sparseGeneralizedEigSI(K, M, k, /*sigma=*/0.0);
        check(sp.ok, "AB: sparse shift-invert Lanczos converged");

        // dense oracle
        MatrixD Kd = K.toDense(), Md = M.toDense();
        GeneralizedSymmetricEigen ge(Kd, Md, /*computeVectors=*/false);
        check(ge.ok(), "AB: dense GeneralizedSymmetricEigen oracle ok");

        double maxRel = 0.0;
        for (int i = 0; i < k; ++i) {
            double ref = ge.eigenvalues()[i];            // ascending
            double rel = std::fabs(sp.eigenvalues[i] - ref) / std::max(std::fabs(ref), 1e-300);
            maxRel = std::max(maxRel, rel);
        }
        double resid = pencilResidual(K, M, sp);
        std::printf("[AB]    nf=%zu steps=%d  lowest6_rel_err_vs_dense=%.3e  pencil_resid=%.3e  op_resid=%.3e\n",
                    nf, sp.lanczosSteps, maxRel, resid, sp.maxResidual);
        std::printf("        sparse lowest-6 lambda: ");
        for (int i = 0; i < k; ++i) std::printf("%.6g ", sp.eigenvalues[i]);
        std::printf("\n");
        check(maxRel < 1e-6, "AB: lowest 6 eigenvalues agree with dense to 1e-6 relative");
        check(resid < 1e-6,  "AB: pencil residual ||Kφ-λMφ||/||λMφ|| < 1e-6 (genuine modes)");
    }

    // =======================================================================
    // 2. SCALE known-answer (Euler–Bernoulli) — cantilever > 1500 DOF.
    //    The OLD dense path threw above 1500 DOF; the sparse solver must RUN and
    //    return f₁ within < 2% of the analytic Euler–Bernoulli value.
    // =======================================================================
    {
        // unit-ish steel cantilever, square 20mm section, L=1m.
        const double L   = 1.0;
        const double E   = 2.1e11, rho = 7800.0;
        const double b = 0.02, h = 0.02;
        const double Acs = b * h;                         // 4e-4
        const double I   = b * h * h * h / 12.0;          // 1.3333e-8
        const double EI  = E * I;
        const double rhoA = rho * Acs;

        const int nEl = 900;                              // free DOF = 1800 > 1500
        SparseCSR<double> K, M; std::size_t nf = 0;
        buildCantilever(nEl, L, EI, rhoA, K, M, nf);
        check(nf > 1500, "SCALE: cantilever exceeds the old dense-eigen cap (>1500 DOF)");

        const int k = 6;
        auto t0 = std::chrono::high_resolution_clock::now();
        SparseGenEigResult sp = sparseGeneralizedEigSI(K, M, k, /*sigma=*/0.0);
        auto t1 = std::chrono::high_resolution_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        check(sp.ok, "SCALE: sparse modal solve converged at > 1500 DOF (old cap lifted)");

        // analytic Euler–Bernoulli cantilever fundamental.
        const double betaL = 1.8751040687119611;          // first root of cos·cosh+1=0
        const double w1 = betaL * betaL * std::sqrt(EI / (rhoA * L * L * L * L));
        const double f1_analytic = w1 / (2.0 * M_PI);

        const double w1_fe = std::sqrt(std::max(0.0, sp.eigenvalues[0]));
        const double f1_fe = w1_fe / (2.0 * M_PI);
        const double relF = std::fabs(f1_fe - f1_analytic) / f1_analytic;

        // For a fine (hence STIFF, cond(K)~nEl³, ‖K‖~1e13) beam the RAW K-pencil
        // ratio ‖Kφ−λMφ‖/‖λMφ‖ is inflated by ‖K‖ for EVERY mode even though the
        // modes are genuine (frequency exact, op_resid ~1e-16). The honest, scale-
        // invariant certificates are the normwise BACKWARD ERROR and the M-norm
        // operator residual — both at machine precision here.
        const double nK = infNorm(K), nM = infNorm(M);
        double beMax = 0.0;
        for (int i = 0; i < k; ++i)
            beMax = std::max(beMax, backwardError(K, M, nK, nM, sp.eigenvalues[i], sp.eigenvectors[i]));
        double residMax = pencilResidual(K, M, sp);

        std::printf("[SCALE] nf=%zu steps=%d wall=%.1fms  f1_fe=%.6f Hz  f1_analytic=%.6f Hz  "
                    "rel_err=%.4f%%  backward_err=%.3e  raw_pencil_ratio=%.3e  op_resid=%.3e\n",
                    nf, sp.lanczosSteps, ms, f1_fe, f1_analytic, 100.0 * relF,
                    beMax, residMax, sp.maxResidual);
        std::printf("        lowest-6 f (Hz): ");
        for (int i = 0; i < k; ++i) std::printf("%.4f ", std::sqrt(std::max(0.0, sp.eigenvalues[i])) / (2.0 * M_PI));
        std::printf("\n");
        check(relF < 0.02,   "SCALE: fundamental frequency within 2% of analytic Euler-Bernoulli");
        check(beMax < 1e-12, "SCALE: normwise backward error < 1e-12 for all 6 modes (genuine, machine-precision)");
        check(sp.maxResidual < 1e-9, "SCALE: shift-invert operator residual < 1e-9 (all 6 modes genuine)");
    }

    // =======================================================================
    // 3. SCALE known-answer (analytic spectrum) — 1-D Laplacian generalized
    //    problem at n > 1500 with M = I. Tight closed-form cross-check + tiny
    //    residual proves full re-orthogonalization kills ghosts at scale.
    //    K = tridiag(2,-1) (SPD), M = I -> λ_k = 2 - 2cos(kπ/(n+1)).
    // =======================================================================
    {
        const std::size_t n = 2000;                       // > 1500
        std::vector<Triplet<double>> kt, mt;
        kt.reserve(3 * n); mt.reserve(n);
        for (std::size_t i = 0; i < n; ++i) {
            kt.emplace_back(i, i, 2.0);
            if (i + 1 < n) { kt.emplace_back(i, i + 1, -1.0); kt.emplace_back(i + 1, i, -1.0); }
            mt.emplace_back(i, i, 1.0);
        }
        SparseCSR<double> K, M;
        K.setFromTriplets(n, n, kt);
        M.setFromTriplets(n, n, mt);

        const int k = 6;
        SparseGenEigResult sp = sparseGeneralizedEigSI(K, M, k, /*sigma=*/0.0);
        check(sp.ok, "LAP: sparse modal solve converged (n=2000)");

        std::vector<double> analytic(k);
        for (int i = 1; i <= k; ++i)
            analytic[i - 1] = 2.0 - 2.0 * std::cos(M_PI * i / (double)(n + 1));

        double maxRel = 0.0;
        for (int i = 0; i < k; ++i) {
            double rel = std::fabs(sp.eigenvalues[i] - analytic[i]) /
                         std::max(std::fabs(analytic[i]), 1e-300);
            maxRel = std::max(maxRel, rel);
        }
        // M-orthonormality φᵢᵀMφⱼ = δᵢⱼ (here M=I) over the returned modes.
        double mOrth = 0.0;
        for (int a = 0; a < k; ++a) {
            std::vector<double> Mpa = M * sp.eigenvectors[a];
            for (int bb = 0; bb < k; ++bb) {
                double s = 0.0;
                for (std::size_t i = 0; i < n; ++i) s += sp.eigenvectors[bb][i] * Mpa[i];
                mOrth = std::max(mOrth, std::fabs(s - (a == bb ? 1.0 : 0.0)));
            }
        }
        double resid = pencilResidual(K, M, sp);
        std::printf("[LAP]   n=%zu steps=%d  analytic_rel_err=%.3e  M_orth_err=%.3e  pencil_resid=%.3e  op_resid=%.3e\n",
                    n, sp.lanczosSteps, maxRel, mOrth, resid, sp.maxResidual);
        check(maxRel < 1e-7, "LAP: lowest 6 λ match analytic 2-2cos(kπ/(n+1)) at scale");
        check(mOrth < 1e-8,  "LAP: returned modes are M-orthonormal (no ghost duplicates)");
        check(resid < 1e-6,  "LAP: pencil residual small at scale (well-conditioned)");
        check(sp.maxResidual < 1e-9, "LAP: shift-invert operator residual < 1e-9 (no ghosts; full reorth)");
    }

    std::printf("RESULT: %d / %d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
