// Forge-277 — Air-standard Diesel cycle (compression-ignition engine).
//
//   1→2  Isentropic compression       T_2 = T_1 · r^(γ−1)
//                                      p_2 = p_1 · r^γ
//   2→3  Constant-pressure heat input  T_3 = T_2 · r_c
//                                      p_3 = p_2
//                                      q_in = c_p · (T_3 − T_2)
//   3→4  Isentropic expansion to BDC   T_4 = T_3 · (r_c / r)^(γ−1)
//                                      p_4 = p_3 · (r_c / r)^γ
//   4→1  Constant-volume heat reject   q_out = c_v · (T_4 − T_1)
//
//   r    = V_1 / V_2  (compression ratio)
//   r_c  = V_3 / V_2  (cutoff ratio — fraction of stroke during combustion)
//
// Thermal efficiency:
//   η  =  1 − (1 / r^(γ−1)) · (r_c^γ − 1) / (γ · (r_c − 1))
//
// In the limit r_c → 1 this collapses to the Otto efficiency
// 1 − r^(−(γ−1)). For r_c > 1 the Diesel efficiency is always
// less than the equivalent Otto for the same r, but Diesel engines
// run at higher r and benefit overall.
//
// Air constants used: R_air = 0.287 kJ/(kg·K), c_v = R/(γ−1),
// c_p = γ·c_v. Units: temperature K, pressure kPa, energy kJ/kg.

#pragma once

namespace forge::dieselcycle {

struct Input {
    double compressionRatio;
    double cutoffRatio;
    double intakeTemperatureK;
    double intakePressureKPa;
    double specificHeatRatio;
};

struct Result {
    double cVKJkgK;
    double cPKJkgK;
    double t2K, t3K, t4K;
    double p2KPa, p3KPa, p4KPa;
    double specificVolume1M3kg;
    double specificVolume2M3kg;
    double qInKJkg;
    double qOutKJkg;
    double wNetKJkg;
    double thermalEfficiency;
    double meanEffectivePressureKPa;
};

Result analyse(const Input& in);

}  // namespace forge::dieselcycle
