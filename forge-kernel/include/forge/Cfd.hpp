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

#include <cstdint>
#include <vector>

namespace forge::cfd {

struct AABB { double minX, minY, minZ, maxX, maxY, maxZ; };

struct BCFaceVelocity {
    std::uint32_t faceId; // 0..5 (same convention as fea::LoadPressure)
    double vx, vy, vz;
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
};

struct CfdResult {
    std::vector<double> u;            // cell-centre x-velocity (Nx·Ny·Nz)
    std::vector<double> v;            // cell-centre y-velocity
    std::vector<double> w;            // cell-centre z-velocity
    std::vector<double> p;            // cell-centre pressure
    double maxVelocity = 0;           // m/s
    double reynolds    = 0;           // characteristic Re estimate
    int    iterations  = 0;           // outer SIMPLE iterations actually used
    double finalResidual = 0;         // last L₂ divergence
    double initialResidual = 0;       // for residual-drop diagnostics
    double cpuMs       = 0;
};

CfdResult solveSteadyNS(const CfdConfig& cfg);

} // namespace forge::cfd
