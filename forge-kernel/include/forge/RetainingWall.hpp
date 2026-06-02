// Forge-240 — Cantilever retaining wall (Rankine earth pressure).
//
// Geometry assumed: vertical wall back, level backfill (β = 0),
// no wall friction. Active and passive earth pressure coefficients
// per Rankine:
//   K_a = (1 − sinφ) / (1 + sinφ) = tan²(45° − φ/2)
//   K_p = (1 + sinφ) / (1 − sinφ) = tan²(45° + φ/2)
//
// Lateral pressure (no water, single soil layer):
//   p_a(z) = K_a · γ · z + K_a · q_s    (q_s = surcharge)
//   p_p(z) = K_p · γ · z
//
// Resultants:
//   P_a (soil) = ½·K_a·γ·H²  at H/3 from base
//   P_a (surch)= K_a·q_s·H    at H/2 from base
//   P_p        = ½·K_p·γ·D²   at D/3 from base (D = embedment)
//
// Stability:
//   M_OT  = sum of overturning moments about the toe
//   M_R   = sum of resisting moments (wall + base + soil over heel)
//   FS_OT = M_R / M_OT                               (≥ 2 typical)
//   F_R   = μ·N + c·B·L_base + P_p                   (resisting friction)
//   F_d   = sum of horizontal driving forces (P_a + surcharge term)
//   FS_S  = F_R / F_d                                (≥ 1.5 typical)
//   q_max = N/B_base + 6·N·e/B_base²                 (toe bearing)
//   q_min = N/B_base − 6·N·e/B_base²                 (heel bearing)
//   FS_B  = q_allow / q_max
//
//   e     = B_base/2 − x_R, x_R = M_R_net / N

#pragma once

namespace forge::retwall {

struct Input {
    // Geometry
    double totalHeightM;            // H (m) — stem height above base
    double embedmentDepthM;         // D (m) — base depth below grade (for K_p)
    double baseWidthM;              // B_base (m)
    double toeWidthM;               // distance from toe to front of stem
    double stemThicknessM;          // t (m) — average stem
    double baseThicknessM;          // t_b (m)
    // Soil
    double unitWeightSoilNPerM3;    // γ (N/m³)
    double frictionAngleDeg;        // φ
    double cohesionPa;              // c (Pa) — interface
    double frictionCoeffBase;       // μ — concrete-on-soil
    double surchargePa;             // q_s (Pa) — uniform on backfill
    // Materials
    double unitWeightConcreteNPerM3;// γ_c (N/m³)
    // Capacity
    double allowableBearingPa;      // q_allow (Pa)
};

struct Result {
    double Ka;
    double Kp;
    double activeForceN;          // total horizontal driving (soil + surcharge)
    double activeMomentNm;        // about base toe
    double passiveForceN;
    double weightTotalN;
    double overturningMomentNm;   // sum of horizontal-pressure moments
    double resistingMomentNm;     // sum of vertical-load moments about toe
    double safetyFactorOverturning;
    double safetyFactorSliding;
    double resultantArmM;         // x_R from toe
    double eccentricityM;         // e
    double toeBearingPa;          // q_max
    double heelBearingPa;         // q_min
    double safetyFactorBearing;   // q_allow / q_max
};

Result analyse(const Input& in);

}  // namespace forge::retwall
