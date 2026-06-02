#pragma once

// Forge-173 — Casting solidification simulation.
//
// Finite-difference heat-transfer with phase change on a regular voxel grid,
// using the enthalpy method to absorb latent heat in the mushy zone:
//
//   ρ·cp·∂T/∂t = ∇·(k·∇T) − ρ·L·∂fl/∂t        (with phase change)
//
// reformulated as
//
//   ∂H/∂t = ∇·(k·∇T)                          where H = ρ·cp·T + ρ·L·fl(T)
//
// fl(T) is a piecewise function: 0 below the solidus, 1 above the liquidus,
// linear in between. Recovering T from H requires a piecewise inversion
// that automatically holds T near the freezing range while H drops by ρ·L
// — i.e. the latent heat is released without an iterative loop.
//
// Boundary condition: Newton convection q = h_wall · (T_cell − T_ambient)
// applied at every voxel face that adjoins the cavity-mask exterior.
// Explicit FTCS time-marching, stable when Δt ≤ cfl · ρcp dx² / k.
//
// Outputs per cell:
//   * solidification time (first moment T crosses T_liquidus downward; −1 if
//     never solidified within the run);
//   * peak temperature seen at the cell;
//   * Niyama porosity criterion G/√R at the final solidification timestep,
//     where G = |∇T| (K/m) and R is local cooling rate (K/s); flags cells
//     prone to interdendritic shrinkage porosity (industry threshold ≈ 1 for
//     steel, 0.7 for Al).
//   * Per-snapshot temperature field.

#include <cstdint>
#include <vector>

namespace forge { namespace casting {

struct AlloyProps {
    double rho;        // kg/m³
    double cp;         // J/(kg·K)  (effective specific heat)
    double k;          // W/(m·K)   thermal conductivity
    double L;          // J/kg      latent heat of fusion
    double Tsolidus;   // K
    double Tliquidus;  // K
};

struct CastingConfig {
    // Domain (metres).
    double minX, minY, minZ, maxX, maxY, maxZ;
    int    Nx, Ny, Nz;
    // Initial + boundary.
    double Tpour;       // K, initial melt temperature inside cavity
    double TambientK;   // K, mold/ambient temperature
    double hWall;       // W/(m²·K) Newton wall coefficient
    // Material.
    AlloyProps alloy;
    // Time stepping.
    double endTimeSec;
    double cflFactor;   // 0.01..0.5; Δt = cfl · ρcp dx² / k
    int    sampleEvery; // record T snapshot every N steps (≥1)
    // Cavity mask, size Nx·Ny·Nz, k×j×i index. 1 = melt voxel, 0 = outside.
    std::vector<uint8_t> cavityMask;
};

struct CastingResult {
    int Nx, Ny, Nz;
    std::vector<double> solidTimeSec;       // per cell; -1 if never solidified
    std::vector<double> peakTempK;          // per cell
    std::vector<double> niyama;             // per cell at solidification; 0 if N/A
    std::vector<double> snapshotTimesSec;
    std::vector<std::vector<double>> tempSnapshots; // [snapshot][cell]
    double totalSimTimeSec;
    double maxSolidTimeSec;
    double avgSolidTimeSec;
    int    cellsSimulated;        // count of voxels with cavityMask = 1
    int    cellsSolidified;
};

CastingResult solidify(const CastingConfig& cfg);

}} // namespace forge::casting
