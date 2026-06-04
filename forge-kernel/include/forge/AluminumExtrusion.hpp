// Forge-337b — Aluminum extrusion design (Aluminum Design Manual 2020, ASD §F & §B).
//   Yield / ultimate stress per alloy temper (lookup).
//   Compression slenderness  λ = (k·L) / r,
//   Allowable axial F_a:
//     λ ≤ S_1:        F_a = F_y / Ω
//     S_1 < λ ≤ S_2:  F_a = (B_c − D_c · λ) / Ω         column buckling (Euler-like)
//     λ > S_2:        F_a = π²·E / (Ω·λ²)
//   Flexural local buckling per ADM Table B.4.3:
//     b/t flat element classified slender / non-slender.

#pragma once

#include <string>

namespace forge::adm {

struct Input {
    std::string alloy;             // e.g., "6061-T6", "6063-T5", "5052-H32"
    double effectiveLength_mm;     // k·L
    double radiusOfGyration_mm;    // r
    double flatWidth_b_mm;         // for local buckling check
    double flatThickness_t_mm;
    double safetyFactor_Omega;     // 1.65 building, 1.95 bridge
};

struct Result {
    double yieldStrength_MPa;
    double ultimateStrength_MPa;
    double modulus_MPa;
    double slenderness;
    double allowableAxialStress_MPa;
    double btRatio;
    bool   localBucklingControlled;
};

Result analyse(const Input& in);

}  // namespace forge::adm
