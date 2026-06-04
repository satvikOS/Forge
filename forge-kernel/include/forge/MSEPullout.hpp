// Forge-338d — MSE reinforced wall internal design (FHWA-NHI-10-024 §4.4).
//   Per layer at depth z below crest:
//     σ_v = γ·z + q                               (overburden + surcharge)
//     T_max,layer = K_r·σ_v·S_v                     S_v = vertical spacing
//     K_r/K_a from FHWA Fig 4-9: K_r/K_a = 1.7 @ z=0, 1.2 @ z=6 m, 1.0 below.
//   Required pullout length (passive):
//     L_e = T_max·SF / (2·F*·α·σ_v·C·R_c)
//     F* default 0.45 grid, 0.8 inextensible bar; α = 0.8 grid; C = 2 grid coverage; R_c = 1.
//   Total reinforcement length L = L_e + L_a where L_a inside Rankine wedge = (H − z)·tan(45 − φ/2).

#pragma once

namespace forge::msepull {

struct Input {
    double wallHeight_H_m;
    double depthBelowCrest_z_m;
    double verticalSpacing_Sv_m;
    double soilFrictionAngleDeg_phi;
    double soilUnitWeight_gamma_kNm3;
    double surchargeQ_kNm2;
    double reinforcementCoverage_Rc;     // 0..1 (grid 1.0)
    double pulloutResistanceFactor_F;
    double scaleEffectAlpha;             // 0.8 grid, 1.0 bar
    double safetyFactorSF;               // 1.5 typ
    bool   isInextensibleBar;            // true → K_r/K_a override (1.7 @ z=0 etc.)
};

struct Result {
    double Ka;
    double KrOverKa;
    double Kr;
    double verticalEffectiveStress_sigmaV_kPa;
    double maxLayerTension_Tmax_kNperM;
    double requiredEmbedmentLength_Le_m;
    double activeZoneLength_La_m;
    double totalReinforcementLength_L_m;
};

Result analyse(const Input& in);

}  // namespace forge::msepull
