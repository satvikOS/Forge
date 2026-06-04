// Forge-320b — see header.

#include "forge/ChilledWaterPump.hpp"

#include <stdexcept>

namespace forge::chwpump {

Result analyse(const Input& in) {
    if (in.coolingLoadKw <= 0.0)
        throw std::runtime_error("coolingLoadKw must be > 0");
    if (in.designDeltaTKelvin <= 0.0)
        throw std::runtime_error("designDeltaTKelvin must be > 0");
    if (in.pumpHeadM <= 0.0)
        throw std::runtime_error("pumpHeadM must be > 0");
    if (in.pumpEfficiency <= 0.0 || in.pumpEfficiency > 1.0)
        throw std::runtime_error("pumpEfficiency must be in (0, 1]");
    if (in.motorEfficiency <= 0.0 || in.motorEfficiency > 1.0)
        throw std::runtime_error("motorEfficiency must be in (0, 1]");

    constexpr double cp_water = 4.186;     // kJ/kg·K
    constexpr double rho      = 1000.0;
    constexpr double g        = 9.80665;

    const double m_dot   = in.coolingLoadKw / (cp_water * in.designDeltaTKelvin);   // kg/s
    const double V_dot   = m_dot / rho;                                              // m³/s
    const double P_hyd   = rho * g * V_dot * in.pumpHeadM;                          // W
    const double P_pump  = P_hyd / in.pumpEfficiency;
    const double P_elec  = P_pump / in.motorEfficiency;

    Result r;
    r.massFlowKgPerS      = m_dot;
    r.volumeFlowLPerS     = V_dot * 1000.0;
    r.hydraulicPowerW     = P_hyd;
    r.pumpShaftPowerW     = P_pump;
    r.electricalPowerW    = P_elec;
    r.overallEfficiency   = in.pumpEfficiency * in.motorEfficiency;
    return r;
}

}  // namespace forge::chwpump
