#include "forge/AdiabaticFlame.hpp"

#include <stdexcept>

namespace forge::flame {

Result analyse(const Input& in) {
    if (in.LHV_CH4_kJperKmol <= 0)        throw std::runtime_error("LHV > 0");
    if (in.equivalenceRatio_phi <= 0)     throw std::runtime_error("φ > 0");
    if (in.initialTemperature_C < -273.15) throw std::runtime_error("T_init >= 0 K");

    const double T_init_K = in.initialTemperature_C + 273.15;

    // φ = 1 → stoichiometric.  φ < 1 → lean (excess air).  φ > 1 → rich (excess CH4).
    // For each mole of fuel burnt:
    //   moles air supplied = 2 · (4.76) / φ                (where 2 mol O2 + 7.52 mol N2 per mol CH4)
    //   moles O2 supplied = 2 / φ
    //   moles N2 supplied = 7.52 / φ
    const double n_O2_supplied = 2.0 / in.equivalenceRatio_phi;
    const double n_N2          = 7.52 / in.equivalenceRatio_phi;
    const double airExcess = (in.equivalenceRatio_phi <= 1.0)
                           ? (1.0 / in.equivalenceRatio_phi - 1.0)
                           : 0.0;
    // Combustion (assumed complete; for φ ≤ 1 all CH4 burns; for φ > 1 cap by O2):
    const double n_CH4_burned = (in.equivalenceRatio_phi <= 1.0) ? 1.0 : n_O2_supplied / 2.0;
    const double n_CO2 = 1.0 * n_CH4_burned;
    const double n_H2O = 2.0 * n_CH4_burned;
    const double n_O2_leftover = n_O2_supplied - 2.0 * n_CH4_burned;

    // Cp mean (kJ/kmol·K) at ~1500–2200 K (approximate constants).
    constexpr double Cp_CO2 = 56.0;
    constexpr double Cp_H2O = 47.0;
    constexpr double Cp_N2  = 33.0;
    constexpr double Cp_O2  = 36.0;

    const double sum_nCp = n_CO2 * Cp_CO2 + n_H2O * Cp_H2O + n_N2 * Cp_N2 + n_O2_leftover * Cp_O2;
    const double heatRelease = n_CH4_burned * in.LHV_CH4_kJperKmol;
    const double dT = heatRelease / sum_nCp;
    const double T_ad_K = T_init_K + dT;

    Result r;
    r.airExcessFraction      = airExcess;
    r.productMoles_CO2       = n_CO2;
    r.productMoles_H2O       = n_H2O;
    r.productMoles_N2        = n_N2;
    r.productMoles_O2        = n_O2_leftover;
    r.adiabaticFlameTemp_K   = T_ad_K;
    r.adiabaticFlameTemp_C   = T_ad_K - 273.15;
    return r;
}

}  // namespace forge::flame
