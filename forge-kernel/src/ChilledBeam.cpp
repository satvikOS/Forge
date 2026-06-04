#include "forge/ChilledBeam.hpp"

#include <stdexcept>

namespace forge::chbeam {

Result analyse(const Input& in) {
    if (in.zoneTemp_C <= -50)                throw std::runtime_error("T_zone valid");
    if (in.primaryAirTemp_C >= in.zoneTemp_C) throw std::runtime_error("T_pa < T_zone");
    if (in.primaryAirFlow_LperS <= 0)        throw std::runtime_error("ṁ_pa > 0");
    if (in.chilledWaterFlow_LperMin < 0)     throw std::runtime_error("ṁ_w >= 0");
    if (in.chilledWaterOut_C <= in.chilledWaterIn_C)
        throw std::runtime_error("T_w,out > T_w,in");
    if (in.inductionRatio_Ki <= 0)           throw std::runtime_error("K_i > 0");
    if (in.zoneArea_m2 <= 0)                 throw std::runtime_error("A > 0");
    if (in.occupantCount < 0)                throw std::runtime_error("occ >= 0");

    constexpr double rho_air = 1.20;       // kg/m³
    constexpr double cp_air  = 1.005;      // kJ/kg·K
    constexpr double rho_water = 999.0;
    constexpr double cp_water = 4.186;

    const double m_pa = in.primaryAirFlow_LperS * 1.0e-3 * rho_air;          // kg/s
    const double Q_pa_kW = m_pa * cp_air * (in.zoneTemp_C - in.primaryAirTemp_C);

    const double m_w = in.chilledWaterFlow_LperMin / 60.0 * 1.0e-3 * rho_water;
    const double Q_coil_kW = m_w * cp_water * (in.chilledWaterOut_C - in.chilledWaterIn_C);
    const double Q_total = Q_pa_kW + Q_coil_kW;

    // ASHRAE 62.1 VRP simplified: 5 L/s·person + 0.6 L/s·m² (R_p / R_a defaults).
    const double oa_required = 5.0 * in.occupantCount + 0.6 * in.zoneArea_m2;
    const double compl_ratio = in.primaryAirFlow_LperS / oa_required;

    Result r;
    r.primaryAirSensible_kW    = Q_pa_kW;
    r.coilSensible_kW          = Q_coil_kW;
    r.totalCooling_kW          = Q_total;
    r.requiredOutsideAir_LperS = oa_required;
    r.oaCompliance             = compl_ratio;
    r.meetsOA                  = compl_ratio >= 1.0;
    return r;
}

}  // namespace forge::chbeam
