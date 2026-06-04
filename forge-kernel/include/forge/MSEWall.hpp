// Forge-326b — MSE retaining wall global FOS (FHWA NHI-10-024 simplified).
//   Reinforcement length L = max(0.7·H, 2.4 m)
//   Driving force F_d = ½·K_a·γ·H² + q·K_a·H        kN/m
//   Resisting (sliding) = (W_wall + q·L)·tan φ_f
//   FOS_sliding = R / F_d ≥ 1.5

#pragma once

namespace forge::mse {

struct Input {
    double wallHeightH_m;
    double soilFrictionAngleDeg;      // φ
    double foundationFrictionAngleDeg; // φ_f (interface)
    double soilUnitWeightKnM3;        // γ
    double reinforcementLengthM;      // L (set 0 → use 0.7H or 2.4)
    double surchargeKnM2;             // q
};

struct Result {
    double K_active;
    double drivingForceKnPerM;
    double effectiveReinforcementLengthM;
    double resistingForceKnPerM;
    double slidingFOS;
    bool   meetsFOS;                  // ≥ 1.5
};

Result analyse(const Input& in);

}  // namespace forge::mse
