#include "forge/CfdCompressible.hpp"

// ---------------------------------------------------------------------------
// Native 1D compressible Euler solver — Forge CFD task #63 (SU2-track C0).
//
//   ∂U/∂t + ∂F(U)/∂x = 0,        U = (ρ, ρu, ρE),
//   F(U) = (ρu, ρu² + p, u(ρE + p)),     p = (γ−1)(ρE − ½ρu²).
//
// Finite-volume, cell-centred, uniform mesh. The interface flux is the Roe
// approximate Riemann solver (Roe 1981) with the Harten–Hyman entropy fix
// (Harten & Hyman 1983) on the eigenvalue magnitudes — a genuine linearised
// Riemann solver, NOT a Lax-Friedrichs / Rusanov central scheme. Optional
// 2nd-order TVD MUSCL reconstruction of the primitive variables (van Leer
// limiter). Time integration is the SSP-RK2 (Shu–Osher) scheme with a
// CFL-limited time step. Transmissive (zero-gradient) outflow boundaries.
//
// References:
//   P. L. Roe, "Approximate Riemann Solvers, Parameter Vectors, and
//     Difference Schemes", J. Comput. Phys. 43 (1981) 357–372.
//   A. Harten, J. M. Hyman, "Self Adjusting Grid Methods for One-Dimensional
//     Hyperbolic Conservation Laws", J. Comput. Phys. 50 (1983) 235–269.
//   E. F. Toro, "Riemann Solvers and Numerical Methods for Fluid Dynamics",
//     3rd ed., Springer (2009) — Ch. 11 (Roe) & Ch. 13 (entropy fix, MUSCL).
// ---------------------------------------------------------------------------

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace forge::cfd {

namespace {

using Vec3 = std::array<double, 3>; // conservative state (ρ, ρu, ρE)

constexpr double kTiny = 1e-30;

// ---- primitive <-> conservative -------------------------------------------
inline Vec3 primToCons(double rho, double u, double p, double g) {
    const double rhoE = p / (g - 1.0) + 0.5 * rho * u * u; // = ρE
    return {rho, rho * u, rhoE};
}

inline void consToPrim(const Vec3& U, double g,
                       double& rho, double& u, double& p) {
    rho = U[0];
    u   = U[1] / rho;
    p   = (g - 1.0) * (U[2] - 0.5 * rho * u * u);
}

inline double soundSpeed(double rho, double p, double g) {
    return std::sqrt(g * std::max(p, kTiny) / std::max(rho, kTiny));
}

// physical flux from a conservative state
inline Vec3 physFlux(const Vec3& U, double g) {
    double rho, u, p;
    consToPrim(U, g, rho, u, p);
    const double rhoE = U[2];
    return {rho * u, rho * u * u + p, u * (rhoE + p)};
}

// ---- Roe approximate Riemann flux with Harten–Hyman entropy fix -----------
//
// Returns the numerical flux  F̂ = ½(F_L + F_R) − ½ Σ_k α_k |λ̃_k| K_k ,
// where (λ̃_k, K_k) are the eigenpairs of the Roe-averaged Jacobian and α_k
// the wave strengths from the projection of (U_R − U_L) onto K_k.
Vec3 roeFlux(const Vec3& UL, const Vec3& UR, double g) {
    double rhoL, uL, pL, rhoR, uR, pR;
    consToPrim(UL, g, rhoL, uL, pL);
    consToPrim(UR, g, rhoR, uR, pR);

    const double aL = soundSpeed(rhoL, pL, g);
    const double aR = soundSpeed(rhoR, pR, g);
    const double HL = (UL[2] + pL) / rhoL; // total specific enthalpy
    const double HR = (UR[2] + pR) / rhoR;

    const Vec3 FL = physFlux(UL, g);
    const Vec3 FR = physFlux(UR, g);

    // Roe averages (density-weighted by √ρ)
    const double srL = std::sqrt(rhoL), srR = std::sqrt(rhoR);
    const double inv = 1.0 / (srL + srR);
    const double uH  = (srL * uL + srR * uR) * inv;
    const double HH  = (srL * HL + srR * HR) * inv;
    const double rhoH = srL * srR;
    double a2 = (g - 1.0) * (HH - 0.5 * uH * uH);
    if (a2 < kTiny) a2 = kTiny;
    const double aH = std::sqrt(a2);

    // Roe eigenvalues
    double l1 = uH - aH;
    double l2 = uH;
    double l3 = uH + aH;

    // wave strengths from the jump (U_R − U_L) expressed in primitive jumps
    const double dRho = rhoR - rhoL;
    const double dU   = uR - uL;
    const double dP   = pR - pL;
    const double alpha1 = (dP - rhoH * aH * dU) / (2.0 * a2);
    const double alpha2 = dRho - dP / a2;
    const double alpha3 = (dP + rhoH * aH * dU) / (2.0 * a2);

    // right eigenvectors
    const Vec3 K1 = {1.0, uH - aH, HH - uH * aH};
    const Vec3 K2 = {1.0, uH, 0.5 * uH * uH};
    const Vec3 K3 = {1.0, uH + aH, HH + uH * aH};

    // Harten–Hyman entropy fix on the eigenvalue magnitudes.
    // For wave k bounded by states L/R, δ = max(0, λ̃−λ^L, λ^R−λ̃); if the Roe
    // eigenvalue magnitude is below δ (a transonic field, e.g. inside a
    // rarefaction straddling a sonic point), it is replaced by δ. In a
    // compression (shock) δ collapses to 0, so shocks keep their sharp Roe
    // upwinding. This removes the entropy-violating expansion shock.
    auto hh = [](double lam, double lamL, double lamR) {
        const double d = std::max(0.0, std::max(lam - lamL, lamR - lam));
        const double a = std::fabs(lam);
        return a < d ? d : a;
    };
    const double L1 = hh(l1, uL - aL, uR - aR);
    const double L2 = hh(l2, uL, uR);
    const double L3 = hh(l3, uL + aL, uR + aR);

    Vec3 F;
    for (int k = 0; k < 3; ++k) {
        const double diss =
            alpha1 * L1 * K1[k] + alpha2 * L2 * K2[k] + alpha3 * L3 * K3[k];
        F[k] = 0.5 * (FL[k] + FR[k]) - 0.5 * diss;
    }
    return F;
}

// van Leer limited slope (TVD). a = backward diff, b = forward diff.
inline double vanLeerSlope(double a, double b) {
    const double prod = a * b;
    if (prod <= 0.0) return 0.0;                 // extremum: clip to first order
    return 2.0 * prod / (a + b);                 // harmonic mean (van Leer)
}

} // namespace

// ---------------------------------------------------------------------------
Compressible1DResult solveCompressible1D(const Compressible1DConfig& cfg) {
    if (cfg.N < 2)
        throw std::invalid_argument("forge.cfd.solveCompressible1D: N must be >= 2");
    if (cfg.xR <= cfg.xL)
        throw std::invalid_argument("forge.cfd.solveCompressible1D: require xR > xL");
    if (cfg.gamma <= 1.0)
        throw std::invalid_argument("forge.cfd.solveCompressible1D: require gamma > 1");
    if (cfg.tEnd < 0.0)
        throw std::invalid_argument("forge.cfd.solveCompressible1D: tEnd must be >= 0");
    if (cfg.cfl <= 0.0 || cfg.cfl > 1.0)
        throw std::invalid_argument("forge.cfd.solveCompressible1D: cfl must be in (0,1]");
    const int order = (cfg.order >= 2) ? 2 : 1;

    const auto t0 = std::chrono::high_resolution_clock::now();

    const int    N  = cfg.N;
    const double g  = cfg.gamma;
    const double dx = (cfg.xR - cfg.xL) / N;
    const int    ng = 2;            // ghost layers (2 for MUSCL stencils)
    const int    Nt = N + 2 * ng;   // total incl. ghosts

    std::vector<Vec3> U(Nt);
    // initial condition: left/right primitive states split at x0
    for (int i = 0; i < N; ++i) {
        const double xc = cfg.xL + (i + 0.5) * dx;
        U[i + ng] = (xc < cfg.x0)
                        ? primToCons(cfg.rhoL, cfg.uL, cfg.pL, g)
                        : primToCons(cfg.rhoR, cfg.uR, cfg.pR, g);
    }

    // transmissive / outflow boundaries: copy nearest interior cell (zero grad)
    auto applyBC = [&](std::vector<Vec3>& Q) {
        for (int k = 0; k < ng; ++k) {
            Q[k]              = Q[ng];
            Q[Nt - 1 - k]     = Q[Nt - 1 - ng];
        }
    };
    applyBC(U);

    // R(U): the spatial residual  −(1/Δx)(F̂_{i+½} − F̂_{i−½}) on interior cells.
    std::vector<Vec3> Fhat(Nt + 1);
    auto computeRHS = [&](const std::vector<Vec3>& Q, std::vector<Vec3>& R) {
        // Per-cell limited primitive slopes (only needed for order==2).
        // slope[i] = (dρ, du, dp) limited central-ish slope of cell i.
        static thread_local std::vector<std::array<double, 3>> slope;
        if (order == 2) {
            slope.assign(Nt, {0.0, 0.0, 0.0});
            for (int i = 1; i < Nt - 1; ++i) {
                double rm, um, pm, rc, uc, pc, rp, up, pp;
                consToPrim(Q[i - 1], g, rm, um, pm);
                consToPrim(Q[i],     g, rc, uc, pc);
                consToPrim(Q[i + 1], g, rp, up, pp);
                slope[i][0] = vanLeerSlope(rc - rm, rp - rc);
                slope[i][1] = vanLeerSlope(uc - um, up - uc);
                slope[i][2] = vanLeerSlope(pc - pm, pp - pc);
            }
        }

        // reconstruct face states and evaluate the Roe flux at every interface
        // bounding the interior cells (faces j = ng .. Nt-ng).
        for (int j = ng; j <= Nt - ng; ++j) {
            Vec3 UL, UR;
            if (order == 2) {
                // right face value of cell (j-1) and left face of cell (j)
                double rL, uLv, pLv, rR, uRv, pRv;
                consToPrim(Q[j - 1], g, rL, uLv, pLv);
                consToPrim(Q[j],     g, rR, uRv, pRv);
                double rLf = rL + 0.5 * slope[j - 1][0];
                double uLf = uLv + 0.5 * slope[j - 1][1];
                double pLf = pLv + 0.5 * slope[j - 1][2];
                double rRf = rR - 0.5 * slope[j][0];
                double uRf = uRv - 0.5 * slope[j][1];
                double pRf = pRv - 0.5 * slope[j][2];
                // positivity safeguard: fall back to 1st order if reconstruction
                // produced a non-physical density/pressure at this face.
                if (rLf <= 0.0 || pLf <= 0.0) { rLf = rL; uLf = uLv; pLf = pLv; }
                if (rRf <= 0.0 || pRf <= 0.0) { rRf = rR; uRf = uRv; pRf = pRv; }
                UL = primToCons(rLf, uLf, pLf, g);
                UR = primToCons(rRf, uRf, pRf, g);
            } else {
                UL = Q[j - 1];
                UR = Q[j];
            }
            Fhat[j] = roeFlux(UL, UR, g);
        }

        for (int i = ng; i < Nt - ng; ++i)
            for (int k = 0; k < 3; ++k)
                R[i][k] = -(Fhat[i + 1][k] - Fhat[i][k]) / dx;
    };

    auto computeDt = [&](const std::vector<Vec3>& Q) {
        double smax = kTiny;
        for (int i = ng; i < Nt - ng; ++i) {
            double rho, u, p;
            consToPrim(Q[i], g, rho, u, p);
            smax = std::max(smax, std::fabs(u) + soundSpeed(rho, p, g));
        }
        return cfg.cfl * dx / smax;
    };

    std::vector<Vec3> R(Nt, Vec3{0, 0, 0});
    std::vector<Vec3> U1(Nt);

    double t = 0.0;
    int    steps = 0;
    while (t < cfg.tEnd - 1e-12 && steps < cfg.maxSteps) {
        applyBC(U);
        double dt = computeDt(U);
        if (t + dt > cfg.tEnd) dt = cfg.tEnd - t;

        // SSP-RK2 (Shu–Osher): stage 1
        computeRHS(U, R);
        U1 = U;
        for (int i = ng; i < Nt - ng; ++i)
            for (int k = 0; k < 3; ++k)
                U1[i][k] = U[i][k] + dt * R[i][k];
        applyBC(U1);

        // stage 2 + convex combination
        computeRHS(U1, R);
        for (int i = ng; i < Nt - ng; ++i)
            for (int k = 0; k < 3; ++k)
                U[i][k] = 0.5 * U[i][k] + 0.5 * (U1[i][k] + dt * R[i][k]);

        t += dt;
        ++steps;
    }
    applyBC(U);

    // assemble cell-centred primitive output
    Compressible1DResult out;
    out.cells = N;
    out.steps = steps;
    out.tFinal = t;
    out.dx = dx;
    out.x.resize(N);
    out.rho.resize(N);
    out.u.resize(N);
    out.p.resize(N);
    out.e.resize(N);
    out.mach.resize(N);
    for (int i = 0; i < N; ++i) {
        double rho, u, p;
        consToPrim(U[i + ng], g, rho, u, p);
        const double a = soundSpeed(rho, p, g);
        out.x[i]    = cfg.xL + (i + 0.5) * dx;
        out.rho[i]  = rho;
        out.u[i]    = u;
        out.p[i]    = p;
        out.e[i]    = p / ((g - 1.0) * rho);
        out.mach[i] = std::fabs(u) / a;
    }

    const auto t1 = std::chrono::high_resolution_clock::now();
    out.cpuMs =
        std::chrono::duration<double, std::milli>(t1 - t0).count();
    return out;
}

} // namespace forge::cfd
