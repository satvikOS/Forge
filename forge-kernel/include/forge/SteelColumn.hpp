#pragma once

// Forge-232 — Steel column compression design (AISC 360-22 §E3).
//
//   Slenderness:       λ = K · L / r
//   Elastic Euler:     F_e = π² · E / (K·L/r)²       (Pa)
//   Transition:        λ_lim = 4.71 · √(E / F_y)
//                      ↔ F_e ≥ 0.44 · F_y
//
//   Inelastic regime (λ ≤ λ_lim):
//       F_cr = (0.658^(F_y / F_e)) · F_y
//   Elastic regime (λ > λ_lim):
//       F_cr = 0.877 · F_e
//
//   Nominal compressive strength: P_n = F_cr · A_g
//   LRFD design strength:         φ_c · P_n   (φ_c = 0.90)
//   ASD allowable strength:       P_n / Ω_c   (Ω_c = 1.67)
//
// Inputs are SI: lengths in metres, stresses in Pa, area in m².

namespace forge { namespace steelcol {

struct Inputs {
    double effectiveLengthK;     // K (end-condition factor)
    double unbracedLength;       // L_b, m
    double radiusOfGyration;     // r about the buckling axis, m
    double area;                 // A_g, m²
    double youngsModulus;        // E, Pa
    double yieldStress;          // F_y, Pa
};

struct Outputs {
    double slenderness;          // K·L/r
    double slendernessLimit;     // 4.71·√(E/F_y)
    double eulerStress;          // F_e, Pa
    double criticalStress;       // F_cr, Pa
    double nominalStrength;      // P_n, N
    double designStrengthLRFD;   // φ_c·P_n, N
    double allowableStrengthASD; // P_n / Ω_c, N
    bool   inelasticRegime;
};

Outputs analyse(const Inputs& in);

}} // namespace forge::steelcol
