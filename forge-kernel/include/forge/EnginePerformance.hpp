// Forge-330b — Internal-combustion engine performance (Heywood, Stone).
//   BMEP = (W_b · n_R) / V_d              n_R = 2 (4-stroke), 1 (2-stroke)
//                                          W_b = brake work per cycle = 2π · T
//   BMEP[kPa] = (2π · T[N·m] · n_R) / V_d[m³]   for 4-stroke
//   Brake power  P_b = 2π · n[rev/s] · T
//   BSFC = ṁ_f / P_b                       (kg / kW·h)
//   Volumetric efficiency η_v = (ṁ_a · n_R) / (ρ_a · V_d · n)
//   Mean piston speed  v_p_mean = 2·L·n                where L = stroke.

#pragma once

namespace forge::engperf {

struct Input {
    double displacement_L;          // V_d (litres)
    double speed_rpm;
    double brakeTorque_Nm;          // T
    double fuelMassFlow_kgPerH;     // ṁ_f
    double airMassFlow_kgPerH;      // ṁ_a
    double airDensity_kgM3;         // ρ_a (intake-manifold air)
    double stroke_mm;               // L
    int    cycleType;               // 0 = 4-stroke, 1 = 2-stroke
};

struct Result {
    double bmep_kPa;
    double brakePower_kW;
    double bsfc_g_per_kWh;
    double volumetricEfficiency;
    double meanPistonSpeed_mPerS;
    double airFuelRatio;
};

Result analyse(const Input& in);

}  // namespace forge::engperf
