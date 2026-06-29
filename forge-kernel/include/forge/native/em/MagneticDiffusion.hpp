// forge-kernel — transient eddy-current / magnetic diffusion (skin effect), E4
//
// Solves the magnetic-diffusion equation for the flux density B in a conductor
// exposed to a time-varying surface field
//
//     ∂B/∂t = (1/(μσ)) ∇²B        ⇔        σ ∂B/∂t = (1/μ) ∇²B .
//
// This is the SAME parabolic operator the transient-thermal solver assembles
// (ρc ∂T/∂t = ∇·(k∇T)), under the EM substitution
//
//     conductance  k  := ν = 1/μ        (reluctivity, the E1 magnetostatic coeff)
//     capacitance  ρc := σ              (electrical conductivity, the E3 coeff)
//     diffusivity  α  := k/ρc = 1/(μσ)
//
// so it REUSES forge::native::fea::transient_thermal verbatim — assembleKC for
// the conductance K = ∫ ν ∇N_i·∇N_j and the consistent capacitance C = ∫ σ N_iN_j,
// and the backward-Euler ThetaThermalIntegrator (A = C/Δt + K factored ONCE with
// the dense SPD Cholesky, factor-once / solve-many). The ONLY new ingredient is a
// TIME-VARYING Dirichlet surface BC B(0,t)=B0·cos(ωt), applied each step through
// ThetaThermalIntegrator::stepBC (the integrator's ONE factorisation is reused —
// the lift depends on the BC value, not on the factor). NO new Laplacian, NO new
// time integrator, NO new factorisation are re-derived here.
//
// Known answer (semi-infinite conductor, sinusoidal surface field):
//     B(x,t) ≈ B0 · e^{−x/δ} · cos(ωt − x/δ),   skin depth δ = √(2/(μσω)),
// i.e. the amplitude envelope decays as e^{−x/δ} AND the phase lags by x/δ.
// solveSkinEffect marches to sinusoidal steady state, recovers the amplitude
// A(x) and the phase-lag φ(x) at sample depths by a one-period Fourier
// projection, and fits the skin depth from BOTH the amplitude decay
// (−ln(A/B0) = x/δ) and the phase gradient (φ = x/δ).
//
// Pure C++ / header-only / no OCCT / no deps. The native gate
// test/native/em/magnetic_diffusion_test.cpp validates δ (amplitude + phase)
// against the analytic skin depth and cross-checks the DC-step march against the
// erf/erfc diffusion profile (proving α = 1/(μσ)) and the long-time DC steady
// limit (the operator collapses to the Laplace/magnetostatic curl-curl form).
// Emag.cpp::magneticDiffusion forwards the .node path onto solveSkinEffect.

#pragma once

#include "forge/native/fea/TransientThermal.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <vector>

namespace forge::native::em {

namespace tt = forge::native::fea::transient_thermal;

// Analytic skin depth δ = √(2/(μσω)) (m).
inline double skinDepth(double mu, double sigma, double omega) {
    return std::sqrt(2.0 / (mu * sigma * omega));
}

// ---------------------------------------------------------------------------
// 1-D conductor "bar" along the penetration depth x ∈ [0, L]: N hexes along x,
// ONE element thick in y and z (the four transverse faces carry no flux ⇒ a pure
// 1-D field). Node (i,j,l): i∈[0,N] along x, j,l∈{0,1}. The two transverse layers
// make each x-station a 4-node face tied to one physical depth — the SAME 1-D bar
// the transient-thermal erf gate uses, so the 3-D hex math (HexElement) is reused
// with no 1-D shape-function re-derivation.
struct DiffusionBar {
    tt::HexMesh mesh;
    int    N  = 0;
    double L  = 0.0, dx = 0.0;
    int idx(int i, int j, int l) const { return i * 4 + j * 2 + l; }
    int node(int i) const { return idx(i, 0, 0); }              // the x=i-station dof
    std::array<int, 4> xFace(int i) const {                     // its 4 face nodes
        return { idx(i, 0, 0), idx(i, 1, 0), idx(i, 0, 1), idx(i, 1, 1) };
    }
};

inline DiffusionBar buildBar(int N, double L, double a = 1e-3) {
    DiffusionBar bar;
    bar.N = N; bar.L = L; bar.dx = L / N;
    bar.mesh.nodes.resize(static_cast<std::size_t>(N + 1) * 4);
    for (int i = 0; i <= N; ++i)
        for (int j = 0; j < 2; ++j)
            for (int l = 0; l < 2; ++l)
                bar.mesh.nodes[bar.idx(i, j, l)] = { i * bar.dx, j * a, l * a };
    for (int i = 0; i < N; ++i)
        bar.mesh.elems.push_back({                  // canonical HexElement order
            bar.idx(i,   0, 0), bar.idx(i+1, 0, 0), bar.idx(i+1, 1, 0), bar.idx(i,   1, 0),
            bar.idx(i,   0, 1), bar.idx(i+1, 0, 1), bar.idx(i+1, 1, 1), bar.idx(i,   1, 1),
        });
    return bar;
}

// ---------------------------------------------------------------------------
struct SkinEffectConfig {
    double L     = 0.0;        // conductor depth modelled (m); ≤0 ⇒ default 8δ
    int    N     = 80;         // elements through the depth
    double mu    = 1.25663706143591729e-6; // permeability (default μ₀)
    double sigma = 5.8e7;      // electrical conductivity (S/m) (default copper)
    double omega = 2.0 * 3.14159265358979323846 * 1000.0; // surface field ω (rad/s)
    double B0    = 1.0;        // surface field amplitude (T)
    int    stepsPerPeriod  = 160;  // backward-Euler steps per AC period
    int    periodsToSteady = 20;   // periods marched to sinusoidal steady state
};

struct SkinEffectResult {
    double delta      = 0.0;   // analytic δ = √(2/(μσω))
    double deltaAmp   = 0.0;   // δ fitted from the amplitude decay −ln(A/B0)=x/δ
    double deltaPhase = 0.0;   // δ fitted from the phase lag φ=x/δ
    double dt = 0.0; int nSteps = 0;
    std::vector<double> depth;            // sample depths x (m)
    std::vector<double> ampNum, ampAna;   // |B|(x): measured / analytic B0 e^{−x/δ}
    std::vector<double> phaseNum, phaseAna; // phase lag (rad): measured / analytic x/δ
    bool ok = false;          // backward-Euler operator factorised (SPD)
};

// Solve the sinusoidal-steady skin-effect problem and recover δ from amplitude &
// phase. Reuses transient_thermal::assembleKC (k=ν=1/μ, ρc=σ) and the
// backward-Euler ThetaThermalIntegrator with a time-varying surface BC (stepBC).
inline SkinEffectResult solveSkinEffect(const SkinEffectConfig& cfgIn) {
    constexpr double kPi = 3.14159265358979323846;
    SkinEffectConfig cfg = cfgIn;
    const double nu    = 1.0 / cfg.mu;                   // reluctivity ν = conductance k
    const double delta = skinDepth(cfg.mu, cfg.sigma, cfg.omega);
    if (cfg.L <= 0.0) cfg.L = 8.0 * delta;              // default 8 skin depths deep

    SkinEffectResult R;
    R.delta = delta;

    DiffusionBar bar = buildBar(cfg.N, cfg.L);
    const std::size_t n = bar.mesh.nNodes();

    // K = ∫ ν ∇N∇N (conductance), C = ∫ σ NN (consistent capacitance) — the
    // SAME element Laplacian + consistent mass the transient-thermal path builds.
    tt::MatrixD K, C;
    tt::assembleKC(bar.mesh, /*k=*/nu, /*rhoC=*/cfg.sigma, K, C, /*lumped=*/false,
                   "forge::native::em::magneticDiffusion");

    // Dirichlet: x=0 face is the AC surface (value set each step); x=L truncation 0.
    std::vector<char>   fixed(n, 0);
    std::vector<double> fval(n, 0.0);                   // far-field & seed values
    for (int id : bar.xFace(0))     fixed[id] = 1;      // surface (time-varying)
    for (int id : bar.xFace(bar.N)) fixed[id] = 1;      // far end B=0

    const double Tperiod = 2.0 * kPi / cfg.omega;
    const double dt      = Tperiod / cfg.stepsPerPeriod;
    R.dt = dt;
    tt::ThetaThermalIntegrator integ(K, C, dt, fixed, fval, /*theta=*/1.0);
    R.ok = integ.ok();
    if (!R.ok) return R;

    // Time-varying surface BC value g(t) = B0·cos(ωt) on the x=0 face, 0 on x=L.
    auto bcAt = [&](double t) {
        std::vector<double> v(n, 0.0);
        const double g = cfg.B0 * std::cos(cfg.omega * t);
        for (int id : bar.xFace(0)) v[id] = g;
        return v;
    };

    const std::vector<double> F(n, 0.0);
    // IC: interior 0, surface at g(0)=B0, far end 0.
    std::vector<double> B = bcAt(0.0);
    for (std::size_t i = 0; i < n; ++i)
        if (!fixed[i]) B[i] = 0.0;

    // March to sinusoidal steady state (transient modes decay ~ exp(−t/τ),
    // τ₁ = L²/(π²α) ≈ 2 periods for L=8δ; periodsToSteady periods ⇒ fully decayed).
    int nSteady = cfg.periodsToSteady * cfg.stepsPerPeriod;
    double t = 0.0;
    for (int s = 0; s < nSteady; ++s) {
        t += dt;
        B = integ.stepBC(B, F, bcAt(t));               // ONE factorisation reused
    }

    // Sample depths at {0.5,1,1.5,2,2.5,3}·δ (interior, away from the truncation),
    // snapped to nodes. Phase lag stays < π there so no unwrapping is needed.
    const double fracs[6] = {0.5, 1.0, 1.5, 2.0, 2.5, 3.0};
    std::vector<int> sIdx;
    for (double f : fracs) {
        int i = static_cast<int>(std::lround(f * delta / bar.dx));
        if (i >= 1 && i <= bar.N - 1) sIdx.push_back(i);
    }
    const std::size_t ns = sIdx.size();
    std::vector<double> cAcc(ns, 0.0), sAcc(ns, 0.0);   // Fourier projection accums

    // Measure over exactly one more period: project each sample onto cos/sin.
    const int P = cfg.stepsPerPeriod;
    for (int m = 0; m < P; ++m) {
        t += dt;
        B = integ.stepBC(B, F, bcAt(t));
        const double c = std::cos(cfg.omega * t), s = std::sin(cfg.omega * t);
        for (std::size_t q = 0; q < ns; ++q) {
            const double Bx = B[bar.node(sIdx[q])];
            cAcc[q] += Bx * c;
            sAcc[q] += Bx * s;
        }
    }
    R.nSteps = nSteady + P;

    // A(x) = √(a_cos²+a_sin²),  φ(x) = atan2(a_sin,a_cos)  with a_{cos,sin}=2/P·Σ…
    // (B = A cos(ωt−φ) = A[cosωt cosφ + sinωt sinφ] ⇒ a_cos=A cosφ, a_sin=A sinφ.)
    double Sxx = 0.0, SxyAmp = 0.0, SxyPh = 0.0;        // through-origin regressions
    for (std::size_t q = 0; q < ns; ++q) {
        const double aCos = (2.0 / P) * cAcc[q], aSin = (2.0 / P) * sAcc[q];
        const double A   = std::sqrt(aCos * aCos + aSin * aSin);
        const double phi = std::atan2(aSin, aCos);      // phase lag ≥ 0
        const double x   = sIdx[q] * bar.dx;
        R.depth.push_back(x);
        R.ampNum.push_back(A);
        R.ampAna.push_back(cfg.B0 * std::exp(-x / delta));
        R.phaseNum.push_back(phi);
        R.phaseAna.push_back(x / delta);
        // δ fits: y = x/δ. Amplitude: y = −ln(A/B0). Phase: y = φ. slope = Σxy/Σxx.
        Sxx    += x * x;
        SxyAmp += x * (-std::log(A / cfg.B0));
        SxyPh  += x * phi;
    }
    R.deltaAmp   = (SxyAmp > 0.0) ? Sxx / SxyAmp : 0.0; // δ = 1/slope = Σxx/Σxy
    R.deltaPhase = (SxyPh  > 0.0) ? Sxx / SxyPh  : 0.0;
    return R;
}

} // namespace forge::native::em
