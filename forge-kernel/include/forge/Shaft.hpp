// Forge-235 — Shaft design under combined bending + torsion.
//
// Static check (Distortion Energy / von Mises):
//   σ_x = 32·M / (π·d³)
//   τ   = 16·T / (π·d³)
//   σ_vm = √(σ_x² + 3·τ²)
//   SF_static = S_y / σ_vm
//
// Fatigue check (ASME B106.1M / Shigley modified Goodman, rotating
// shaft with fully reversed bending + steady torque):
//   σ_a = 32·M / (π·d³)        (alternating bending)
//   τ_m = 16·T / (π·d³)        (mean torque shear)
//   σ_a'  = K_f · σ_a          (fatigue stress concentration on bending)
//   τ_m'  = K_fs · τ_m         (concentration on torsion)
//   σ_vm_a = σ_a'              (only bending contributes to alternating)
//   σ_vm_m = √3 · τ_m'         (only torsion contributes to mean)
//   1/n   = σ_vm_a / S_e + σ_vm_m / S_ut
//
// Endurance limit (Shigley):
//   S_e' = 0.5·S_ut    (S_ut ≤ 1400 MPa else 700 MPa)
//   S_e  = k_a·k_b·k_c·k_d·k_e · S_e'
// User supplies k_a..k_e as a single combined Marin factor k_total.

#pragma once

namespace forge::shaft {

struct StaticInput {
    double diameterM;        // shaft diameter d (m)
    double bendingMomentNm;  // M (N·m)
    double torqueNm;         // T (N·m)
    double yieldMPa;         // S_y (MPa)
};

struct StaticResult {
    double bendingStressMPa;     // σ_x
    double shearStressMPa;       // τ
    double vonMisesStressMPa;    // σ_vm
    double safetyFactor;         // SF
};

StaticResult analyseStatic(const StaticInput& in);

struct FatigueInput {
    double diameterM;        // d (m)
    double bendingMomentNm;  // M (N·m), fully reversed
    double torqueNm;         // T (N·m), steady mean
    double ultimateMPa;      // S_ut (MPa)
    double marinFactor;      // k_total = k_a·k_b·k_c·k_d·k_e
    double kfBending;        // K_f, fatigue stress concentration on bending
    double kfsTorsion;       // K_fs, fatigue stress concentration on torsion
};

struct FatigueResult {
    double enduranceLimitMPa;    // S_e
    double alternatingMPa;       // σ_vm_a
    double meanMPa;              // σ_vm_m
    double safetyFactor;         // n by modified Goodman
};

FatigueResult analyseFatigue(const FatigueInput& in);

}  // namespace forge::shaft
