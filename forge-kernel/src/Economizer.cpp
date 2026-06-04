#include "forge/Economizer.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::econ {

static double humidityRatio(double Tdb_C, double Twb_C, double pAtm_kPa) {
    // Simplified: at Twb, w_s_wb from Magnus.
    auto pws = [](double T) {
        return 0.6108 * std::exp(17.27 * T / (T + 237.3));   // kPa
    };
    const double p_wb = pws(Twb_C);
    const double w_s_wb = 0.622 * p_wb / (pAtm_kPa - p_wb);
    const double Cpa = 1.006, Cpw = 1.86, h_fg0 = 2501.0;
    return ((h_fg0 - (Cpw - 4.186) * Twb_C) * w_s_wb
          - Cpa * (Tdb_C - Twb_C))
         / (h_fg0 + Cpw * Tdb_C - 4.186 * Twb_C);
}

static double enthalpy(double Tdb_C, double w) {
    const double Cpa = 1.006, Cpw = 1.86, h_fg0 = 2501.0;
    return Cpa * Tdb_C + w * (h_fg0 + Cpw * Tdb_C);
}

Result analyse(const Input& in) {
    if (in.airMassFlow_kgPerS <= 0)   throw std::runtime_error("ṁ > 0");
    if (in.minimumOAfraction < 0 || in.minimumOAfraction > 1)
        throw std::runtime_error("min OA in [0,1]");
    if (in.highLimitT_C <= 0)         throw std::runtime_error("high T > 0");
    if (in.highLimitH_kJperKg <= 0)   throw std::runtime_error("high h > 0");
    if (in.controlType < 0 || in.controlType > 1) throw std::runtime_error("ctl 0/1");

    constexpr double pAtm = 101.325;
    const double w_oa  = humidityRatio(in.oaDryBulb_C, in.oaWetBulb_C, pAtm);
    const double w_ret = humidityRatio(in.returnDryBulb_C, in.returnWetBulb_C, pAtm);
    const double h_oa  = enthalpy(in.oaDryBulb_C, w_oa);
    const double h_ret = enthalpy(in.returnDryBulb_C, w_ret);

    bool active = false;
    if (in.controlType == 0) {
        active = (in.oaDryBulb_C < in.returnDryBulb_C) && (in.oaDryBulb_C < in.highLimitT_C);
    } else {
        active = (h_oa < h_ret) && (h_oa < in.highLimitH_kJperKg);
    }

    const double x_oa = active ? 1.0 : in.minimumOAfraction;
    const double h_m  = x_oa * h_oa + (1.0 - x_oa) * h_ret;
    const double Q_free_kW = in.airMassFlow_kgPerS * (h_ret - h_m);

    Result r;
    r.oaEnthalpy_kJperKg      = h_oa;
    r.returnEnthalpy_kJperKg  = h_ret;
    r.recommendedOAfraction   = x_oa;
    r.mixedEnthalpy_kJperKg   = h_m;
    r.freeCoolingCapacity_kW  = Q_free_kW;
    r.economizerActive        = active;
    return r;
}

}  // namespace forge::econ
