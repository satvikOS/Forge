// Forge-278 — Air-standard Brayton cycle (open-loop gas turbine).
//
//   1→2  Compressor — isentropic (then actual via η_c):
//        T_2s = T_1 · r_p^((γ−1)/γ),   r_p = p_2 / p_1
//        T_2  = T_1 + (T_2s − T_1) / η_c
//   2→3  Combustor — constant pressure:
//        q_in = c_p · (T_3 − T_2),    p_3 = p_2
//   3→4  Turbine — isentropic (then actual via η_t):
//        T_4s = T_3 · r_p^(−(γ−1)/γ)
//        T_4  = T_3 − η_t · (T_3 − T_4s)
//   4→1  Exhaust — constant pressure:
//        q_out = c_p · (T_4 − T_1)
//
// Specific work:
//   w_compressor = c_p · (T_2 − T_1)
//   w_turbine    = c_p · (T_3 − T_4)
//   w_net        = w_turbine − w_compressor
//   η_th         = w_net / q_in
//   BWR          = w_compressor / w_turbine
//
// For ideal cycle (η_c = η_t = 1) η_th = 1 − r_p^(−(γ−1)/γ).
//
// Air constants: R_air = 0.287 kJ/(kg·K), c_v = R/(γ−1), c_p = γ·c_v.

#pragma once

namespace forge::brayton {

struct Input {
    double pressureRatio;           // r_p = p_2 / p_1
    double intakeTemperatureK;      // T_1
    double intakePressureKPa;       // p_1
    double turbineInletTemperatureK;// T_3 (TIT)
    double specificHeatRatio;       // γ
    double compressorIsentropicEff; // η_c (1 = ideal)
    double turbineIsentropicEff;    // η_t (1 = ideal)
};

struct Result {
    double cPKJkgK;
    double t2sK, t2K;               // ideal then actual after compressor
    double t3K;
    double t4sK, t4K;               // ideal then actual after turbine
    double p2KPa, p3KPa, p4KPa;
    double compressorWorkKJkg;      // w_c (positive, work input)
    double turbineWorkKJkg;         // w_t (positive, work output)
    double qInKJkg;
    double qOutKJkg;
    double wNetKJkg;
    double thermalEfficiency;
    double backWorkRatio;           // w_c / w_t
};

Result analyse(const Input& in);

}  // namespace forge::brayton
