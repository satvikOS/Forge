#include "forge/HeatPump.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::heatpump {

Result analyse(const Input& in) {
    const double T_H = in.sinkTemp_C + 273.15;
    const double T_C = in.sourceTemp_C + 273.15;
    if (T_H <= T_C)                                   throw std::runtime_error("T_H > T_C");
    if (in.secondLawEfficiency <= 0 || in.secondLawEfficiency > 1)
        throw std::runtime_error("η_2nd in (0, 1]");
    if (in.compressorPower_kW <= 0)                   throw std::runtime_error("W_in > 0");
    if (in.mode < 0 || in.mode > 1)                   throw std::runtime_error("mode 0/1");

    const double dT = T_H - T_C;
    const double cop_HP_carnot   = T_H / dT;
    const double cop_COOL_carnot = T_C / dT;
    const double cop_carnot      = in.mode == 0 ? cop_HP_carnot : cop_COOL_carnot;
    const double cop_actual      = cop_carnot * in.secondLawEfficiency;
    const double eer             = cop_actual * 3.412;
    const double capacity        = cop_actual * in.compressorPower_kW;

    // Energy balance sanity Q_H − Q_C − W ≈ 0.
    const double cop_other_actual =
        (in.mode == 0 ? cop_COOL_carnot : cop_HP_carnot) * in.secondLawEfficiency;
    const double Q_other = cop_other_actual * in.compressorPower_kW;
    const double waste = std::abs(capacity - Q_other - (in.mode == 0 ? in.compressorPower_kW : -in.compressorPower_kW));

    Result r;
    r.cop_carnot      = cop_carnot;
    r.cop_actual      = cop_actual;
    r.eer_btuhPerW    = eer;
    r.capacity_kW     = capacity;
    r.waste_kW        = waste;
    return r;
}

}  // namespace forge::heatpump
