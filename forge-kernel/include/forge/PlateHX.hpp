// Forge-341c — Plate heat exchanger ε-NTU (Çengel §11 / Kakaç-Liu).
//   C_min = min(C_h, C_c),  C_max = max(...)
//   C_r = C_min/C_max,  NTU = UA/C_min
//   Counterflow:   ε = (1 − e^(−NTU(1−C_r))) / (1 − C_r·e^(−NTU(1−C_r)))   if C_r < 1
//                  ε = NTU / (1+NTU)                                      if C_r = 1
//   Parallel:      ε = (1 − e^(−NTU(1+C_r))) / (1+C_r)
//   Q = ε · C_min · ΔT_max  where ΔT_max = T_h,in − T_c,in.

#pragma once

namespace forge::ehx {

struct Input {
    double hotInletTemp_Th_in_C;
    double coldInletTemp_Tc_in_C;
    double hotMassFlow_kgPerS;
    double coldMassFlow_kgPerS;
    double hotCp_kJperKgK;
    double coldCp_kJperKgK;
    double UA_kWperK;
    int    flowArrangement;        // 0 counterflow, 1 parallel
};

struct Result {
    double Cmin_kWperK;
    double Cmax_kWperK;
    double Cr;
    double NTU;
    double effectiveness;
    double heatTransfer_kW;
    double hotOutletTemp_C;
    double coldOutletTemp_C;
};

Result analyse(const Input& in);

}  // namespace forge::ehx
