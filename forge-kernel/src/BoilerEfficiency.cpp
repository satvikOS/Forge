// Forge-262 — Boiler efficiency implementation.

#include "forge/BoilerEfficiency.hpp"

#include <stdexcept>

namespace forge::boilereff {

DirectResult directMethod(const DirectInput& in) {
    if (in.steamFlowKgPerS <= 0.0)
        throw std::invalid_argument("steam flow must be > 0");
    if (in.fuelFlowKgPerS <= 0.0)
        throw std::invalid_argument("fuel flow must be > 0");
    if (in.heatingValueKjPerKg <= 0.0)
        throw std::invalid_argument("HV must be > 0");
    if (in.steamEnthalpyKjPerKg <= in.feedwaterEnthalpyKjPerKg)
        throw std::invalid_argument("h_steam must exceed h_feedwater");

    DirectResult r{};
    r.heatOutputKw = in.steamFlowKgPerS
                   * (in.steamEnthalpyKjPerKg - in.feedwaterEnthalpyKjPerKg);
    r.heatInputKw  = in.fuelFlowKgPerS * in.heatingValueKjPerKg;
    r.efficiencyPct = 100.0 * r.heatOutputKw / r.heatInputKw;
    return r;
}

IndirectResult indirectMethod(const IndirectInput& in) {
    if (in.dryFlueGasKgPerKgFuel < 0.0)
        throw std::invalid_argument("m_dfg must be ≥ 0");
    if (in.moistureKgPerKgFuel < 0.0)
        throw std::invalid_argument("m_H2O must be ≥ 0");
    if (in.heatingValueKjPerKg <= 0.0)
        throw std::invalid_argument("HV must be > 0");
    if (in.dryFlueGasCpKjPerKgK <= 0.0)
        throw std::invalid_argument("cp_dfg must be > 0");
    if (in.radiationLossPct < 0.0 || in.radiationLossPct > 50.0)
        throw std::invalid_argument("radiation loss must be in [0, 50]");

    IndirectResult r{};
    const double dT = in.flueGasTempC - in.ambientTempC;
    r.dryFlueGasLossPct = 100.0
        * (in.dryFlueGasKgPerKgFuel * in.dryFlueGasCpKjPerKgK * dT)
        / in.heatingValueKjPerKg;

    // Water-vapour energy: ≈ 2442 kJ/kg (latent at 25°C) +
    //   superheat cp_steam·(T_flue − 100) (≈ 1.88 kJ/kg·K) +
    //   sensible above ambient cp_water·(25 − T_amb).
    const double cpSteam = 1.88;
    const double cpWater = 4.186;
    const double latent  = 2442.0;
    const double moistureEnergy = latent
                                + cpSteam * (in.flueGasTempC - 100.0)
                                - cpWater * (in.ambientTempC - 25.0);
    r.waterVapourLossPct = 100.0
        * (in.moistureKgPerKgFuel * moistureEnergy)
        / in.heatingValueKjPerKg;

    r.radiationLossPct = in.radiationLossPct;
    r.totalLossesPct = r.dryFlueGasLossPct + r.waterVapourLossPct
                      + r.radiationLossPct;
    r.efficiencyPct = 100.0 - r.totalLossesPct;
    return r;
}

}  // namespace forge::boilereff
