// Forge-294 — implementation; see header for derivation references.

#include "forge/AirFilter.hpp"

#include <stdexcept>

namespace forge::airfilter {

Result analyse(const Input& in) {
    if (in.flowRateM3S <= 0.0)
        throw std::runtime_error("flowRateM3S must be > 0");
    if (in.faceAreaM2 <= 0.0)
        throw std::runtime_error("faceAreaM2 must be > 0");
    if (in.initialPressureDropPa <= 0.0)
        throw std::runtime_error("initialPressureDropPa must be > 0");
    if (in.finalPressureDropPa < in.initialPressureDropPa)
        throw std::runtime_error("finalPressureDropPa must be ≥ initialPressureDropPa");
    if (in.runHours <= 0.0)
        throw std::runtime_error("runHours must be > 0");
    if (in.fanEfficiency <= 0.0 || in.fanEfficiency > 1.0)
        throw std::runtime_error("fanEfficiency must be in (0, 1]");
    if (in.electricityRatePerKWh < 0.0)
        throw std::runtime_error("electricityRatePerKWh must be ≥ 0");

    const double v = in.flowRateM3S / in.faceAreaM2;
    const double dp_avg = (in.initialPressureDropPa + in.finalPressureDropPa) / 2.0;
    const double P = dp_avg * in.flowRateM3S / in.fanEfficiency;  // W
    const double E_kWh = P * in.runHours / 1000.0;
    const double cost = E_kWh * in.electricityRatePerKWh;

    Result r;
    r.faceVelocityMs        = v;
    r.faceVelocityInRange   = (v > 0.5 && v < 2.5);
    r.averagePressureDropPa = dp_avg;
    r.fanPowerW             = P;
    r.energyKWh             = E_kWh;
    r.energyCost            = cost;
    return r;
}

}  // namespace forge::airfilter
