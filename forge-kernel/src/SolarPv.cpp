// Forge-255 — Solar PV array sizing implementation.

#include "forge/SolarPv.hpp"

#include <cmath>
#include <stdexcept>

namespace forge::solarpv {

ArrayResult sizeArray(const ArrayInput& in) {
    if (in.dailyEnergyAcWh <= 0.0)
        throw std::invalid_argument("daily energy must be > 0");
    if (in.peakSunHours <= 0.0)
        throw std::invalid_argument("peak sun hours must be > 0");
    if (in.panelWattPeak <= 0.0)
        throw std::invalid_argument("panel Wp must be > 0");
    if (in.inverterEfficiency <= 0.0 || in.inverterEfficiency > 1.0)
        throw std::invalid_argument("η_inv in (0, 1]");
    if (in.batteryEfficiency <= 0.0 || in.batteryEfficiency > 1.0)
        throw std::invalid_argument("η_batt in (0, 1]");
    if (in.arrayDeratingFactor <= 0.0 || in.arrayDeratingFactor > 1.0)
        throw std::invalid_argument("array derate must be in (0, 1]");

    ArrayResult r{};
    const double E_dc = in.dailyEnergyAcWh
                      / (in.inverterEfficiency * in.batteryEfficiency);
    r.requiredArrayPowerWp = E_dc
                           / (in.peakSunHours * in.arrayDeratingFactor);
    const double N_exact = r.requiredArrayPowerWp / in.panelWattPeak;
    r.numberOfPanels = static_cast<int>(std::ceil(N_exact));
    if (r.numberOfPanels < 1) r.numberOfPanels = 1;
    r.installedArrayPowerWp = r.numberOfPanels * in.panelWattPeak;
    return r;
}

BatteryResult sizeBatteryBank(const BatteryInput& in) {
    if (in.dailyEnergyAcWh <= 0.0)
        throw std::invalid_argument("daily energy must be > 0");
    if (in.autonomyDays <= 0.0)
        throw std::invalid_argument("autonomy days must be > 0");
    if (in.depthOfDischarge <= 0.0 || in.depthOfDischarge > 1.0)
        throw std::invalid_argument("DoD in (0, 1]");
    if (in.batteryBankVoltage <= 0.0)
        throw std::invalid_argument("battery bank V must be > 0");
    if (in.batteryEfficiency <= 0.0 || in.batteryEfficiency > 1.0)
        throw std::invalid_argument("η_batt in (0, 1]");

    BatteryResult r{};
    r.storageEnergyWh = in.dailyEnergyAcWh * in.autonomyDays
                      / (in.depthOfDischarge * in.batteryEfficiency);
    r.batteryCapacityAh = r.storageEnergyWh / in.batteryBankVoltage;
    return r;
}

double sizeInverterVA(const InverterInput& in) {
    if (in.peakAcLoadW <= 0.0)
        throw std::invalid_argument("peak AC load must be > 0");
    if (in.powerFactor <= 0.0 || in.powerFactor > 1.0)
        throw std::invalid_argument("pf in (0, 1]");
    if (in.sizingFactor <= 0.0)
        throw std::invalid_argument("sizing factor must be > 0");
    return in.peakAcLoadW * in.sizingFactor / in.powerFactor;
}

}  // namespace forge::solarpv
