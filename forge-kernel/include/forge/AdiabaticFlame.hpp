// Forge-338c — Adiabatic flame temperature for CH4/air (Turns Ch 2).
//   CH₄ + 2(O₂ + 3.76·N₂) → CO₂ + 2·H₂O + 7.52·N₂              stoichiometric
//   Energy: |LHV_CH4| = Σ(n_prod · h_prod(T_ad) − n_prod · h_prod(T_ref))
//   Cp constants (kJ/kmol·K, ideal-gas) from Çengel Table A-2:
//     CO₂ 56, H₂O 47, N₂ 33  approx mean Cp in 1500–2200 K.
//   T_ad = T_ref + LHV / (Σ n_prod · Cp_prod)
//   Excess-air φ adjustment: extra O₂ + N₂ heat sink.

#pragma once

namespace forge::flame {

struct Input {
    double LHV_CH4_kJperKmol;         // 802300 kJ/kmol typical
    double equivalenceRatio_phi;       // 1.0 stoichiometric
    double initialTemperature_C;
};

struct Result {
    double airExcessFraction;
    double productMoles_CO2;
    double productMoles_H2O;
    double productMoles_N2;
    double productMoles_O2;
    double adiabaticFlameTemp_K;
    double adiabaticFlameTemp_C;
};

Result analyse(const Input& in);

}  // namespace forge::flame
