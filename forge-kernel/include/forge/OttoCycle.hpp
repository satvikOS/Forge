// Forge-276 — Air-standard Otto cycle (4-stroke spark-ignition engine).
//
// Four reversible processes on air as the working fluid (constant c_v, c_p):
//
//   1→2  Isentropic compression       T_2 = T_1 · r^(γ−1)
//                                      p_2 = p_1 · r^γ
//   2→3  Constant-volume heat input    q_in = c_v · (T_3 − T_2)
//                                      p_3 / T_3 = p_2 / T_2  (v const)
//   3→4  Isentropic expansion          T_4 = T_3 · r^(−(γ−1))
//                                      p_4 = p_3 · r^(−γ)
//   4→1  Constant-volume heat reject   q_out = c_v · (T_4 − T_1)
//
// Per-mass quantities (SI, air):
//   c_v  = R_air / (γ − 1),  R_air = 0.287 kJ/(kg·K),  γ ≈ 1.4
//   w_net = q_in − q_out
//   η    = 1 − r^(−(γ−1)) = w_net / q_in
//   MEP  = w_net / (v_1 − v_2)
//
// Inputs: compression ratio r, peak temperature T_3, intake temperature
// T_1, intake pressure p_1, and γ. R_air defaulted via the gas-constant
// closure c_v = R/(γ−1) with R = R_universal/M_air = 287 J/(kg·K).

#pragma once

namespace forge::ottocycle {

struct Input {
    double compressionRatio;        // r = V_1 / V_2
    double intakeTemperatureK;      // T_1
    double intakePressureKPa;       // p_1
    double peakTemperatureK;        // T_3 (after heat addition)
    double specificHeatRatio;       // γ
};

struct Result {
    double cVKJkgK;                 // c_v
    double t2K, t3K, t4K;
    double p2KPa, p3KPa, p4KPa;
    double v1OverV2;                // = r
    double specificVolume1M3kg;     // v_1 = R·T_1/p_1
    double specificVolume2M3kg;     // v_2 = v_1 / r
    double qInKJkg;                 // c_v·(T_3 − T_2)
    double qOutKJkg;                // c_v·(T_4 − T_1)
    double wNetKJkg;                // q_in − q_out
    double thermalEfficiency;       // η (fraction)
    double meanEffectivePressureKPa;// w_net / (v_1 − v_2), kJ/m³ = kPa
};

Result analyse(const Input& in);

}  // namespace forge::ottocycle
