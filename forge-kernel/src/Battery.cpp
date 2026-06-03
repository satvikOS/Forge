// Forge-254 — Battery implementation.

#include "forge/Battery.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge::battery {

RuntimeResult runtime(const RuntimeInput& in) {
    if (in.ratedCapacityAh <= 0.0) throw std::invalid_argument("C_rated must be > 0");
    if (in.ratedHours <= 0.0) throw std::invalid_argument("rated hours must be > 0");
    if (in.peukertExponent < 1.0) throw std::invalid_argument("n must be ≥ 1");
    if (in.loadCurrentA <= 0.0) throw std::invalid_argument("I must be > 0");

    RuntimeResult r{};
    const double C_eff = in.ratedCapacityAh
        * std::pow(in.ratedCapacityAh / (in.loadCurrentA * in.ratedHours),
                    in.peukertExponent - 1.0);
    r.effectiveCapacityAh = C_eff;
    r.runtimeHours = C_eff / in.loadCurrentA;
    return r;
}

ChargeResult chargeTime(const ChargeInput& in) {
    if (in.ratedCapacityAh <= 0.0) throw std::invalid_argument("C_rated must be > 0");
    if (in.chargeCurrentA <= 0.0) throw std::invalid_argument("I_charge must be > 0");
    if (in.initialSoc < 0.0 || in.initialSoc > 1.0
        || in.targetSoc <= in.initialSoc || in.targetSoc > 1.0)
        throw std::invalid_argument("SOC bounds invalid");
    if (in.cvPhaseFactor < 0.0) throw std::invalid_argument("CV factor must be ≥ 0");

    ChargeResult r{};
    const double dSoc = in.targetSoc - in.initialSoc;
    r.constantCurrentHours = dSoc * in.ratedCapacityAh / in.chargeCurrentA;
    r.constantVoltageHours = r.constantCurrentHours * in.cvPhaseFactor;
    r.totalHours = r.constantCurrentHours + r.constantVoltageHours;
    return r;
}

DropResult terminalState(const DropInput& in) {
    if (in.internalResistanceOhm < 0.0)
        throw std::invalid_argument("R_int must be ≥ 0");
    DropResult r{};
    r.dropV = in.loadCurrentA * in.internalResistanceOhm;
    r.terminalVoltageV = in.openCircuitVoltage - r.dropV;
    // Pb-acid linear SOC from OC voltage.
    double soc = (in.openCircuitVoltage - 11.7) / (12.7 - 11.7);
    r.stateOfCharge = std::clamp(soc, 0.0, 1.0);
    return r;
}

}  // namespace forge::battery
