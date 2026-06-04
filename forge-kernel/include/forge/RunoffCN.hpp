// Forge-339a — NRCS TR-55 Curve-Number runoff (SCS, USDA-NRCS NEH Part 630 Ch 10).
//   S = 25400/CN − 254          (mm)
//   I_a = 0.2·S                  (initial abstraction)
//   Q = (P − I_a)² / (P + 0.8·S)   for P > I_a, else Q = 0
//   Peak flow:  q_p = q_u · A · Q · F_p     (TR-55 Ch 4, here we omit unit-peak chart and
//                                            return q_p = 0.208·A·Q/T_c as a placeholder).

#pragma once

namespace forge::cn {

struct Input {
    double curveNumber_CN;          // 30–98
    double rainfall_P_mm;
    double drainageArea_km2;
    double timeOfConcentration_Tc_h;
};

struct Result {
    double maxRetention_S_mm;
    double initialAbstraction_Ia_mm;
    double runoffDepth_Q_mm;
    double runoffVolume_m3;
    double peakFlow_qp_m3PerS;       // rough placeholder via 0.208·A·Q/T_c
};

Result analyse(const Input& in);

}  // namespace forge::cn
