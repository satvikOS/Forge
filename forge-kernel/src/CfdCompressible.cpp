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

// ===========================================================================
// SU2-track C1 — 2D compressible Euler, structured FV, ROTATED C0 Roe flux.
// ---------------------------------------------------------------------------
//   ∂U/∂t + ∂F/∂x + ∂G/∂y = 0,   U = (ρ, ρu, ρv, ρE),
//   p = (γ−1)(ρE − ½ρ(u²+v²)).
//
// The interface flux is the EXACT SAME Roe linearisation as C0 (above),
// generalised to an arbitrary face normal n: the left/right states are rotated
// into the face-normal frame (normal velocity un = u·n, tangential ut), the
// identical 3-wave Roe decomposition (acoustic un±a, entropy un) with the same
// α-projection formulas and the same Harten–Hyman entropy fix is evaluated in
// that frame, and the tangential momentum is carried by ONE extra shear wave
// advected at the contact speed un. The resulting momentum flux is rotated back
// to (x,y). No second Riemann solver — same Roe averages / eigenvalues / fix.
//
// Verified against the analytic oblique-shock θ-β-M relation (Anderson, Modern
// Compressible Flow, 3rd ed.) — see test/cfd_oblique_shock_gate.mjs.
// ===========================================================================
namespace {

using Vec4 = std::array<double, 4>; // (ρ, ρu, ρv, ρE)

inline Vec4 primToCons2D(double rho, double u, double v, double p, double g) {
    const double rhoE = p / (g - 1.0) + 0.5 * rho * (u * u + v * v);
    return {rho, rho * u, rho * v, rhoE};
}

inline void consToPrim2D(const Vec4& U, double g,
                         double& rho, double& u, double& v, double& p) {
    rho = U[0];
    u   = U[1] / rho;
    v   = U[2] / rho;
    p   = (g - 1.0) * (U[3] - 0.5 * rho * (u * u + v * v));
}

// Physical Euler flux projected onto the unit face normal n = (nx, ny):
//   F·n = ( ρ un, ρ un u + p nx, ρ un v + p ny, un (ρE + p) ),  un = u nx + v ny.
inline Vec4 normalFlux2D(const Vec4& U, double nx, double ny, double g) {
    double rho, u, v, p;
    consToPrim2D(U, g, rho, u, v, p);
    const double un   = u * nx + v * ny;
    const double rhoE = U[3];
    return {rho * un,
            rho * un * u + p * nx,
            rho * un * v + p * ny,
            un * (rhoE + p)};
}

// Rotated Roe flux across a face of unit normal (nx, ny). This is the C0 Roe
// solver in the face-normal frame plus a tangential shear wave. Returns the
// numerical flux F̂·n for the 2D conservative state.
Vec4 roeFlux2D(const Vec4& UL, const Vec4& UR, double nx, double ny, double g) {
    double rhoL, uL, vL, pL, rhoR, uR, vR, pR;
    consToPrim2D(UL, g, rhoL, uL, vL, pL);
    consToPrim2D(UR, g, rhoR, uR, vR, pR);

    const double aL = soundSpeed(rhoL, pL, g);  // reuse C0 EOS helper
    const double aR = soundSpeed(rhoR, pR, g);
    const double HL = (UL[3] + pL) / rhoL;      // total specific enthalpy
    const double HR = (UR[3] + pR) / rhoR;

    // tangent (rotate normal by +90°): (tx, ty) = (−ny, nx)
    const double tx = -ny, ty = nx;

    // normal / tangential velocities (the face-frame rotation)
    const double unL = uL * nx + vL * ny;
    const double unR = uR * nx + vR * ny;

    const Vec4 FnL = normalFlux2D(UL, nx, ny, g);
    const Vec4 FnR = normalFlux2D(UR, nx, ny, g);

    // Roe averages (√ρ-weighted) — identical recipe to C0
    const double srL = std::sqrt(rhoL), srR = std::sqrt(rhoR);
    const double inv = 1.0 / (srL + srR);
    const double uH  = (srL * uL + srR * uR) * inv;
    const double vH  = (srL * vL + srR * vR) * inv;
    const double HH  = (srL * HL + srR * HR) * inv;
    const double rhoH = srL * srR;
    const double qH2 = uH * uH + vH * vH;       // full KE (rotation-invariant)
    double a2 = (g - 1.0) * (HH - 0.5 * qH2);
    if (a2 < kTiny) a2 = kTiny;
    const double aH  = std::sqrt(a2);
    const double unH = uH * nx + vH * ny;       // Roe-averaged normal velocity
    const double utH = uH * tx + vH * ty;       // Roe-averaged tangential vel.

    // Roe eigenvalues: acoustic un±a, entropy un, shear un
    const double l1 = unH - aH;   // acoustic −
    const double l2 = unH;        // entropy
    const double l3 = unH;        // shear (tangential momentum)
    const double l4 = unH + aH;   // acoustic +

    // wave strengths — α1/α2/α4 are EXACTLY the C0 formulas with un, Δun;
    // α3 is the added shear wave (tangential-velocity jump).
    const double dRho = rhoR - rhoL;
    const double dP   = pR - pL;
    const double dUn  = unR - unL;
    const double dUt  = (uR * tx + vR * ty) - (uL * tx + vL * ty);
    const double alpha1 = (dP - rhoH * aH * dUn) / (2.0 * a2);
    const double alpha2 = dRho - dP / a2;
    const double alpha4 = (dP + rhoH * aH * dUn) / (2.0 * a2);
    const double alpha3 = rhoH * dUt;

    // right eigenvectors (Cartesian momentum components, rotated back to x,y)
    const Vec4 K1 = {1.0, uH - aH * nx, vH - aH * ny, HH - aH * unH};
    const Vec4 K2 = {1.0, uH,           vH,           0.5 * qH2};
    const Vec4 K3 = {0.0, tx,           ty,           utH};
    const Vec4 K4 = {1.0, uH + aH * nx, vH + aH * ny, HH + aH * unH};

    // Harten–Hyman entropy fix on the eigenvalue magnitudes (same as C0),
    // evaluated with the NORMAL velocities of the bounding states.
    auto hh = [](double lam, double lamL, double lamR) {
        const double d = std::max(0.0, std::max(lam - lamL, lamR - lam));
        const double a = std::fabs(lam);
        return a < d ? d : a;
    };
    const double L1 = hh(l1, unL - aL, unR - aR);
    const double L2 = hh(l2, unL, unR);
    const double L3 = hh(l3, unL, unR);
    const double L4 = hh(l4, unL + aL, unR + aR);

    Vec4 F;
    for (int k = 0; k < 4; ++k) {
        const double diss = alpha1 * L1 * K1[k] + alpha2 * L2 * K2[k] +
                            alpha3 * L3 * K3[k] + alpha4 * L4 * K4[k];
        F[k] = 0.5 * (FnL[k] + FnR[k]) - 0.5 * diss;
    }
    return F;
}

} // namespace

// ---------------------------------------------------------------------------
Compressible2DResult solveCompressible2D(const Compressible2DConfig& cfg) {
    if (cfg.ni < 4 || cfg.nj < 4)
        throw std::invalid_argument("forge.cfd.solveCompressible2D: ni,nj must be >= 4");
    if (cfg.xOutlet <= cfg.xRamp || cfg.xRamp < cfg.xInlet)
        throw std::invalid_argument("forge.cfd.solveCompressible2D: require xInlet <= xRamp < xOutlet");
    if (cfg.gamma <= 1.0)
        throw std::invalid_argument("forge.cfd.solveCompressible2D: require gamma > 1");
    if (cfg.machInf <= 1.0)
        throw std::invalid_argument("forge.cfd.solveCompressible2D: machInf must be supersonic (>1)");
    if (cfg.cfl <= 0.0 || cfg.cfl > 1.0)
        throw std::invalid_argument("forge.cfd.solveCompressible2D: cfl must be in (0,1]");

    const auto t0 = std::chrono::high_resolution_clock::now();

    const int    ni = cfg.ni, nj = cfg.nj;
    const double g  = cfg.gamma;
    const int    nc = ni * nj;
    const double tanW = std::tan(cfg.wedgeDeg * M_PI / 180.0);
    const int    order = (cfg.order >= 2) ? 2 : 1;

    auto idx = [ni](int i, int j) { return i + j * ni; };

    // ---- body-fitted structured mesh (nodes) --------------------------------
    // node(i,j), i in [0,ni], j in [0,nj]; floor ramps for x >= xRamp.
    const int nni = ni + 1, nnj = nj + 1;
    std::vector<double> nx_(nni * nnj), ny_(nni * nnj);
    auto nidx = [nni](int i, int j) { return i + j * nni; };
    for (int i = 0; i <= ni; ++i) {
        const double xx = cfg.xInlet + (cfg.xOutlet - cfg.xInlet) * (double)i / ni;
        const double yb = (xx > cfg.xRamp) ? (xx - cfg.xRamp) * tanW : 0.0;
        for (int j = 0; j <= nj; ++j) {
            nx_[nidx(i, j)] = xx;
            ny_[nidx(i, j)] = yb + (cfg.yTop - yb) * (double)j / nj;
        }
    }

    // ---- per-cell geometry: area, centroid, 4 outward area-vectors ----------
    // face order: 0=south(j−½) 1=east(i+½) 2=north(j+½) 3=west(i−½)
    std::vector<double> area(nc), cx(nc), cy(nc);
    std::vector<std::array<double, 2>> Sface[4];
    for (int f = 0; f < 4; ++f) Sface[f].resize(nc);
    for (int j = 0; j < nj; ++j)
        for (int i = 0; i < ni; ++i) {
            const int c = idx(i, j);
            const double x00 = nx_[nidx(i, j)],     y00 = ny_[nidx(i, j)];
            const double x10 = nx_[nidx(i + 1, j)], y10 = ny_[nidx(i + 1, j)];
            const double x11 = nx_[nidx(i + 1, j + 1)], y11 = ny_[nidx(i + 1, j + 1)];
            const double x01 = nx_[nidx(i, j + 1)], y01 = ny_[nidx(i, j + 1)];
            // shoelace area (CCW: 00→10→11→01)
            area[c] = 0.5 * std::fabs((x00 * y10 - x10 * y00) +
                                      (x10 * y11 - x11 * y10) +
                                      (x11 * y01 - x01 * y11) +
                                      (x01 * y00 - x00 * y01));
            cx[c] = 0.25 * (x00 + x10 + x11 + x01);
            cy[c] = 0.25 * (y00 + y10 + y11 + y01);
            // outward area-vector S = (B.y−A.y, −(B.x−A.x)) for each CCW edge.
            auto edgeS = [](double ax, double ay, double bx, double by) {
                return std::array<double, 2>{by - ay, -(bx - ax)};
            };
            Sface[0][c] = edgeS(x00, y00, x10, y10); // south 00→10
            Sface[1][c] = edgeS(x10, y10, x11, y11); // east  10→11
            Sface[2][c] = edgeS(x11, y11, x01, y01); // north 11→01
            Sface[3][c] = edgeS(x01, y01, x00, y00); // west  01→00
        }

    // ---- freestream (region I) ----------------------------------------------
    const double aInf = std::sqrt(g * cfg.pInf / cfg.rhoInf);
    const double uInf = cfg.machInf * aInf;   // along +x
    const double vInf = 0.0;
    const Vec4 Uinf = primToCons2D(cfg.rhoInf, uInf, vInf, cfg.pInf, g);

    // ---- state, initialised to freestream -----------------------------------
    std::vector<Vec4> U(nc, Uinf);

    // Ghost state for a face given its (interior) cell, outward unit normal,
    // and boundary kind. west=inflow(freestream), east=outflow(extrapolate),
    // north=far-field(freestream), south=slip-wall(reflect normal velocity).
    auto ghostState = [&](const Vec4& Uin, double nxh, double nyh, int kind) -> Vec4 {
        if (kind == 0) {           // slip wall (flow tangency): mirror un
            double rho, u, v, p;
            consToPrim2D(Uin, g, rho, u, v, p);
            const double un = u * nxh + v * nyh;
            return primToCons2D(rho, u - 2.0 * un * nxh, v - 2.0 * un * nyh, p, g);
        } else if (kind == 2) {    // supersonic outflow: zero-gradient
            return Uin;
        }
        return Uinf;               // kind 1: inflow / far-field freestream
    };

    // van Leer limited primitive slopes (MUSCL, order==2) on the index grid.
    auto vleer = [](double a, double b) { return vanLeerSlope(a, b); };

    std::vector<Vec4> Unew(nc);
    std::vector<double> res(nc, 0.0);

    double res0 = 0.0;
    int    iter = 0;
    double resFinal = 0.0;
    const double resAbsFloor = 1e-13;

    for (iter = 0; iter < cfg.maxIter; ++iter) {
        double resSum = 0.0;

        for (int j = 0; j < nj; ++j)
            for (int i = 0; i < ni; ++i) {
                const int c = idx(i, j);
                const Vec4& Uc = U[c];

                Vec4 net = {0, 0, 0, 0};   // Σ flux·faceLen
                double specRad = 0.0;      // Σ (|un|+a)·faceLen

                // visit the 4 faces
                for (int f = 0; f < 4; ++f) {
                    const double Sx = Sface[f][c][0], Sy = Sface[f][c][1];
                    const double len = std::sqrt(Sx * Sx + Sy * Sy);
                    if (len < kTiny) continue;
                    const double fnx = Sx / len, fny = Sy / len;

                    // identify neighbour / boundary kind
                    int ni2 = i, nj2 = j, kind = -1; // kind: -1 interior
                    if (f == 0) { nj2 = j - 1; if (j == 0)       kind = 0; } // south wall
                    if (f == 1) { ni2 = i + 1; if (i == ni - 1)  kind = 2; } // east outflow
                    if (f == 2) { nj2 = j + 1; if (j == nj - 1)  kind = 1; } // north far-field
                    if (f == 3) { ni2 = i - 1; if (i == 0)       kind = 1; } // west inflow

                    Vec4 UL = Uc, UR;
                    if (kind >= 0) {
                        UR = ghostState(Uc, fnx, fny, kind);
                    } else {
                        UR = U[idx(ni2, nj2)];
                    }

                    // MUSCL primitive reconstruction (interior faces only).
                    if (order == 2 && kind < 0 &&
                        i > 0 && i < ni - 1 && j > 0 && j < nj - 1 &&
                        ni2 > 0 && ni2 < ni - 1 && nj2 > 0 && nj2 < nj - 1) {
                        // limited slopes of cell c and neighbour toward the face
                        double rC, uC, vC, pC, rN, uN, vN, pN;
                        consToPrim2D(Uc, g, rC, uC, vC, pC);
                        consToPrim2D(UR, g, rN, uN, vN, pN);
                        // central neighbours along the face direction
                        const int cBack = (f == 1) ? idx(i - 1, j)
                                        : (f == 3) ? idx(i + 1, j)
                                        : (f == 2) ? idx(i, j - 1)
                                                   : idx(i, j + 1);
                        const int nFwd  = (f == 1) ? idx(i + 2, j)
                                        : (f == 3) ? idx(i - 2, j)
                                        : (f == 2) ? idx(i, j + 2)
                                                   : idx(i, j - 2);
                        if (cBack >= 0 && cBack < nc && nFwd >= 0 && nFwd < nc) {
                            double rb, ub, vb, pb, rf, uf, vf, pf;
                            consToPrim2D(U[cBack], g, rb, ub, vb, pb);
                            consToPrim2D(U[nFwd],  g, rf, uf, vf, pf);
                            const double sCr = vleer(rC - rb, rN - rC);
                            const double sCu = vleer(uC - ub, uN - uC);
                            const double sCv = vleer(vC - vb, vN - vC);
                            const double sCp = vleer(pC - pb, pN - pC);
                            const double sNr = vleer(rN - rC, rf - rN);
                            const double sNu = vleer(uN - uC, uf - uN);
                            const double sNv = vleer(vN - vC, vf - vN);
                            const double sNp = vleer(pN - pC, pf - pN);
                            double rLf = rC + 0.5 * sCr, uLf = uC + 0.5 * sCu,
                                   vLf = vC + 0.5 * sCv, pLf = pC + 0.5 * sCp;
                            double rRf = rN - 0.5 * sNr, uRf = uN - 0.5 * sNu,
                                   vRf = vN - 0.5 * sNv, pRf = pN - 0.5 * sNp;
                            if (rLf > 0 && pLf > 0) UL = primToCons2D(rLf, uLf, vLf, pLf, g);
                            if (rRf > 0 && pRf > 0) UR = primToCons2D(rRf, uRf, vRf, pRf, g);
                        }
                    }

                    const Vec4 F = roeFlux2D(UL, UR, fnx, fny, g);
                    for (int k = 0; k < 4; ++k) net[k] += F[k] * len;

                    double rho, u, v, p;
                    consToPrim2D(Uc, g, rho, u, v, p);
                    const double un = u * fnx + v * fny;
                    specRad += (std::fabs(un) + soundSpeed(rho, p, g)) * len;
                }

                // local-time-step forward Euler:  U += −(cfl/specRad)·net
                const double fac = (specRad > kTiny) ? cfg.cfl / specRad : 0.0;
                for (int k = 0; k < 4; ++k)
                    Unew[c][k] = Uc[k] - fac * net[k];

                // density-equation residual (∝ net mass flux / area)
                const double rcell = net[0] / std::max(area[c], kTiny);
                res[c] = rcell * rcell;
                resSum += res[c];
            }

        U.swap(Unew);

        const double rms = std::sqrt(resSum / nc);
        if (iter == 0) res0 = std::max(rms, resAbsFloor);
        resFinal = rms;
        if (rms < res0 * cfg.resTol || rms < resAbsFloor) { ++iter; break; }
    }

    // ---- assemble output ----------------------------------------------------
    Compressible2DResult out;
    out.ni = ni; out.nj = nj;
    out.order = order;
    out.x.resize(nc); out.y.resize(nc);
    out.rho.resize(nc); out.u.resize(nc); out.v.resize(nc);
    out.p.resize(nc); out.mach.resize(nc);
    for (int c = 0; c < nc; ++c) {
        double rho, u, v, p;
        consToPrim2D(U[c], g, rho, u, v, p);
        const double a = soundSpeed(rho, p, g);
        out.x[c] = cx[c]; out.y[c] = cy[c];
        out.rho[c] = rho; out.u[c] = u; out.v[c] = v; out.p[c] = p;
        out.mach[c] = std::sqrt(u * u + v * v) / a;
    }
    out.rhoInf = cfg.rhoInf; out.uInf = uInf; out.vInf = vInf; out.pInf = cfg.pInf;
    out.aInf = aInf; out.machInf = cfg.machInf;
    out.iters = iter; out.resFinal = resFinal; out.res0 = res0;

    const auto t1 = std::chrono::high_resolution_clock::now();
    out.cpuMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
    return out;
}

} // namespace forge::cfd
