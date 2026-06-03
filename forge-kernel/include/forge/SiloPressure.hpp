// Forge-275 — Janssen (1895) silo wall pressure for granular bulk storage.
//
// Used for grain elevators, cement silos, ore bunkers, hopper bins, etc.
// At depth z measured from the top of the granular fill:
//
//   p_v(z) = (γ · R) / (μ · k) · (1 − e^(−μ·k·z/R))
//   p_w(z) = k · p_v(z) = (γ · R / μ) · (1 − e^(−μ·k·z/R))
//   τ_w(z) = μ · p_w(z) = γ · R · (1 − e^(−μ·k·z/R))
//
// where (SI throughout):
//   γ  = bulk specific weight of the stored material [kN/m³]
//   R  = hydraulic radius = A / U  (= D/4 for circular silo of diameter D)
//   μ  = coefficient of friction between bulk material and wall
//   k  = ratio of horizontal to vertical stress
//        Rankine active limit:  k = (1 − sin φ) / (1 + sin φ)
//        Typical for grain ≈ 0.40, cement ≈ 0.45.
//   z  = query depth from top of fill [m]
//   φ  = angle of internal friction [deg] (optional convenience input)
//
// Asymptotic (deep-silo) limits (z → ∞):
//   p_v,∞  = γ·R / (μ·k)
//   p_w,∞  = γ·R / μ
//   τ_w,∞  = γ·R
//
// Hopper bottom (Janssen surcharge) is handled separately — this kernel
// covers the parallel-walled cylindrical or rectangular cell only.

#pragma once

namespace forge::silopressure {

struct Input {
    double bulkUnitWeightKnM3;        // γ
    double hydraulicRadiusM;          // R
    double wallFrictionCoefficient;   // μ
    double horizontalRatioK;          // k
    double depthM;                    // z
};

struct Result {
    double verticalPressureKPa;       // p_v(z)
    double wallPressureKPa;           // p_w(z)
    double frictionStressKPa;         // τ_w(z)
    double asymptoticVerticalKPa;     // p_v,∞
    double asymptoticWallKPa;         // p_w,∞
    double asymptoticFrictionKPa;     // τ_w,∞
    double depthRatioToZc;            // z / z_c where z_c = R/(μ·k)
};

Result analyse(const Input& in);

}  // namespace forge::silopressure
