// test/native/fea/transient_dynamics_test.cpp
// ─────────────────────────────────────────────────────────────────────────────
// Native gate — transient STRUCTURAL dynamics on the 8-node hex (Newmark-β),
// validating forge/native/fea/TransientDynamics.hpp against KNOWN ANSWERS. The
// continuum-FE complement to the modal eigensolver (la::GeneralizedSymmetricEigen
// / Fea.cpp::solveModal) and the rigid-body HHT-α DAE solver. Advances #56
// (dynamic mandate) / #62. Pure C++ / no OCCT / no deps — a green gate here
// certifies the primitive the .node binding's solveDynamic forwards onto.
//
// Cases (M ü + C u̇ + K u = F(t), Newmark γ=½ β=¼ constant-average-acceleration):
//   1) UNDAMPED FREE VIBRATION ↔ MODAL  (THE key cross-check):
//      (a) cantilever, seed u₀ = mode-1 eigenvector, release ⇒ the time response
//          oscillates at the SAME f₁ la::GeneralizedSymmetricEigen returns; period
//          from zero-crossings matches f₁ within <2% (transient ↔ modal, identical
//          K,M). (b) a locking-free AXIAL bar (ν=0, lateral DOFs fixed) whose
//          modal fundamental EQUALS the published bar-wave closed form f = c/4L,
//          c=√(E/ρ) — transient ↔ modal ↔ analytic all within tolerance.
//   2) DAMPED DECAY: mass-proportional Rayleigh C=αM giving a known modal ζ₁;
//      the seeded mode-1 envelope decays as e^(−ζ₁ω₁t); the measured log-decrement
//      matches 2πζ/√(1−ζ²).
//   3) NEWMARK ENERGY / STABILITY: undamped ⇒ total energy ½u̇ᵀMu̇+½uᵀKu shows NO
//      secular drift over many steps (avg-accel is non-dissipative); a HUGE Δt
//      stays bounded (unconditional stability).
//   4) STATIC LIMIT (A/B): a slowly-ramped load with light damping settles onto
//      the staticSolve(K) displacement.
//
// Units SI (m, kg, s, N, Pa).

#include "forge/native/fea/TransientDynamics.hpp"
#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <vector>

namespace td = forge::native::fea::transient_dynamics;
namespace la = forge::native::linalg;

namespace {

constexpr double kPi    = 3.14159265358979323846;
constexpr double kTwoPi = 6.283185307179586477;

int g_fail = 0;
void check(bool ok, const char* msg) {
    std::printf("    [%s] %s\n", ok ? "PASS" : "FAIL", msg);
    if (!ok) ++g_fail;
}

// ── A straight prismatic beam: Nx hexes along x, 1 element through the b×h
//    cross-section (y,z). node(i,j,l): i∈[0,Nx] along x, j,l∈{0,1}. ──────────────
struct Beam {
    td::HexMesh mesh;
    int Nx; double L, b, h, dx;
    int nid(int i, int j, int l) const { return i * 4 + j * 2 + l; }
    std::array<int,4> xFace(int i) const {
        return { nid(i,0,0), nid(i,1,0), nid(i,0,1), nid(i,1,1) };
    }
};

Beam buildBeam(int Nx, double L, double b, double h) {
    Beam bm; bm.Nx = Nx; bm.L = L; bm.b = b; bm.h = h; bm.dx = L / Nx;
    bm.mesh.nodes.resize((Nx + 1) * 4);
    for (int i = 0; i <= Nx; ++i)
        for (int j = 0; j < 2; ++j)
            for (int l = 0; l < 2; ++l)
                bm.mesh.nodes[bm.nid(i,j,l)] = { i * bm.dx, j * b, l * h };
    for (int i = 0; i < Nx; ++i) {
        // canonical HexElement node order (ξ=x, η=y, ζ=z) ⇒ det J > 0.
        bm.mesh.elems.push_back({
            bm.nid(i,  0,0), bm.nid(i+1,0,0), bm.nid(i+1,1,0), bm.nid(i,  1,0),
            bm.nid(i,  0,1), bm.nid(i+1,0,1), bm.nid(i+1,1,1), bm.nid(i,  1,1),
        });
    }
    return bm;
}

// Pick the free DOF with the largest |mode| amplitude — the cleanest probe for
// the zero-crossing period / peak-decrement measurement.
int probeDof(const std::vector<double>& mode, const std::vector<char>& fixed) {
    int best = -1; double bestA = -1;
    for (std::size_t i = 0; i < mode.size(); ++i)
        if (!fixed[i] && std::fabs(mode[i]) > bestA) { bestA = std::fabs(mode[i]); best = static_cast<int>(i); }
    return best;
}

// Period from mean-removed zero crossings (linear-interpolated). Uses the span
// between the 2nd and last crossing over the number of half-cycles (skips the
// first crossing to avoid any start transient). Returns 0 if too few crossings.
double periodFromZeroCrossings(const std::vector<double>& t, const std::vector<double>& x) {
    double mean = 0; for (double xi : x) mean += xi; mean /= static_cast<double>(x.size());
    std::vector<double> cr;
    for (std::size_t i = 1; i < x.size(); ++i) {
        const double a = x[i-1] - mean, b = x[i] - mean;
        if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) {
            const double frac = a / (a - b);
            cr.push_back(t[i-1] + frac * (t[i] - t[i-1]));
        }
    }
    if (cr.size() < 4) return 0.0;
    const std::size_t k0 = 1;                       // skip the first crossing
    const double span = cr.back() - cr[k0];
    const double halfCycles = static_cast<double>(cr.size() - 1 - k0);
    return 2.0 * span / halfCycles;
}

// Log-decrement from the successive positive peaks of a decaying oscillation, by
// a least-squares fit of ln(peak) vs peak index (slope = −δ).
double logDecrement(const std::vector<double>& x) {
    double mean = 0; for (double xi : x) mean += xi; mean /= static_cast<double>(x.size());
    std::vector<double> pk;
    for (std::size_t i = 1; i + 1 < x.size(); ++i)
        if (x[i] - mean > 0 && x[i] > x[i-1] && x[i] >= x[i+1]) pk.push_back(x[i] - mean);
    if (pk.size() < 3) return 0.0;
    // least-squares slope of ln(pk_k) vs k.
    const std::size_t m = pk.size();
    double sk = 0, sy = 0, skk = 0, sky = 0;
    for (std::size_t k = 0; k < m; ++k) {
        const double y = std::log(pk[k]);
        sk += k; sy += y; skk += static_cast<double>(k) * k; sky += static_cast<double>(k) * y;
    }
    const double denom = m * skk - sk * sk;
    const double slope = (m * sky - sk * sy) / denom;
    return -slope;                                  // δ per cycle
}

// Euler-Bernoulli cantilever fundamental (reported for context; the 1-element-
// thick fully-integrated hex shear-locks, so this is NOT a hard gate).
double eulerBernoulliCantilever(double E, double rho, double L, double bWidth, double thick) {
    const double I = bWidth * thick * thick * thick / 12.0;   // bending about y, deflect in z
    const double A = bWidth * thick;
    const double bl = 1.8751040687119611;                      // β₁L, fixed-free
    return (bl * bl) / kTwoPi * std::sqrt(E * I / (rho * A * L * L * L * L));
}

// ── Test 1 — undamped free vibration frequency vs modal (the key cross-check) ──
void test_freevib_vs_modal() {
    std::printf("[fea/transient_dynamics] Test 1 — undamped free vibration ↔ modal eigenfrequency\n");
    const double E = 2.1e11, rho = 7800.0;

    // (a) CANTILEVER (ν=0.3): mode-1 internal consistency (transient ↔ modal).
    {
        const double nu = 0.3, L = 1.0, bW = 0.06, hT = 0.04;
        const int Nx = 10;
        Beam beam = buildBeam(Nx, L, bW, hT);
        const std::size_t nDof = 3 * beam.mesh.nodes.size();
        la::MatrixD K, M;
        td::assembleKM(beam.mesh, E, nu, rho, K, M, /*lumpedMass=*/false);

        std::vector<char> fixed(nDof, 0);
        for (int id : beam.xFace(0))                // clamp the x=0 end (all 3 DOF)
            for (int d = 0; d < 3; ++d) fixed[3*id + d] = 1;

        td::ModalData modal = td::modalAnalysis(K, M, fixed, 3);
        check(modal.ok && !modal.freqHz.empty(), "GeneralizedSymmetricEigen modal solve ok");
        const double f1 = modal.freqHz[0], w1 = modal.omega[0];
        const double fEB = eulerBernoulliCantilever(E, rho, L, bW, hT);
        std::printf("    cantilever  L=%.2f b=%.3f h=%.3f  modal f1 = %.3f Hz (ω1=%.2f)  [Euler-Bernoulli %.3f Hz, locked hex]\n",
                    L, bW, hT, f1, w1, fEB);

        // seed u0 = mode-1 (scaled to max |u|=1e-4 m), release undamped.
        std::vector<double> u0 = modal.modes[0];
        double mx = 0; for (double v : u0) mx = std::max(mx, std::fabs(v));
        for (double& v : u0) v *= 1.0e-4 / mx;
        const int    Nppc  = 48;                     // steps per period
        const double T1    = 1.0 / f1;
        const double dt    = T1 / Nppc;
        const int    steps = Nppc * 10;              // ~10 periods
        td::NewmarkIntegrator integ(K, M, 0.0, 0.0, dt, fixed);
        check(integ.ok(), "Newmark effective operator (M+βΔt²K)_ff factorises (SPD)");
        integ.setInitial(u0, {}, {});
        const int p = probeDof(modal.modes[0], fixed);
        std::vector<double> tt, xx;
        tt.push_back(0.0); xx.push_back(integ.dispAt(p));
        for (int s = 0; s < steps; ++s) { integ.step(); tt.push_back(integ.time()); xx.push_back(integ.dispAt(p)); }
        const double Tmeas = periodFromZeroCrossings(tt, xx);
        const double fMeas = 1.0 / Tmeas;
        const double err   = std::fabs(fMeas - f1) / f1;
        std::printf("    transient period = %.6e s ⇒ f = %.4f Hz   vs modal %.4f Hz   err = %.3f %% (tol 2%%)\n",
                    Tmeas, fMeas, f1, err * 100.0);
        check(err < 0.02, "cantilever free-vibration frequency = modal f1 within 2% (transient ↔ modal)");
    }

    // (b) AXIAL BAR (ν=0, lateral DOFs fixed): modal fundamental EQUALS the
    //     published bar-wave closed form f = c/(4L), c=√(E/ρ) — locking-free.
    {
        const double nu = 0.0, L = 1.0, bW = 0.05, hT = 0.05;
        const int Nx = 12;
        Beam beam = buildBeam(Nx, L, bW, hT);
        const std::size_t nDof = 3 * beam.mesh.nodes.size();
        la::MatrixD K, M;
        td::assembleKM(beam.mesh, E, nu, rho, K, M, /*lumpedMass=*/false);

        std::vector<char> fixed(nDof, 0);
        const std::size_t nN = beam.mesh.nodes.size();
        for (std::size_t n = 0; n < nN; ++n) {       // fix ALL transverse (y,z) ⇒ pure axial
            fixed[3*n + 1] = 1; fixed[3*n + 2] = 1;
        }
        for (int id : beam.xFace(0)) fixed[3*id + 0] = 1;   // clamp x at the wall

        td::ModalData modal = td::modalAnalysis(K, M, fixed, 2);
        check(modal.ok && !modal.freqHz.empty(), "axial-bar modal solve ok");
        const double f1   = modal.freqHz[0];
        const double c    = std::sqrt(E / rho);
        const double fAna = c / (4.0 * L);                  // fixed-free bar fundamental
        const double eAna = std::fabs(f1 - fAna) / fAna;
        std::printf("    axial bar  c=√(E/ρ)=%.1f m/s  modal f1 = %.3f Hz  vs analytic c/4L = %.3f Hz  err = %.3f %% (tol 3%%)\n",
                    c, f1, fAna, eAna * 100.0);
        check(eAna < 0.03, "axial modal fundamental = bar-wave c/(4L) within 3% (modal ↔ published analytic)");

        // transient seeded with the axial mode ↔ that same modal frequency.
        std::vector<double> u0 = modal.modes[0];
        double mx = 0; for (double v : u0) mx = std::max(mx, std::fabs(v));
        for (double& v : u0) v *= 1.0e-5 / mx;
        const int Nppc = 48; const double T1 = 1.0 / f1; const double dt = T1 / Nppc; const int steps = Nppc * 10;
        td::NewmarkIntegrator integ(K, M, 0.0, 0.0, dt, fixed);
        integ.setInitial(u0, {}, {});
        const int p = probeDof(modal.modes[0], fixed);
        std::vector<double> tt, xx; tt.push_back(0); xx.push_back(integ.dispAt(p));
        for (int s = 0; s < steps; ++s) { integ.step(); tt.push_back(integ.time()); xx.push_back(integ.dispAt(p)); }
        const double fMeas = 1.0 / periodFromZeroCrossings(tt, xx);
        const double err   = std::fabs(fMeas - f1) / f1;
        std::printf("    axial transient f = %.4f Hz  vs modal %.4f Hz  err = %.3f %% (tol 2%%)\n", fMeas, f1, err * 100.0);
        check(err < 0.02, "axial free-vibration frequency = modal f1 within 2% (transient ↔ modal ↔ analytic)");
    }
}

// ── Test 2 — damped decay log-decrement vs known modal ζ ──────────────────────
void test_damped_decay() {
    std::printf("[fea/transient_dynamics] Test 2 — Rayleigh-damped decay (log-decrement vs known ζ)\n");
    const double E = 2.1e11, rho = 7800.0, nu = 0.3, L = 1.0, bW = 0.06, hT = 0.04;
    const int Nx = 10;
    Beam beam = buildBeam(Nx, L, bW, hT);
    const std::size_t nDof = 3 * beam.mesh.nodes.size();
    la::MatrixD K, M;
    td::assembleKM(beam.mesh, E, nu, rho, K, M, false);
    std::vector<char> fixed(nDof, 0);
    for (int id : beam.xFace(0)) for (int d = 0; d < 3; ++d) fixed[3*id + d] = 1;

    td::ModalData modal = td::modalAnalysis(K, M, fixed, 1);
    const double w1 = modal.omega[0], f1 = modal.freqHz[0];

    // mass-proportional Rayleigh C = αM ⇒ ζ₁ = α/(2ω₁). Seeding the EXACT mode-1
    // keeps the response single-mode, so it decays as e^(−ζ₁ω₁t).
    const double zeta = 0.03;
    const double alpha = 2.0 * zeta * w1;
    std::vector<double> u0 = modal.modes[0];
    double mx = 0; for (double v : u0) mx = std::max(mx, std::fabs(v));
    for (double& v : u0) v *= 1.0e-4 / mx;

    const int Nppc = 64; const double T1 = 1.0 / f1; const double dt = T1 / Nppc; const int steps = Nppc * 12;
    td::NewmarkIntegrator integ(K, M, alpha, 0.0, dt, fixed);
    check(integ.ok(), "damped Newmark operator factorises");
    integ.setInitial(u0, {}, {});
    const int p = probeDof(modal.modes[0], fixed);
    std::vector<double> xx; xx.push_back(integ.dispAt(p));
    for (int s = 0; s < steps; ++s) { integ.step(); xx.push_back(integ.dispAt(p)); }

    const double dMeas  = logDecrement(xx);
    const double dTheo  = 2.0 * kPi * zeta / std::sqrt(1.0 - zeta * zeta);
    const double err    = std::fabs(dMeas - dTheo) / dTheo;
    std::printf("    ζ₁ = %.3f (α=%.4f, mass-proportional)  log-decrement: measured %.5f  vs theory 2πζ/√(1−ζ²)=%.5f  err=%.2f %% (tol 5%%)\n",
                zeta, alpha, dMeas, dTheo, err * 100.0);
    check(err < 0.05, "damped envelope log-decrement matches the known modal ζ within 5%");
}

// ── Test 3 — Newmark energy conservation + unconditional stability ────────────
void test_energy_and_stability() {
    std::printf("[fea/transient_dynamics] Test 3 — undamped energy conservation + large-Δt stability\n");
    const double E = 2.1e11, rho = 7800.0, nu = 0.3, L = 1.0, bW = 0.06, hT = 0.04;
    const int Nx = 10;
    Beam beam = buildBeam(Nx, L, bW, hT);
    const std::size_t nDof = 3 * beam.mesh.nodes.size();
    la::MatrixD K, M;
    td::assembleKM(beam.mesh, E, nu, rho, K, M, false);
    std::vector<char> fixed(nDof, 0);
    for (int id : beam.xFace(0)) for (int d = 0; d < 3; ++d) fixed[3*id + d] = 1;

    td::ModalData modal = td::modalAnalysis(K, M, fixed, 1);
    const double f1 = modal.freqHz[0];
    std::vector<double> u0 = modal.modes[0];
    double mx = 0; for (double v : u0) mx = std::max(mx, std::fabs(v));
    for (double& v : u0) v *= 1.0e-4 / mx;

    // 64 steps/period × 12 periods, undamped.
    const int Nppc = 64, nP = 12; const double T1 = 1.0 / f1; const double dt = T1 / Nppc; const int steps = Nppc * nP;
    td::NewmarkIntegrator integ(K, M, 0.0, 0.0, dt, fixed);
    integ.setInitial(u0, {}, {});
    const double E0 = integ.totalEnergy();
    double eMin = E0, eMax = E0, firstAvg = 0, lastAvg = 0;
    for (int s = 1; s <= steps; ++s) {
        integ.step();
        const double e = integ.totalEnergy();
        eMin = std::min(eMin, e); eMax = std::max(eMax, e);
        if (s <= Nppc) firstAvg += e;                 // mean over period 1
        if (s >  steps - Nppc) lastAvg += e;          // mean over the last period
    }
    firstAvg /= Nppc; lastAvg /= Nppc;
    const double ripple  = (eMax - eMin) / E0;
    const double secular = std::fabs(lastAvg - firstAvg) / E0;
    std::printf("    E0 = %.6e J   ripple (Emax−Emin)/E0 = %.3e   secular drift |ΔĒ|/E0 over %d steps = %.3e\n",
                E0, ripple, steps, secular);
    check(secular < 1.0e-3, "avg-acceleration Newmark: NO secular energy drift over many steps (<0.1%)");
    check(ripple  < 1.0e-2, "total energy stays within a tight band (<1%) — non-dissipative");

    // Large Δt (5× the period): unconditionally stable ⇒ bounded, finite.
    const double dtBig = 5.0 * T1;
    td::NewmarkIntegrator big(K, M, 0.0, 0.0, dtBig, fixed);
    big.setInitial(u0, {}, {});
    const double a0 = 1.0e-4;                         // seeded max |u|
    bool finiteAll = true, boundedAll = true;
    double peak = 0;
    for (int s = 0; s < 60; ++s) {
        big.step();
        for (double v : big.u()) { if (!std::isfinite(v)) finiteAll = false; peak = std::max(peak, std::fabs(v)); }
    }
    boundedAll = peak < 10.0 * a0;                    // energy ≤ initial ⇒ |u| can't grow unboundedly
    std::printf("    huge Δt = %.4e s (=5·T1):  max|u| over 60 steps = %.3e m (seed %.1e)  finite=%d bounded=%d\n",
                dtBig, peak, a0, finiteAll ? 1 : 0, boundedAll ? 1 : 0);
    check(finiteAll,  "no blow-up at huge Δt — every DOF finite (unconditional stability)");
    check(boundedAll, "huge-Δt response stays bounded by the initial amplitude (no growth)");
}

// ── Test 4 — static limit (slow ramp + light damping → staticSolve A/B) ───────
void test_static_limit() {
    std::printf("[fea/transient_dynamics] Test 4 — slowly-ramped load → static solution (A/B)\n");
    const double E = 2.1e11, rho = 7800.0, nu = 0.3, L = 1.0, bW = 0.06, hT = 0.04;
    const int Nx = 10;
    Beam beam = buildBeam(Nx, L, bW, hT);
    const std::size_t nDof = 3 * beam.mesh.nodes.size();
    la::MatrixD K, M;
    td::assembleKM(beam.mesh, E, nu, rho, K, M, false);
    std::vector<char> fixed(nDof, 0);
    for (int id : beam.xFace(0)) for (int d = 0; d < 3; ++d) fixed[3*id + d] = 1;

    // Tip transverse (z) load distributed over the 4 free-end nodes.
    std::vector<double> fFull(nDof, 0.0);
    const double Fz = 200.0;
    for (int id : beam.xFace(beam.Nx)) fFull[3*id + 2] += Fz / 4.0;

    std::vector<double> uStatic = td::staticSolve(K, fixed, fFull);

    td::ModalData modal = td::modalAnalysis(K, M, fixed, 1);
    const double f1 = modal.freqHz[0], T1 = 1.0 / f1;

    // ζ ≈ 0.1 mass-proportional to settle quickly; ramp 0→F over 15·T1, hold 15·T1.
    const double zeta = 0.10, alpha = 2.0 * zeta * modal.omega[0];
    const int Nppc = 40; const double dt = T1 / Nppc;
    const int rampSteps = Nppc * 15, holdSteps = Nppc * 15;
    td::NewmarkIntegrator integ(K, M, alpha, 0.0, dt, fixed);
    integ.setInitial({}, {}, {});
    for (int s = 1; s <= rampSteps + holdSteps; ++s) {
        const double scale = std::min(1.0, static_cast<double>(s) / rampSteps);
        std::vector<double> fL = fFull;
        for (double& v : fL) v *= scale;
        integ.stepWithLoad(fL);
    }
    const std::vector<double>& uDyn = integ.u();

    double num = 0, den = 0;
    for (std::size_t i = 0; i < nDof; ++i) { const double d = uDyn[i] - uStatic[i]; num += d*d; den += uStatic[i]*uStatic[i]; }
    const double rel = std::sqrt(num / den);
    const int tipDof = 3 * beam.nid(beam.Nx,1,1) + 2;
    std::printf("    tip w:  dynamic-settled = %.6e m   static = %.6e m   ||u_dyn−u_static||/||u_static|| = %.3e (tol 1.5%%)\n",
                uDyn[tipDof], uStatic[tipDof], rel);
    check(rel < 0.015, "slow-ramp transient settles onto the staticSolve(K) displacement (A/B)");
}

} // namespace

int main() {
    std::printf("==== native gate: forge::native::fea transient structural dynamics (M ü + C u̇ + K u = F) ====\n");
    test_freevib_vs_modal();
    test_damped_decay();
    test_energy_and_stability();
    test_static_limit();
    if (g_fail == 0) {
        std::printf("RESULT: ALL TRANSIENT-DYNAMICS GATES PASS (13 checks)\n");
        return 0;
    }
    std::printf("RESULT: %d TRANSIENT-DYNAMICS CHECK(S) FAILED\n", g_fail);
    return 1;
}
