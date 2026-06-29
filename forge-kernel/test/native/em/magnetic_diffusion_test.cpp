// test/native/em/magnetic_diffusion_test.cpp
// ─────────────────────────────────────────────────────────────────────────────
// Native gate — TRANSIENT eddy-current / magnetic diffusion (skin effect),
// validating forge/native/em/MagneticDiffusion.hpp against CLOSED-FORM answers.
// Advances #64 (Elmer-track multiphysics / electromagnetics).
//
// The magnetic-diffusion equation  ∂B/∂t = (1/(μσ))∇²B  (σ∂B/∂t = (1/μ)∇²B) is
// the SAME parabolic operator the transient-thermal solver assembles, with the EM
// substitution conductance k:=ν=1/μ, capacitance ρc:=σ, diffusivity α=1/(μσ).
// It therefore REUSES forge::native::fea::transient_thermal (assembleKC + the
// backward-Euler ThetaThermalIntegrator, factor-once), the ONLY new piece being
// the time-varying surface BC B(0,t)=B0·cos(ωt) via stepBC. Pure C++ / no OCCT /
// no deps — a green gate here certifies the primitive the .node binding's
// forge.em.magneticDiffusion forwards onto once relinked (batched elsewhere).
//
// Cases:
//   1) SKIN DEPTH (key correctness gate). Semi-infinite copper conductor with a
//      sinusoidal surface field B0·cos(ωt) ⇒ B(x,t)≈B0·e^{−x/δ}·cos(ωt−x/δ),
//      δ=√(2/(μσω)). March to sinusoidal steady state, recover A(x) and φ(x) by a
//      one-period Fourier projection, and check (a) the amplitude envelope decays
//      as e^{−x/δ} and (b) the phase lags by x/δ — fitting δ from BOTH and
//      matching the analytic δ within 5%.
//   2) DIFFUSION CROSS-CHECK (DC step). The SAME operator with a step surface
//      field B0 ⇒ the erf/erfc diffusion profile B(x,t)=B0·erfc(x/(2√(αt))),
//      α=1/(μσ) — identical to the transient-thermal erf gate. Proves the operator
//      IS the parabolic diffusion operator with the magnetic diffusivity.
//   3) STEADY / DC LIMIT. A held DC surface field, marched far in time, collapses
//      to the steady operator −∇·(ν∇B)=0 ⇒ the linear field B0(1−x/L) (the
//      Laplace/magnetostatic curl-curl limit) — matched vs the direct steady solve
//      and the closed-form line.
//
// Units SI (m, s, T, S/m, H/m). μ, σ, ω, δ, sample depths and measured errors are
// printed for each gate.

#include "forge/native/em/MagneticDiffusion.hpp"
#include "forge/native/fea/HexElement.hpp"
#include "forge/native/fea/ScalarElliptic.hpp"
#include "forge/native/fea/TransientThermal.hpp"
#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <vector>

namespace em = forge::native::em;
namespace tt = forge::native::fea::transient_thermal;
namespace la = forge::native::linalg;

namespace {

constexpr double kPi = 3.14159265358979323846;

int g_fail = 0;
void check(bool ok, const char* msg) {
    std::printf("    [%s] %s\n", ok ? "PASS" : "FAIL", msg);
    if (!ok) ++g_fail;
}

// Direct STEADY solve K B = F with a Dirichlet partition — the SAME element
// Laplacian (scalar_elliptic::elementStiffness via assembleKC, here with k=ν) the
// magnetostatic / thermal paths assemble, factored with a dense SPD Cholesky. The
// long-time DC limit (Test 3) must reproduce this.
std::vector<double> steadySolve(const tt::HexMesh& m, double k,
                                const std::vector<char>& fixed,
                                const std::vector<double>& fixedVal,
                                const std::vector<double>& F) {
    const std::size_t n = m.nNodes();
    la::MatrixD K, C;
    tt::assembleKC(m, k, 1.0, K, C, /*lumped*/false);   // C unused for steady
    std::vector<int> freeI, fixI;
    for (std::size_t i = 0; i < n; ++i)
        (fixed[i] ? fixI : freeI).push_back(static_cast<int>(i));
    const std::size_t nf = freeI.size();
    la::MatrixD Kff(nf, nf);
    std::vector<double> bf(nf);
    for (std::size_t a = 0; a < nf; ++a) {
        double v = F[freeI[a]];
        for (std::size_t c = 0; c < fixI.size(); ++c)
            v -= K(freeI[a], fixI[c]) * fixedVal[fixI[c]];
        bf[a] = v;
        for (std::size_t b = 0; b < nf; ++b) Kff(a, b) = K(freeI[a], freeI[b]);
    }
    la::LLT<double> llt(Kff);
    std::vector<double> xf = llt.solve(bf);
    std::vector<double> B(n);
    for (std::size_t i = 0; i < n; ++i) B[i] = fixed[i] ? fixedVal[i] : 0.0;
    for (std::size_t a = 0; a < nf; ++a) B[freeI[a]] = xf[a];
    return B;
}

// ── Test 1 — skin depth (amplitude e^{−x/δ} + phase lag x/δ) ─────────────────
void test_skin_depth() {
    std::printf("[em/magnetic_diffusion] Test 1 — skin depth δ=√(2/(μσω)) (amplitude + phase)\n");
    em::SkinEffectConfig cfg;
    cfg.mu    = 1.25663706143591729e-6;   // μ₀
    cfg.sigma = 5.8e7;                     // copper (S/m)
    cfg.omega = 2.0 * kPi * 1000.0;        // f = 1 kHz
    cfg.B0    = 1.0;                        // T
    cfg.N     = 80;                         // dx = L/N = δ/10 (L defaults to 8δ)
    cfg.stepsPerPeriod  = 160;
    cfg.periodsToSteady = 20;

    em::SkinEffectResult r = em::solveSkinEffect(cfg);
    check(r.ok, "backward-Euler operator (C/Δt+K)_ff factorises (SPD)");

    const double f = cfg.omega / (2.0 * kPi);
    std::printf("    μ=%.4e H/m,  σ=%.3e S/m,  f=%.0f Hz (ω=%.2f),  δ_analytic=%.4e m (%.3f mm)\n",
                cfg.mu, cfg.sigma, f, cfg.omega, r.delta, r.delta * 1e3);
    std::printf("    domain L=8δ, %d elems (dx=δ/10),  Δt=%.3e s (%d steps/period),  %d steps total\n",
                cfg.N, r.dt, cfg.stepsPerPeriod, r.nSteps);
    std::printf("       x/δ    |B|_num    |B|_analytic   ampΔ%%      φ_num    φ_ana(x/δ)   phaseΔ%%\n");
    double ampErrMax = 0.0, phErrMax = 0.0;
    for (std::size_t q = 0; q < r.depth.size(); ++q) {
        const double xod   = r.depth[q] / r.delta;
        const double ampE  = std::fabs(r.ampNum[q]   - r.ampAna[q])   / cfg.B0;          // vs B0
        const double phE   = std::fabs(r.phaseNum[q] - r.phaseAna[q]) / r.phaseAna[q];   // rel
        ampErrMax = std::max(ampErrMax, ampE);
        phErrMax  = std::max(phErrMax,  phE);
        std::printf("     %5.2f   %8.5f   %8.5f     %6.2f    %7.4f   %7.4f      %6.2f\n",
                    xod, r.ampNum[q], r.ampAna[q], ampE * 100.0,
                    r.phaseNum[q], r.phaseAna[q], phE * 100.0);
    }
    const double eAmp = std::fabs(r.deltaAmp   - r.delta) / r.delta;
    const double ePh  = std::fabs(r.deltaPhase - r.delta) / r.delta;
    std::printf("    δ fit (amplitude −ln(A/B0)=x/δ) = %.4e m   → %.3f %% vs analytic\n",
                r.deltaAmp, eAmp * 100.0);
    std::printf("    δ fit (phase lag φ=x/δ)         = %.4e m   → %.3f %% vs analytic\n",
                r.deltaPhase, ePh * 100.0);
    std::printf("    per-depth max: amplitude env err = %.2f %% of B0,  phase-lag err = %.2f %%\n",
                ampErrMax * 100.0, phErrMax * 100.0);
    check(eAmp < 0.05, "skin depth from amplitude decay e^{−x/δ} matches analytic δ within 5%");
    check(ePh  < 0.05, "skin depth from phase lag x/δ matches analytic δ within 5%");
    check(ampErrMax < 0.05, "amplitude envelope follows B0·e^{−x/δ} at every depth (<5% of B0)");
    check(phErrMax  < 0.08, "phase lag follows x/δ at every depth (<8%)");
}

// ── Test 2 — DC-step diffusion cross-check vs erfc (α=1/(μσ)) ─────────────────
void test_diffusion_erfc() {
    std::printf("[em/magnetic_diffusion] Test 2 — DC-step diffusion vs erfc(x/2√(αt)), α=1/(μσ)\n");
    const double mu = 1.25663706143591729e-6, sigma = 5.8e7;
    const double nu = 1.0 / mu;
    const double alpha = 1.0 / (mu * sigma);            // magnetic diffusivity
    const double Lx = 0.05, a = 1e-3;                   // 50 mm deep bar
    const int    N  = 100;                              // dx = 0.5 mm
    const double B0 = 1.0;
    // diffusion front 2√(αt). Choose t so 2√(αt)=12.5 mm (front well inside Lx).
    const double diff = 0.0125;
    const double tEnd = (diff * diff / 4.0) / alpha;    // (diff/2)²/α
    const int    nSteps = 240;
    const double dt = tEnd / nSteps;

    em::DiffusionBar bar = em::buildBar(N, Lx, a);
    const std::size_t n = bar.mesh.nNodes();
    tt::MatrixD K, C;
    tt::assembleKC(bar.mesh, /*k=*/nu, /*rhoC=*/sigma, K, C, /*lumped*/false);

    // Dirichlet: surface (x=0) stepped to B0; far end held 0 (semi-infinite).
    std::vector<char>   fixed(n, 0);
    std::vector<double> fval(n, 0.0);
    for (int id : bar.xFace(0))     { fixed[id] = 1; fval[id] = B0; }
    for (int id : bar.xFace(bar.N)) { fixed[id] = 1; fval[id] = 0.0; }

    tt::ThetaThermalIntegrator integ(K, C, dt, fixed, fval, /*theta*/1.0);
    check(integ.ok(), "backward-Euler operator factorises (SPD)");
    std::vector<double> B(n, 0.0), F(n, 0.0);           // IC interior 0
    B = integ.march(B, F, nSteps);                      // constant BC (E1 step path)

    std::printf("    μ=%.4e, σ=%.3e ⇒ α=1/(μσ)=%.4e m²/s,  Δt=%.3e s,  t=%.4e s,  2√(αt)=%.4f m\n",
                mu, sigma, alpha, dt, tEnd, diff);
    const double xs[3] = {0.0050, 0.0100, 0.0150};      // 10,20,30 dx into the bar
    double eMax = 0.0;
    std::printf("       x(m)    B_num     B_erfc      |Δ|/B0%%\n");
    for (double x : xs) {
        const int i = static_cast<int>(std::lround(x / bar.dx));
        const double Bnum = B[bar.node(i)];
        const double Bana = B0 * std::erfc(x / diff);   // erfc(x/2√(αt)) = 1−erf
        const double rel  = std::fabs(Bnum - Bana) / B0;
        eMax = std::max(eMax, rel);
        std::printf("     %6.4f  %8.5f  %8.5f     %6.2f\n", x, Bnum, Bana, rel * 100.0);
    }
    std::printf("    max error vs erfc diffusion profile = %.3f %%  (tol 3%%)\n", eMax * 100.0);
    check(eMax < 0.03, "DC-step magnetic diffusion matches erfc(x/2√(αt)) ⇒ α=1/(μσ) (within 3%)");
}

// ── Test 3 — steady / DC limit (operator → magnetostatic Laplace) ────────────
void test_steady_limit() {
    std::printf("[em/magnetic_diffusion] Test 3 — DC steady limit → −∇·(ν∇B)=0 (linear B0(1−x/L))\n");
    const double mu = 1.25663706143591729e-6, sigma = 5.8e7;
    const double nu = 1.0 / mu;
    const double Lx = 0.05, a = 1e-3; const int N = 60;
    const double B0 = 2.0;
    em::DiffusionBar bar = em::buildBar(N, Lx, a);
    const std::size_t n = bar.mesh.nNodes();
    tt::MatrixD K, C;
    tt::assembleKC(bar.mesh, /*k=*/nu, /*rhoC=*/sigma, K, C, /*lumped*/false);

    std::vector<char>   fixed(n, 0);
    std::vector<double> fval(n, 0.0);
    for (int id : bar.xFace(0))     { fixed[id] = 1; fval[id] = B0; }   // DC surface
    for (int id : bar.xFace(bar.N)) { fixed[id] = 1; fval[id] = 0.0; }  // far end 0
    std::vector<double> F(n, 0.0);

    // Reference: direct steady −∇·(ν∇B)=0 (same element Laplacian, k=ν).
    std::vector<double> Bsteady = steadySolve(bar.mesh, nu, fixed, fval, F);

    // Transient marched far in time (large Δt) until the increment is negligible.
    const double dt = 1.0e-3;   // ≫ diffusion time ⇒ steady in a few steps
    tt::ThetaThermalIntegrator integ(K, C, dt, fixed, fval, /*theta*/1.0);
    std::vector<double> B(n, 0.5 * B0);                 // arbitrary IC
    double incr = 0.0; int steps = 0;
    for (; steps < 500; ++steps) {
        std::vector<double> Bn1 = integ.step(B, F);
        incr = 0.0;
        for (std::size_t i = 0; i < n; ++i) incr = std::max(incr, std::fabs(Bn1[i] - B[i]));
        B = Bn1;
        if (incr < 1e-13) { ++steps; break; }
    }
    // (a) long-time transient == direct steady operator (A/B), relative L2.
    double num = 0.0, den = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const double d = B[i] - Bsteady[i]; num += d * d; den += Bsteady[i] * Bsteady[i];
    }
    const double rel = std::sqrt(num / den);
    // (b) both match the closed-form line B(x)=B0(1−x/L) (linear elements exact).
    double eLine = 0.0;
    for (int i = 0; i <= bar.N; ++i) {
        const double x = i * bar.dx;
        eLine = std::max(eLine, std::fabs(B[bar.node(i)] - B0 * (1.0 - x / Lx)));
    }
    std::printf("    marched %d steps (Δt=%.1e s), final increment=%.2e\n", steps, dt, incr);
    std::printf("    ||B_transient − B_steady||/||B_steady|| = %.3e  (tol 1e-4)\n", rel);
    std::printf("    max|B − B0(1−x/L)| = %.3e T  (linear magnetostatic limit, tol 1e-9·B0)\n", eLine);
    check(rel   < 1e-4,        "DC long-time field equals the STEADY operator −∇·(ν∇B)=0 (A/B)");
    check(eLine < 1e-9 * B0,   "DC steady B(x)=B0(1−x/L) exact (operator → magnetostatic Laplace)");
}

} // namespace

int main() {
    std::printf("==== native gate: forge::native::em magnetic diffusion / skin effect "
                "(∂B/∂t = (1/μσ)∇²B) ====\n");
    test_skin_depth();
    test_diffusion_erfc();
    test_steady_limit();
    if (g_fail == 0) {
        std::printf("RESULT: ALL MAGNETIC-DIFFUSION GATES PASS (9 checks)\n");
        return 0;
    }
    std::printf("RESULT: %d MAGNETIC-DIFFUSION CHECK(S) FAILED\n", g_fail);
    return 1;
}
