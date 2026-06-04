// Forge-324b — Roof snow drift surcharge (ASCE 7-22 §7.7 leeward + windward).
//   h_d = 0.13·(L_u)^0.333·(p_g + 0.2483)^0.25 − 0.5         m, kN/m² for p_g
//   p_d = h_d · γ                                              kN/m²
//   γ ≈ 1.94 · (1 − e^(−4.6e-3·p_g))                          kN/m³

#pragma once

namespace forge::snowdrift {

struct Input {
    double groundSnowLoad_kNm2;        // p_g
    double upwindFetchLength_m;        // L_u
    bool   leewardDrift;               // true=leeward, false=windward (smaller)
};

struct Result {
    double snowUnitWeight_kNm3;        // γ
    double driftHeight_m;
    double driftPressure_kNm2;
};

Result analyse(const Input& in);

}  // namespace forge::snowdrift
