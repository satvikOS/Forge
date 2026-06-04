// Forge-332d — Pretensioned bolt joint (Shigley §8.8 — Norton §15).
//   Recommended F_i = 0.75 · S_p · A_t                            (reusable connection)
//   Tightening torque T = K · F_i · d            K = 0.20 (dry) typical
//   Joint stiffness ratio C = k_b / (k_b + k_m)
//     k_b = (A_t · E_b) / l_b      bolt member stiffness
//     k_m approximate Wileman:  k_m = E_m · d · A · e^(B·d/l_m)
//   With external load P:
//     Bolt load:    F_b = F_i + C·P
//     Member load:  F_m = F_i − (1−C)·P
//   Separation when F_m = 0 → P_sep = F_i / (1−C)
//   Static factor n = (S_p · A_t − F_i) / (C·P)

#pragma once

namespace forge::boltpre {

struct Input {
    double proofStrength_MPa;       // S_p (Class 8.8 ≈ 600, 10.9 ≈ 830 MPa)
    double tensileArea_mm2;         // A_t (M10 = 58, M12 = 84.3)
    double boltDiameter_mm;         // d (nominal)
    double boltLengthGrip_mm;       // l_b
    double memberGripThickness_mm;  // l_m
    double boltE_GPa;               // 207
    double memberE_GPa;             // 207 steel, 71 alum
    double externalLoadP_kN;        // P
    double torqueCoefficient;       // K  (0.20 dry, 0.15 oiled)
    double preloadFraction;         // typ 0.75 (reusable), 0.90 (permanent)
};

struct Result {
    double recommendedPreload_kN;
    double tighteningTorque_Nm;
    double bolt_stiffness_NperM;
    double member_stiffness_NperM;
    double jointStiffnessRatio_C;
    double boltLoad_kN;
    double memberLoad_kN;
    double separationLoad_kN;
    double staticSafetyFactor;
};

Result analyse(const Input& in);

}  // namespace forge::boltpre
