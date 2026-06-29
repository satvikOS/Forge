// test/native/fea/transient_thermal_test.cpp
// ─────────────────────────────────────────────────────────────────────────────
// Native gate — TRANSIENT (time-dependent) heat conduction on the 8-node hex,
// validating forge/native/fea/TransientThermal.hpp against CLOSED-FORM answers.
// Extends the STEADY conduction operator (FeaExtras.cpp::solveThermal, element
// Laplacian K from ScalarElliptic.hpp) with the consistent thermal capacitance
// C = ∫ ρc N_iN_j dV and a backward-Euler / θ time integrator. Advances #62/#64
// (native transient thermal CAE). Pure C++ / no OCCT / no deps — a green gate
// here certifies the primitive the .node binding's solveTransientThermal
// forwards onto once relinked (batched elsewhere).
//
// Cases:
//   1) 1D semi-infinite slab, step surface temperature:  T(x,0)=T0, surface
//      held at Ts for t>0  ⇒  analytic  T(x,t) = Ts + (T0−Ts)·erf(x/(2√(αt))),
//      α = k/(ρc). Mesh a long bar, march in time, match the erf profile at
//      interior (x,t) within <2% (away from the truncated far end).
//   2) Steady-state limit:  marched far in time with fixed Dirichlet BCs, Tⁿ⁺¹
//      MUST converge to the STEADY operator's solution K T = F (the identical
//      element Laplacian solveThermal assembles) — relative <1e-4. Proves the
//      transient operator (C/Δt + K) is consistent with the steady one.
//   3) Large-Δt stability/monotonicity: backward Euler is unconditionally
//      stable — at a huge Δt the field stays bounded by the BC range (no
//      negative undershoot / overshoot) and approaches steady monotonically.
//   4) Neumann (surface heat-flux) known-answer:  cold Dirichlet end + constant
//      flux q'' into the hot end, insulated sides ⇒ steady T(x)=Tc+(q''/k)x;
//      validates the consistent faceFluxLoad and the flux→steady path.
//
// Units SI (m, s, K, W). α and Δt and sample points are printed for each gate.

#include "forge/native/fea/HexElement.hpp"
#include "forge/native/fea/ScalarElliptic.hpp"
#include "forge/native/fea/TransientThermal.hpp"
#include "forge/native/linalg/LinAlg.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <vector>

namespace tt  = forge::native::fea::transient_thermal;
namespace se  = forge::native::fea::scalar_elliptic;
namespace la  = forge::native::linalg;

namespace {

int g_fail = 0;
void check(bool ok, const char* msg) {
    std::printf("    [%s] %s\n", ok ? "PASS" : "FAIL", msg);
    if (!ok) ++g_fail;
}

// ── a 1D conduction bar: Nx hexes along x, 1 element thick in y,z (insulated
//    sides ⇒ pure 1D). Node (i,j,l): i∈[0,Nx] along x, j,l∈{0,1}. ───────────────
struct Bar {
    tt::HexMesh mesh;
    int Nx; double dx, a;
    int idx(int i, int j, int l) const { return i * 4 + j * 2 + l; }
    // the 4 node ids on the x=i-station face.
    std::array<int,4> xFace(int i) const {
        return { idx(i,0,0), idx(i,1,0), idx(i,0,1), idx(i,1,1) };
    }
};

Bar buildBar(int Nx, double Lx, double a) {
    Bar bar; bar.Nx = Nx; bar.dx = Lx / Nx; bar.a = a;
    bar.mesh.nodes.resize((Nx + 1) * 4);
    for (int i = 0; i <= Nx; ++i)
        for (int j = 0; j < 2; ++j)
            for (int l = 0; l < 2; ++l)
                bar.mesh.nodes[bar.idx(i,j,l)] = { i * bar.dx, j * a, l * a };
    for (int i = 0; i < Nx; ++i) {
        // canonical HexElement node order (ξ=x, η=y, ζ=z): det J > 0.
        bar.mesh.elems.push_back({
            bar.idx(i,  0,0), bar.idx(i+1,0,0), bar.idx(i+1,1,0), bar.idx(i,  1,0),
            bar.idx(i,  0,1), bar.idx(i+1,0,1), bar.idx(i+1,1,1), bar.idx(i,  1,1),
        });
    }
    return bar;
}

// Direct STEADY solve K T = F with Dirichlet partition — the SAME element
// Laplacian (scalar_elliptic::elementStiffness, via assembleKC) that
// solveThermal assembles, factored with the same dense SPD Cholesky. This is
// the reference the transient long-time limit must reproduce.
std::vector<double> steadySolve(const tt::HexMesh& m, double k,
                                const std::vector<char>& fixed,
                                const std::vector<double>& fixedVal,
                                const std::vector<double>& F) {
    const std::size_t n = m.nNodes();
    la::MatrixD K, C;
    tt::assembleKC(m, k, 1.0, K, C, /*lumped*/false);  // C unused for steady
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
    std::vector<double> T(n);
    for (std::size_t i = 0; i < n; ++i) T[i] = fixed[i] ? fixedVal[i] : 0.0;
    for (std::size_t a = 0; a < nf; ++a) T[freeI[a]] = xf[a];
    return T;
}

// ── Test 1 — semi-infinite slab erf profile ──────────────────────────────────
void test_erf_semiinfinite() {
    std::printf("[fea/transient_thermal] Test 1 — semi-infinite slab erf(x/2√(αt))\n");
    const double k = 40.0, rhoC = 4.0e5;     // α = k/ρc
    const double alpha = k / rhoC;           // = 1e-4 m²/s
    const double Lx = 0.20, a = 0.01;
    const int    Nx = 80;                    // dx = 2.5 mm
    const double Ts = 100.0, T0 = 0.0;
    const double dt = 0.03125; const int nSteps = 200;
    const double tEnd = dt * nSteps;         // 6.25 s
    Bar bar = buildBar(Nx, Lx, a);
    const std::size_t n = bar.mesh.nNodes();

    la::MatrixD K, C;
    tt::assembleKC(bar.mesh, k, rhoC, K, C, /*lumped*/false);

    // Dirichlet: x=0 face held at Ts; x=Lx face pinned at T0 (semi-infinite
    // far-field T→T0, valid while the front hasn't reached the truncated end).
    std::vector<char>   fixed(n, 0);
    std::vector<double> fval(n, 0.0);
    for (int id : bar.xFace(0))      { fixed[id] = 1; fval[id] = Ts; }
    for (int id : bar.xFace(bar.Nx)) { fixed[id] = 1; fval[id] = T0; }

    tt::ThetaThermalIntegrator integ(K, C, dt, fixed, fval, /*theta=*/1.0);
    check(integ.ok(), "backward-Euler operator (C/Δt+K)_ff factorises (SPD)");

    // IC: uniform T0 (surface included — it jumps to Ts at the first step).
    std::vector<double> T(n, T0), F(n, 0.0);
    T = integ.march(T, F, nSteps);

    const double diff = 2.0 * std::sqrt(alpha * tEnd);  // 2√(αt) = 0.05 m
    std::printf("    α = k/ρc = %.3e m²/s,  Δt = %.5f s,  t = %.3f s,  2√(αt) = %.4f m,  Lx = %.2f m\n",
                alpha, dt, tEnd, diff, Lx);
    const double xs[3] = {0.01, 0.02, 0.03};            // 4,8,12 dx into the bar
    double eMax = 0.0;
    for (double x : xs) {
        const int i = static_cast<int>(std::lround(x / bar.dx));
        const double Tnum = T[bar.idx(i, 0, 0)];
        const double Tana = Ts + (T0 - Ts) * std::erf(x / diff);
        const double rel  = std::fabs(Tnum - Tana) / std::fabs(Ts - T0);
        eMax = std::max(eMax, rel);
        std::printf("    x=%.3f m  T_num=%8.4f  T_erf=%8.4f  |Δ|/(Ts-T0)=%.3f %%\n",
                    x, Tnum, Tana, rel * 100.0);
    }
    std::printf("    max error vs erf closed form = %.3f %%  (tol 2%%)\n", eMax * 100.0);
    check(eMax < 0.02, "transient T(x,t) matches semi-infinite erf within 2%");

    // monotone in x (front), and far end essentially undisturbed (semi-infinite).
    bool mono = true;
    for (int i = 0; i < bar.Nx; ++i)
        if (T[bar.idx(i,0,0)] < T[bar.idx(i+1,0,0)] - 1e-9) mono = false;
    check(mono, "profile monotonically decreasing from the heated surface");
    const double farRise = std::fabs(T[bar.idx(bar.Nx - 4, 0, 0)] - T0);
    check(farRise < 0.02 * (Ts - T0), "far end still near T0 (semi-infinite valid)");
}

// ── Test 2 — steady-state limit (transient → steady operator, A/B) ────────────
void test_steady_limit() {
    std::printf("[fea/transient_thermal] Test 2 — steady-state limit vs steady solveThermal operator\n");
    const double k = 40.0, rhoC = 4.0e5;
    const double Lx = 0.20, a = 0.01; const int Nx = 40;
    const double Ts = 100.0, Tc = 20.0;
    Bar bar = buildBar(Nx, Lx, a);
    const std::size_t n = bar.mesh.nNodes();

    la::MatrixD K, C;
    tt::assembleKC(bar.mesh, k, rhoC, K, C, /*lumped*/false);
    std::vector<char>   fixed(n, 0);
    std::vector<double> fval(n, 0.0);
    for (int id : bar.xFace(0))      { fixed[id] = 1; fval[id] = Ts; }
    for (int id : bar.xFace(bar.Nx)) { fixed[id] = 1; fval[id] = Tc; }
    std::vector<double> F(n, 0.0);

    // Reference: direct steady K T = F (same element Laplacian as solveThermal).
    std::vector<double> Tsteady = steadySolve(bar.mesh, k, fixed, fval, F);

    // Transient marched far in time (large Δt) until the increment is negligible.
    const double dt = 5.0;
    tt::ThetaThermalIntegrator integ(K, C, dt, fixed, fval, /*theta=*/1.0);
    std::vector<double> T(n, 50.0);  // arbitrary IC away from the answer
    double incr = 0.0;
    int steps = 0;
    for (; steps < 500; ++steps) {
        std::vector<double> Tn1 = integ.step(T, F);
        incr = 0.0;
        for (std::size_t i = 0; i < n; ++i) incr = std::max(incr, std::fabs(Tn1[i] - T[i]));
        T = Tn1;
        if (incr < 1e-13) { ++steps; break; }
    }
    // relative L2 difference to the steady reference.
    double num = 0.0, den = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const double d = T[i] - Tsteady[i];
        num += d * d; den += Tsteady[i] * Tsteady[i];
    }
    const double rel = std::sqrt(num / den);
    std::printf("    marched %d steps (Δt=%.1f s), final per-step increment = %.2e\n", steps, dt, incr);
    std::printf("    ||T_transient − T_steady|| / ||T_steady|| = %.3e  (tol 1e-4)\n", rel);
    check(rel < 1e-4, "long-time transient field equals the STEADY operator (A/B)");
}

// ── Test 3 — large-Δt unconditional stability / monotonicity ─────────────────
void test_large_dt_stability() {
    std::printf("[fea/transient_thermal] Test 3 — large-Δt stability (no undershoot/blow-up)\n");
    const double k = 40.0, rhoC = 4.0e5;
    const double Lx = 0.20, a = 0.01; const int Nx = 40;
    const double Ts = 100.0, T0 = 0.0;
    Bar bar = buildBar(Nx, Lx, a);
    const std::size_t n = bar.mesh.nNodes();

    la::MatrixD K, C;
    tt::assembleKC(bar.mesh, k, rhoC, K, C, /*lumped*/false);
    std::vector<char>   fixed(n, 0);
    std::vector<double> fval(n, 0.0);
    for (int id : bar.xFace(0))      { fixed[id] = 1; fval[id] = Ts; }
    for (int id : bar.xFace(bar.Nx)) { fixed[id] = 1; fval[id] = T0; }
    std::vector<double> F(n, 0.0);

    const double dt = 1.0e6;   // αΔt/dx² ≈ 4.3e9 — explicit would explode
    tt::ThetaThermalIntegrator integ(K, C, dt, fixed, fval, /*theta=*/1.0);
    std::vector<double> T(n, T0);
    std::printf("    Δt = %.1e s  (huge — backward Euler must stay bounded & monotone)\n", dt);
    bool boundedAll = true, monoAll = true, finiteAll = true;
    std::vector<double> prev = T;
    for (int s = 0; s < 6; ++s) {
        T = integ.step(T, F);
        for (std::size_t i = 0; i < n; ++i) {
            if (!std::isfinite(T[i])) finiteAll = false;
            if (T[i] < T0 - 1e-9 || T[i] > Ts + 1e-9) boundedAll = false;  // no under/overshoot
            if (T[i] < prev[i] - 1e-9) monoAll = false;                     // monotone heating
        }
        prev = T;
    }
    double tmin = *std::min_element(T.begin(), T.end());
    double tmax = *std::max_element(T.begin(), T.end());
    std::printf("    after 6 steps:  min T = %.4f, max T = %.4f  (BC range [%.0f, %.0f])\n",
                tmin, tmax, T0, Ts);
    check(finiteAll,  "no blow-up — every nodal temperature finite at huge Δt");
    check(boundedAll, "no undershoot/overshoot — field stays within the BC range");
    check(monoAll,    "monotone approach to steady (no oscillation)");
}

// ── Test 4 — Neumann surface flux known-answer (linear profile) ──────────────
void test_neumann_flux() {
    std::printf("[fea/transient_thermal] Test 4 — Neumann flux: steady T(x)=Tc+(q''/k)x\n");
    const double k = 40.0, rhoC = 4.0e5;
    const double Lx = 0.20, a = 0.01; const int Nx = 40;
    const double Tc = 20.0, qflux = 5000.0;   // W/m² into the hot (+x) end
    Bar bar = buildBar(Nx, Lx, a);
    const std::size_t n = bar.mesh.nNodes();

    la::MatrixD K, C;
    tt::assembleKC(bar.mesh, k, rhoC, K, C, /*lumped*/false);
    std::vector<char>   fixed(n, 0);
    std::vector<double> fval(n, 0.0);
    for (int id : bar.xFace(0)) { fixed[id] = 1; fval[id] = Tc; }   // cold end only

    // Consistent Neumann load on the +x boundary face of the last element.
    std::vector<double> F(n, 0.0);
    {
        const auto& e = bar.mesh.elems.back();
        double X[8][3];
        for (int i = 0; i < 8; ++i) {
            const auto& nd = bar.mesh.nodes[e[i]];
            X[i][0]=nd[0]; X[i][1]=nd[1]; X[i][2]=nd[2];
        }
        double fe[8] = {0,0,0,0,0,0,0,0};
        tt::faceFluxLoad(X, tt::kHexFaces[1], qflux, fe);  // face +x
        for (int i = 0; i < 8; ++i) F[e[i]] += fe[i];
    }
    // total injected power must equal q'' · A_face (area = a×a).
    double Ftot = 0; for (double v : F) Ftot += v;
    const double Aface = a * a;
    std::printf("    Σ F = %.4f W  vs  q''·A = %.4f W  (consistent flux load)\n", Ftot, qflux * Aface);
    check(std::fabs(Ftot - qflux * Aface) < 1e-9 * qflux * Aface,
          "consistent face-flux load conserves total injected power");

    // (a) the flux load through the STEADY operator must reproduce the exact
    //     linear closed form T(x)=Tc+(q''/k)x (linear elements are nodally exact
    //     for a linear field) — the Neumann known-answer, isolated from time march.
    const double Tend = Tc + (qflux / k) * Lx;
    std::vector<double> Tsteady = steadySolve(bar.mesh, k, fixed, fval, F);
    double eAna = 0;
    for (int i = 0; i <= bar.Nx; ++i)
        eAna = std::max(eAna, std::fabs(Tsteady[bar.idx(i,0,0)] - (Tc + (qflux / k) * i * bar.dx)));
    std::printf("    steady FE: T(0)=%.6f  T(Lx)=%.6f (analytic %.6f),  max|Δ_analytic| = %.3e K\n",
                Tsteady[bar.idx(0,0,0)], Tsteady[bar.idx(bar.Nx,0,0)], Tend, eAna);
    check(eAna < 1e-9 * Tend, "consistent face-flux + steady operator = exact linear T(x)=Tc+(q''/k)x");

    // (b) the TRANSIENT (IC=Tc) marched with the flux BC must converge to that
    //     steady field — relative <1e-4.
    const double dt = 5.0;
    tt::ThetaThermalIntegrator integ(K, C, dt, fixed, fval, /*theta=*/1.0);
    std::vector<double> T(n, Tc);
    int steps = 0;
    for (; steps < 2000; ++steps) {
        std::vector<double> Tn1 = integ.step(T, F);
        double incr = 0; for (std::size_t i = 0; i < n; ++i) incr = std::max(incr, std::fabs(Tn1[i]-T[i]));
        T = Tn1;
        if (incr < 1e-12) { ++steps; break; }
    }
    double num = 0, den = 0;
    for (std::size_t i = 0; i < n; ++i) { const double d = T[i]-Tsteady[i]; num += d*d; den += Tsteady[i]*Tsteady[i]; }
    const double rel = std::sqrt(num / den);
    std::printf("    transient→steady in %d steps: T(Lx)=%.6f,  ||T_trans−T_steady||/||T_steady|| = %.3e\n",
                steps, T[bar.idx(bar.Nx,0,0)], rel);
    check(rel < 1e-4, "transient with flux BC converges to the steady flux solution");
}

} // namespace

int main() {
    std::printf("==== native gate: forge::native::fea transient thermal (ρc ∂T/∂t = k∇²T + Q) ====\n");
    test_erf_semiinfinite();
    test_steady_limit();
    test_large_dt_stability();
    test_neumann_flux();
    if (g_fail == 0) {
        std::printf("RESULT: ALL TRANSIENT-THERMAL GATES PASS (11 checks)\n");
        return 0;
    }
    std::printf("RESULT: %d TRANSIENT-THERMAL CHECK(S) FAILED\n", g_fail);
    return 1;
}
