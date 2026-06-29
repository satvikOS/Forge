#pragma once

// Forge-12b — Incompressible Navier-Stokes (laminar) on a staggered MAC grid.
//
// Scope and honest simplifications for this slice:
//   * Laminar-only. No k-ε / k-ω / Spalart-Allmaras / LES — those are
//     queued as a follow-up CFD slice. The lid-driven cavity smoke runs at
//     Re ≈ 100 (well in the laminar regime) so the simplification is honest.
//   * Cartesian regular grid (Nx, Ny, Nz) on a user-specified AABB. Boundary
//     fitting against arbitrary BREP is a separate slice (immersed-boundary
//     or cut-cell handling on top of OCCT). Walls / inlets / outlets are
//     specified per AABB face id (0=-X .. 5=+Z), matching the existing FEA
//     convention.
//   * Staggered MAC layout:
//       u on (Nx+1) × Ny × Nz faces (x-velocity, at i±½)
//       v on Nx × (Ny+1) × Nz faces (y-velocity, at j±½)
//       w on Nx × Ny × (Nz+1) faces (z-velocity, at k±½)
//       p on Nx × Ny × Nz cell centres
//     This is the classical Harlow-Welch MAC scheme — it gives a clean
//     discrete divergence and a tridiagonally-structured pressure Poisson
//     equation that Eigen's SparseLU / SimplicialLDLT handles directly.
//   * Time-marched pressure-projection (Chorin-Temam style) with a single
//     pressure-projection per iteration. This is a SIMPLE-flavoured fixed-
//     point iteration: predict u*, solve pressure Poisson ∇²p = (ρ/Δt)∇·u*,
//     correct u^{n+1} = u* − (Δt/ρ)∇p. The header advertises "SIMPLE / PISO"
//     but PISO's second corrector pass is a follow-up slice — we ship the
//     first corrector pass (which is the dominant accuracy contribution at
//     Re < 1000 anyway).
//   * Output: velocity components per cell-centre (averaged from the
//     staggered faces), pressure per cell, max-velocity, Reynolds estimate
//     based on the characteristic length (longest grid axis) and max-speed.
//
// All quantities are in SI (length=m, time=s, velocity=m/s, pressure=Pa,
// density=kg/m³, kinematic viscosity=m²/s).

#include <array>
#include <cstdint>
#include <vector>

namespace forge::cfd {

struct AABB { double minX, minY, minZ, maxX, maxY, maxZ; };

struct BCFaceVelocity {
    std::uint32_t faceId; // 0..5 (same convention as fea::LoadPressure)
    double vx, vy, vz;
};

// Per-AABB-face temperature boundary condition for the natural-convection
// (energy-equation) extension (task #61).
//   type 0 = ADIABATIC  (zero-gradient, ∂T/∂n = 0 — an insulated wall)
//   type 1 = ISOTHERMAL (Dirichlet, T = value — a hot/cold wall)
struct ThermalFaceBC {
    int    type  = 0;     // 0 adiabatic, 1 isothermal
    double value = 0.0;   // wall temperature (K) when isothermal
};

// Per-AABB-face boundary condition for the PASSIVE-SCALAR / species concentration
// field C transported by the advection-diffusion extension (task #61).
//   type 0 = ZERO-GRADIENT (Neumann, ∂C/∂n = 0 — an impermeable / outflow wall)
//   type 1 = DIRICHLET     (fixed concentration C = value — e.g. an inlet source)
struct SpeciesFaceBC {
    int    type  = 0;     // 0 zero-gradient (Neumann), 1 Dirichlet (fixed C)
    double value = 0.0;   // imposed concentration when Dirichlet
};

struct CfdConfig {
    AABB domain;
    int    Nx, Ny, Nz;
    double rho;                       // density        (kg/m³)
    double nu;                        // kinematic viscosity (m²/s)
    int    maxIter        = 200;      // SIMPLE iterations
    double residualTol    = 1e-4;     // L₂ divergence target
    std::vector<BCFaceVelocity> inlets;  // faceId + velocity vector
    std::vector<std::uint32_t>  outlets; // zero-gradient on velocity + p=0
    std::vector<std::uint32_t>  walls;   // no-slip
    BCFaceVelocity lid{};             // optional moving lid (for cavity smoke)
    bool useLid = false;

    // ---- energy equation + Boussinesq buoyancy (natural convection, #61) ----
    // When useThermal is true the solver ALSO transports a temperature scalar T
    // on the cell centres:   ∂T/∂t + u·∇T = α ∇²T   (advection reuses the SAME
    // van-Leer MUSCL routine as momentum; diffusion is central at α), and
    // couples T back into momentum through the Boussinesq body force (per unit
    // mass):  f = −β (T − Tref) g   added to the velocity predictor. With
    // gravity g pointing −y, hot fluid (T>Tref) gets a +y (upward) acceleration
    // — closing the natural-convection loop. When useThermal is false the solver
    // is byte-for-byte the original isothermal NS (the Ghia gate is unaffected).
    bool   useThermal = false;
    double alpha = 0.0;               // thermal diffusivity α (m²/s)
    double beta  = 0.0;               // volumetric thermal expansion coeff β (1/K)
    double Tref  = 0.0;               // Boussinesq reference temperature (K)
    double gx = 0.0, gy = 0.0, gz = 0.0;  // gravity acceleration vector (m/s²)
    double Tinit = 0.0;               // fallback uniform initial temperature (K)
    std::array<ThermalFaceBC, 6> thermalBC{}; // per AABB-face T BC (0=-X..5=+Z)

    // ---- passive scalar / species advection-diffusion transport (#61) -------
    // When useSpecies is true the solver ALSO transports a concentration scalar C
    // on the cell centres:   ∂C/∂t + u·∇C = D ∇²C   (advection reuses the EXACT
    // SAME van-Leer MUSCL routine as momentum and the energy equation — there is
    // NO third advection scheme; diffusion is the same central 7-point Laplacian
    // at the mass diffusivity D). The scalar is PASSIVE: it is advected by the
    // existing velocity field with NO back-coupling onto momentum (unlike the
    // Boussinesq thermal field). Boundary behaviour is Dirichlet (fixed C, e.g.
    // an inlet source) / zero-gradient (impermeable or outflow wall) per face.
    // With useSpecies false every species branch is skipped and the solver is
    // bit-for-bit unchanged (the Ghia + de Vahl Davis gates are unaffected).
    bool   useSpecies = false;
    double massDiff = 0.0;            // mass diffusivity D (m²/s); 0 ⇒ pure advection
    double Cinit = 0.0;               // fallback uniform initial concentration
    std::vector<double> Cinit0;       // optional explicit initial C field (Nx·Ny·Nz),
                                      // e.g. an advected pulse; empty ⇒ ramp/uniform seed
    std::array<SpeciesFaceBC, 6> speciesBC{}; // per AABB-face C BC (0=-X..5=+Z)
};

struct CfdResult {
    std::vector<double> u;            // cell-centre x-velocity (Nx·Ny·Nz)
    std::vector<double> v;            // cell-centre y-velocity
    std::vector<double> w;            // cell-centre z-velocity
    std::vector<double> p;            // cell-centre pressure
    std::vector<double> T;            // cell-centre temperature (empty unless useThermal)
    std::vector<double> C;            // cell-centre species concentration (empty unless useSpecies)
    double simTime = 0;               // total elapsed physical time Σ dtStep (s) — for transient scalar transport
    double maxVelocity = 0;           // m/s
    double reynolds    = 0;           // characteristic Re estimate
    int    iterations  = 0;           // outer SIMPLE iterations actually used
    double finalResidual = 0;         // last L₂ divergence
    double initialResidual = 0;       // for residual-drop diagnostics
    double cpuMs       = 0;
};

CfdResult solveSteadyNS(const CfdConfig& cfg);

} // namespace forge::cfd
