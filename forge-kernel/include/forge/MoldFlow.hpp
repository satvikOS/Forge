#pragma once

// Forge-172 — Injection-mould flow analysis on a tessellated cavity shell.
//
// Solves the Hele-Shaw thin-cavity pressure equation
//
//     ∇·( S · ∇P ) = 0          S = h³ / (12 · η_eff)
//
// on the dual graph of a triangle shell mesh, with Cross-WLF
// generalised-Newtonian viscosity
//
//     η₀(T) = D₁ · exp( −A₁ · (T − Tg) / (A₂ + T − Tg) )
//     η(γ̇, T) = η₀ / ( 1 + ( η₀ · γ̇ / τ* )^(1 − n) )
//
// (Hieber & Shen 1980 + Williams-Landel-Ferry 1955.) The flow is
// approximated as isothermal at the melt temperature in this slice; a
// thermally coupled extension can sit on top of the same pressure solver.
//
// Time-marching:
//   1. Classify cells as empty / partial / full from `f ∈ [0, 1]`.
//   2. Assemble a sparse FV system A·P = b on filled + partial cells.
//      Boundary conditions: P = 0 (atmospheric) on the live flow front,
//      gate cells receive a flow-rate source term.
//   3. Solve P with Eigen SparseLU.
//   4. Update shear rate γ̇ ≈ |∇P| · h / (2 · η) and re-evaluate η_eff
//      (single Picard sweep per timestep).
//   5. Advance partial cells' fill fraction by incoming volumetric flux
//      × Δt / cell volume.
//   6. Detect weld-line collisions where two boundary cells flag each
//      other as upstream within a single timestep.
//   7. At the end, detect air-trap cells: f < 0.99 AND every neighbour
//      reached f = 1.0.

#include <cstdint>
#include <vector>

namespace forge { namespace mold {

struct MeshShell {
    std::vector<double>   vertices;   // 3N (x, y, z) — only XY matters for Hele-Shaw
    std::vector<uint32_t> triangles;  // 3M (i0, i1, i2)
    std::vector<double>   thickness;  // M, per-triangle wall thickness (m)
};

struct InjectionGate {
    double x, y, z;        // gate centre — snaps to nearest triangle centroid
    double flowRateM3s;    // m³/s
    double meltTempK;      // melt temperature at the gate
};

struct CrossWLF {
    double n;        // power-law index (typ. 0.2..0.5)
    double tauStar;  // Pa (Cross transition shear stress, typ. 1e5..1e6)
    double D1;       // Pa·s — WLF η₀ reference
    double A1;       // dimensionless (typ. 17..27)
    double A2;       // K (typ. 51..170)
    double Tg;       // K — glass-transition reference
};

struct FlowResult {
    std::vector<double>   fillTimeSec;        // M, time fluid reached this triangle
    std::vector<double>   peakPressurePa;     // M, pressure at the moment of fill
    std::vector<double>   filledFraction;     // M, final f ∈ [0,1]
    std::vector<uint32_t> weldLineTriangles;  // ids
    std::vector<uint32_t> airTrapTriangles;   // ids
    double totalFillTimeSec;
    double maxPressurePa;
    int    stepsTaken;
    bool   converged;
};

FlowResult heleShawFill(const MeshShell& mesh,
                        const InjectionGate& gate,
                        const CrossWLF& mat,
                        double moldTempK,
                        double maxTimeSec,
                        int    maxSteps);

}} // namespace forge::mold
