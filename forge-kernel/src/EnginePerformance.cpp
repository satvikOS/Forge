#include "forge/EnginePerformance.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::engperf {

Result analyse(const Input& in) {
    if (in.displacement_L <= 0)          throw std::runtime_error("V_d > 0");
    if (in.speed_rpm <= 0)               throw std::runtime_error("n > 0");
    if (in.brakeTorque_Nm <= 0)          throw std::runtime_error("T > 0");
    if (in.fuelMassFlow_kgPerH <= 0)     throw std::runtime_error("ṁ_f > 0");
    if (in.airMassFlow_kgPerH <= 0)      throw std::runtime_error("ṁ_a > 0");
    if (in.airDensity_kgM3 <= 0)         throw std::runtime_error("ρ_a > 0");
    if (in.stroke_mm <= 0)               throw std::runtime_error("L > 0");
    if (in.cycleType < 0 || in.cycleType > 1) throw std::runtime_error("cycle 0/1");

    const double V_d_m3 = in.displacement_L * 1.0e-3;
    const double n_rev_s = in.speed_rpm / 60.0;
    const double n_R = in.cycleType == 0 ? 2.0 : 1.0;
    const double L_m = in.stroke_mm * 1.0e-3;

    const double bmep_Pa   = (2.0 * M_PI * in.brakeTorque_Nm * n_R) / V_d_m3;
    const double P_b_W     = 2.0 * M_PI * n_rev_s * in.brakeTorque_Nm;
    const double P_b_kW    = P_b_W / 1000.0;
    const double bsfc      = (in.fuelMassFlow_kgPerH * 1000.0) / P_b_kW;       // g / kW·h
    const double ma_kgPerS = in.airMassFlow_kgPerH / 3600.0;
    const double mf_kgPerS = in.fuelMassFlow_kgPerH / 3600.0;
    const double eta_v     = (ma_kgPerS * n_R) / (in.airDensity_kgM3 * V_d_m3 * n_rev_s);
    const double vp_mean   = 2.0 * L_m * n_rev_s;
    const double afr       = ma_kgPerS / mf_kgPerS;

    Result r;
    r.bmep_kPa                 = bmep_Pa / 1000.0;
    r.brakePower_kW            = P_b_kW;
    r.bsfc_g_per_kWh           = bsfc;
    r.volumetricEfficiency     = eta_v;
    r.meanPistonSpeed_mPerS    = vp_mean;
    r.airFuelRatio             = afr;
    return r;
}

}  // namespace forge::engperf
