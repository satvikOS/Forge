// Forge-305 — Hertzian point contact (Shigley §3-19, Johnson 1985 §3).
//
// Two-body spherical contact (ball-on-ball, ball-on-plane R₂ → ∞):
//
//   1/E* = (1-ν₁²)/E₁ + (1-ν₂²)/E₂
//   1/R* = 1/R₁ + 1/R₂
//
//   Contact-patch radius     a = (3·F·R* / (4·E*))^(1/3)
//   Maximum contact pressure p_max = 3·F / (2π·a²)
//   Mean contact pressure    p_mean = F / (π·a²)
//   Mutual approach          δ = (9·F² / (16·E*²·R*))^(1/3)
//   Max subsurface shear     τ_max ≈ 0.31·p_max  at z ≈ 0.48·a  (Johnson Eq 3.45)
//
// Use R₂ = 1e9 mm as the "plane" surrogate (R* asymptotes to R₁).

#pragma once

namespace forge::hertzpoint {

struct Input {
    double normalForceN;
    double radius1Mm;     // R₁
    double radius2Mm;     // R₂ (use 1e9 for a flat plane)
    double E1_MPa;
    double E2_MPa;
    double nu1;
    double nu2;
};

struct Result {
    double effectiveModulusMPa;
    double effectiveRadiusMm;
    double contactRadiusMm;
    double maxPressureMPa;
    double meanPressureMPa;
    double mutualApproachMm;
    double maxShearStressMPa;
    double depthOfMaxShearMm;
};

Result analyse(const Input& in);

}  // namespace forge::hertzpoint
