// Forge-319c — Substation ground-grid resistance (IEEE Std 80-2013 simplified
// Sverak formula).
//
//   R_g = ρ · [ 1/L + 1/√(20·A) · (1 + 1/(1 + h·√(20/A))) ]    Ω
//
// where ρ = soil resistivity (Ω·m), A = grid area (m²), L = total buried
// conductor length (m), h = grid burial depth (m). Sverak's two-term form
// (IEEE 80 §14.3) is accurate within 2 % vs the full grid solver for
// uniform soils.

#pragma once

namespace forge::subgnd {

struct Input {
    double soilResistivityOhmM;       // ρ (10-1000 typical)
    double gridAreaM2;                // A = footprint
    double totalConductorLengthM;     // L (sum of all rods + horizontal)
    double burialDepthM;              // h (typ 0.5)
};

struct Result {
    double gridResistanceOhm;
    bool   meetsIeee80Target;         // ≤ 1.0 Ω rule of thumb
};

Result analyse(const Input& in);

}  // namespace forge::subgnd
