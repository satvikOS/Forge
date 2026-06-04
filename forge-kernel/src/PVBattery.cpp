#include "forge/PVBattery.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::pvbatt {

Result analyse(const Input& in) {
    if (in.dailyLoadWh <= 0)        throw std::runtime_error("E_d > 0");
    if (in.systemVoltage_V <= 0)    throw std::runtime_error("V_sys > 0");
    if (in.daysOfAutonomy <= 0)     throw std::runtime_error("DoA > 0");
    if (in.depthOfDischarge <= 0 || in.depthOfDischarge > 1)
        throw std::runtime_error("DoD in (0, 1]");
    if (in.inverterEfficiency <= 0 || in.inverterEfficiency > 1)
        throw std::runtime_error("η_inv in (0, 1]");
    if (in.temperatureDerate <= 0 || in.temperatureDerate > 1)
        throw std::runtime_error("K_T in (0, 1]");
    if (in.ageingDerate <= 0 || in.ageingDerate > 1)
        throw std::runtime_error("K_age in (0, 1]");
    if (in.singleCellAh <= 0)       throw std::runtime_error("Ah/cell > 0");
    if (in.singleCellV <= 0)        throw std::runtime_error("V/cell > 0");

    const double denom = in.systemVoltage_V
                       * in.depthOfDischarge
                       * in.inverterEfficiency
                       * in.temperatureDerate
                       * in.ageingDerate;
    const double Ah_bank = in.dailyLoadWh * in.daysOfAutonomy / denom;
    const double kWh_bank = Ah_bank * in.systemVoltage_V / 1000.0;

    const int series = static_cast<int>(std::ceil(in.systemVoltage_V / in.singleCellV));
    const int parallel = static_cast<int>(std::ceil(Ah_bank / in.singleCellAh));
    const int total = series * parallel;
    const double effectiveHours = Ah_bank * in.systemVoltage_V * in.depthOfDischarge
                                * in.inverterEfficiency / in.dailyLoadWh * 24.0;

    Result r;
    r.bankCapacity_Ah         = Ah_bank;
    r.bankCapacity_kWh        = kWh_bank;
    r.seriesStringSize        = series;
    r.parallelStringCount     = parallel;
    r.totalCellCount          = total;
    r.effectiveAutonomyHours  = effectiveHours;
    return r;
}

}  // namespace forge::pvbatt
