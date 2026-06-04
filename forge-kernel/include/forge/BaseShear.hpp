// Forge-331d — ASCE 7-22 §12.8 Equivalent Lateral Force seismic base shear.
//   Period T_a = C_t · h_n^x        (12.8-7)
//     steel MRF:   C_t = 0.0724, x = 0.8
//     concrete MRF: C_t = 0.0466, x = 0.9
//     eccentric braced steel: 0.0731 / 0.75
//     all other:   C_t = 0.0488, x = 0.75
//   Spectral response acceleration coefficient C_s = S_DS · I_e / R   (12.8-2)
//                              cap C_s,max = S_D1 · I_e / (T·R)         (12.8-3)
//                              floor C_s,min = 0.044 · S_DS · I_e >= 0.01
//   Base shear V = C_s · W                                              (12.8-1)

#pragma once

namespace forge::baseshear {

struct Input {
    double heightAboveBase_m;      // h_n
    double seismicWeight_kN;       // W
    double sds;                    // short-period design spectral
    double sd1;                    // 1-second design spectral
    double R;                      // response modification coefficient
    double Ie;                     // importance factor (1.0/1.25/1.5)
    int    structuralSystem;       // 0 steel MRF, 1 concrete MRF, 2 EBF steel, 3 other
};

struct Result {
    double approximatePeriod_s;    // T_a
    double Cs;
    double CsMax;
    double CsMin;
    double baseShear_kN;           // V
    double baseShearCoeff;         // V/W
};

Result analyse(const Input& in);

}  // namespace forge::baseshear
