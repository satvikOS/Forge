#pragma once

// Forge CFD — task #63, SU2-track C0: native 1D compressible Euler solver.
//
// This is the *entry increment* that opens Forge's compressible-flow family
// (the kernel previously had ZERO compressible code — Cfd.cpp is the
// INCOMPRESSIBLE laminar Navier-Stokes solver only). C0 is intentionally
// bounded: 1D, no geometry, uniform Cartesian mesh, transmissive boundaries.
// It is, however, a GENUINE finite-volume compressible solver:
//
//   * Conservative variables  U = (ρ, ρu, ρE)  (mass, momentum, total energy).
//   * Ideal-gas EOS           p = (γ−1)(ρE − ½ρu²),  default γ = 1.4 (air).
//   * Flux                    a real APPROXIMATE RIEMANN SOLVER — the Roe
//                             linearisation with Roe averages and the full
//                             characteristic (eigenvalue/eigenvector)
//                             decomposition — NOT Lax-Friedrichs / Rusanov.
//   * Entropy fix             Harten–Hyman, so the transonic rarefaction of
//                             the Sod problem does not collapse into an
//                             unphysical "expansion shock" at the sonic point.
//   * Reconstruction          piecewise-constant (1st order) OR a TVD MUSCL
//                             reconstruction of the PRIMITIVE variables with a
//                             van Leer slope limiter (2nd order, default).
//   * Time integration        explicit SSP-RK2 (Shu–Osher) with a CFL-limited
//                             Δt recomputed every step from max|u|+a.
//   * Boundaries              transmissive / outflow (zero-gradient ghosts).
//
// Verified against the EXACT Riemann solution of the Sod shock tube
// (Toro, "Riemann Solvers and Numerical Methods for Fluid Dynamics", 3rd ed.,
// Springer 2009, §4 & §6) — see test/cfd_sod_gate.mjs.
//
// SI/non-dimensional units: the solver is unit-agnostic (works in whatever
// consistent units ρ, u, p are supplied; the Sod problem is dimensionless).

#include <vector>

namespace forge::cfd {

// Configuration for a 1D Riemann / shock-tube problem on a uniform mesh.
// Defaults are EXACTLY the standard Sod problem (Toro): domain [0,1],
// diaphragm at x=0.5, γ=1.4, left (1,0,1), right (0.125,0,0.1), t=0.2.
struct Compressible1DConfig {
    double xL    = 0.0;     // left domain boundary
    double xR    = 1.0;     // right domain boundary
    double x0    = 0.5;     // diaphragm / initial discontinuity location
    int    N     = 400;     // number of finite-volume cells
    double gamma = 1.4;     // ratio of specific heats (ideal gas)
    double tEnd  = 0.2;     // final time
    double cfl   = 0.4;     // CFL number (≤ ~0.5 for SSP-RK2 + MUSCL)
    int    order = 2;       // 1 = piecewise-constant, 2 = MUSCL (van Leer)

    // initial LEFT state (primitive)
    double rhoL = 1.0;
    double uL   = 0.0;
    double pL   = 1.0;
    // initial RIGHT state (primitive)
    double rhoR = 0.125;
    double uR   = 0.0;
    double pR   = 0.1;

    int    maxSteps = 1000000; // hard cap (safety)
};

struct Compressible1DResult {
    std::vector<double> x;    // cell-centre coordinates           (N)
    std::vector<double> rho;  // density                           (N)
    std::vector<double> u;    // velocity                          (N)
    std::vector<double> p;    // pressure                          (N)
    std::vector<double> e;    // specific internal energy  e=p/((γ−1)ρ)
    std::vector<double> mach; // local Mach number |u|/a           (N)
    int    cells   = 0;       // == N
    int    steps   = 0;       // time steps actually taken
    double tFinal  = 0.0;     // final time reached
    double dx      = 0.0;     // mesh spacing
    double cpuMs   = 0.0;     // wall time
};

// Solve the 1D compressible Euler equations with a Roe approximate Riemann
// flux (Harten–Hyman entropy fix) and SSP-RK2 time marching.
Compressible1DResult solveCompressible1D(const Compressible1DConfig& cfg);

} // namespace forge::cfd
