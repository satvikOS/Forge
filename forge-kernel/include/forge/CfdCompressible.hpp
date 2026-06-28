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

// ===========================================================================
// SU2-track C1 — 2D compressible Euler on a structured quad mesh.
// ---------------------------------------------------------------------------
// Cell-centred finite-volume on a body-fitted structured grid over a
// compression wedge. The interface flux is the SAME C0 Roe linearisation
// generalised to an arbitrary face normal: the cell states are rotated into
// the face-normal frame (un = u·n, ut tangential), the identical 3-wave Roe
// decomposition (acoustic un±a + entropy un, with the C0 Harten–Hyman entropy
// fix and the C0 α-projection formulas) is evaluated in that frame, the
// tangential velocity is carried by one extra shear wave at speed un, and the
// resulting momentum flux is rotated back to (x,y). It is NOT a second Riemann
// solver — same Roe averages, same eigenvalues, same entropy fix as C0.
//
// Verified against the analytic oblique-shock θ-β-M relation for supersonic
// flow over a wedge (Anderson, "Modern Compressible Flow", 3rd ed., McGraw-Hill
// 2003, Ch. 4) — see test/cfd_oblique_shock_gate.mjs.
// ===========================================================================

// Supersonic flow over a compression wedge on a body-fitted structured mesh.
// Geometry (2D, units non-dimensional): a flat inlet floor on [xInlet, xRamp]
// then a straight ramp inclined at the wedge half-angle for x ≥ xRamp, a flat
// far-field top at y = yTop, supersonic inflow on the left, supersonic outflow
// on the right. Defaults are the canonical M₁=2, θ=15° case (β≈45.34°).
struct Compressible2DConfig {
    double gamma   = 1.4;   // ratio of specific heats (ideal gas, air)
    double machInf = 2.0;   // freestream Mach number M₁ (supersonic)
    double wedgeDeg = 15.0; // wedge half-angle θ (degrees)

    // structured body-fitted mesh extent + resolution
    double xInlet  = 0.0;   // left boundary x
    double xRamp   = 1.0;   // wedge corner x (flat floor → inclined ramp)
    double xOutlet = 3.0;   // right boundary x
    double yTop    = 2.2;   // far-field top y (sized so the shock exits right)
    int    ni      = 240;   // cells in x
    int    nj      = 120;   // cells in y

    // freestream reference state (primitive); flow is along +x at inflow
    double rhoInf  = 1.0;
    double pInf    = 1.0;

    double cfl     = 0.5;       // CFL for local time stepping to steady state
    int    order   = 1;         // 1 = 1st-order, 2 = MUSCL (van Leer, primitive)
    int    maxIter  = 30000;    // iteration cap
    double resTol   = 1e-6;     // steady-state density-residual drop (relative)
};

struct Compressible2DResult {
    int ni = 0, nj = 0;                 // mesh dims (cells)
    // cell-centred fields, row-major index = i + j*ni  (i fast, x-direction)
    std::vector<double> x, y;           // cell-centre coordinates
    std::vector<double> rho, u, v, p;   // primitive state
    std::vector<double> mach;           // |vel|/a
    // freestream reference (region I)
    double rhoInf = 0.0, uInf = 0.0, vInf = 0.0, pInf = 0.0;
    double aInf = 0.0, machInf = 0.0;
    int    iters    = 0;                // iterations to convergence / cap
    double resFinal = 0.0;              // final density residual (relative)
    double res0     = 0.0;              // initial density residual
    double cpuMs    = 0.0;
    int    order    = 1;                // scheme order actually used
};

// Solve the 2D compressible Euler equations over a compression wedge to steady
// state. Reuses the C0 Roe flux (rotate-to-normal-frame); slip-wall (flow
// tangency) on the wedge floor; supersonic far-field/inflow + outflow.
Compressible2DResult solveCompressible2D(const Compressible2DConfig& cfg);

} // namespace forge::cfd
