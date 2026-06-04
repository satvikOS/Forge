// Forge-316 — Concrete creep + shrinkage time-functions (ACI 209R-92).
//
// Used for long-term deflection prediction of RC beams/slabs, prestress
// losses in PT and PSC members, and time-dependent column shortening for
// tall buildings. Companion to Forge-238 (RC beam flexure, instantaneous)
// and Forge-297 (1D consolidation, geotech).
//
// Creep coefficient — ACI 209R-92 §2.5.5:
//     φ(t, t₀) = φ_u · (t − t₀)^0.6 / (10 + (t − t₀)^0.6)
//
//   Ultimate creep φ_u = 2.35 · γ_λ · γ_vs · γ_ψ · γ_h · γ_α · γ_ψ_lc
//   For simplified design we expose the corrections most engineers actually
//   tune: ambient RH (γ_h piecewise — 1.27 − 0.0067·H for H > 40 %), member
//   thickness V/S ratio (γ_vs ≈ 1.0 for typical 75-150 mm thick), loading
//   age (γ_la = 1.25·t_la^−0.118 for moist-cured).
//
// Shrinkage strain — ACI 209R-92 §2.5.6:
//     ε_sh(t) = ε_sh,u · t / (35 + t)              (moist-cured t in days)
//   Ultimate ε_sh,u = 780 × 10⁻⁶ · γ_sh
//   Corrections: ambient RH (γ_h = 1.40 − 0.0102·H for H > 40 %), thickness.
//
// Long-term total strain under sustained stress σ_sus and instantaneous
// strain ε_inst = σ_sus / E:
//     ε(t) = ε_inst · (1 + φ(t,t₀)) + ε_sh(t)

#pragma once

namespace forge::creep {

struct Input {
    double sustainedStressMPa;        // σ_sus
    double concreteModulusMPa;        // E_c (instantaneous)
    double ambientHumidityPercent;    // H (typ 40-100)
    double loadingAgeDays;            // t_la
    double timeAfterLoadingDays;      // t − t_la
    double ultimateCreepCoeff;        // φ_u override (set 0 → ACI default)
    double ultimateShrinkageStrain;   // ε_sh,u override (set 0 → ACI default)
};

struct Result {
    double humidityFactorCreep;       // γ_h,c
    double humidityFactorShrink;      // γ_h,sh
    double loadAgeFactor;             // γ_la
    double appliedUltimateCreep;
    double appliedUltimateShrink;
    double creepCoefficient;          // φ(t, t₀)
    double shrinkageStrain;           // ε_sh(t)
    double instantaneousStrain;       // σ/E
    double totalLongTermStrain;       // ε_inst·(1+φ) + ε_sh
    double creepStrain;               // ε_inst · φ
};

Result analyse(const Input& in);

}  // namespace forge::creep
