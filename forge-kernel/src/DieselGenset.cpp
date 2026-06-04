// Forge-320c — see header.

#include "forge/DieselGenset.hpp"

#include <algorithm>
#include <stdexcept>

namespace forge::genset {

Result analyse(const Input& in) {
    if (in.connectedLoadKw <= 0.0)
        throw std::runtime_error("connectedLoadKw must be > 0");
    if (in.diversityFactor <= 0.0 || in.diversityFactor > 1.0)
        throw std::runtime_error("diversityFactor must be in (0, 1]");
    if (in.powerFactor <= 0.0 || in.powerFactor > 1.0)
        throw std::runtime_error("powerFactor must be in (0, 1]");
    if (in.altitudeM < 0.0)
        throw std::runtime_error("altitudeM must be ≥ 0");
    if (in.ambientTempC < -50.0)
        throw std::runtime_error("ambientTempC must be ≥ -50");
    if (in.fuelConsumptionLPerKwh <= 0.0)
        throw std::runtime_error("fuelConsumptionLPerKwh must be > 0");
    if (in.designRuntimeHr < 0.0)
        throw std::runtime_error("designRuntimeHr must be ≥ 0");

    const double altDer  = 1.0 - 0.01 * std::max(0.0, (in.altitudeM   - 1000.0) / 100.0);
    const double tempDer = 1.0 - 0.01 * std::max(0.0, (in.ambientTempC - 40.0) / 5.0);
    const double altClamped  = std::max(0.5, altDer);
    const double tempClamped = std::max(0.5, tempDer);

    const double demand = in.connectedLoadKw * in.diversityFactor / in.powerFactor;   // kVA at sea level 40 °C
    const double sized = demand / (altClamped * tempClamped);

    // Fuel: use sized·pf to get kW, times fuel per kWh, times runtime
    const double fuelL = sized * in.powerFactor * in.fuelConsumptionLPerKwh * in.designRuntimeHr;

    Result r;
    r.altitudeDerateFactor   = altClamped;
    r.temperatureDerateFactor= tempClamped;
    r.demandKvaRaw           = demand;
    r.requiredKvaNameplate   = sized;
    r.fuelTankLiters         = fuelL;
    return r;
}

}  // namespace forge::genset
