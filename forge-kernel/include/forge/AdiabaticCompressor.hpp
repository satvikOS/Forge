// Forge-327e — Adiabatic / polytropic compressor discharge T (ideal gas).
//   T_2s = T_1 · (P_2/P_1)^((k−1)/k)               isentropic
//   T_2  = T_1 + (T_2s − T_1) / η_s                actual with η
//   w_in = c_p · (T_2 − T_1)                        kJ/kg
//   c_p = k · R / (M · (k − 1))                     where R = 8.314 J/mol·K

#pragma once

namespace forge::adicomp {

struct Input {
    double inletTempC;
    double inletPressureKpaAbs;
    double dischargePressureKpaAbs;
    double kRatio;                  // C_p/C_v
    double isentropicEfficiency;    // 0.65-0.85 typical
    double molecularWeight;         // g/mol — for c_p calc
};

struct Result {
    double pressureRatio;
    double isentropicDischargeTempC;
    double actualDischargeTempC;
    double specificHeatCpKJpkgK;
    double specificWorkKJpkg;
};

Result analyse(const Input& in);

}  // namespace forge::adicomp
