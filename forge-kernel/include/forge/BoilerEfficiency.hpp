// Forge-262 — Boiler thermal efficiency (Direct + Indirect methods).
//
// Direct method:
//   η_dir = (m_steam · (h_out − h_in)) / (m_fuel · HV)
//
// Indirect method (heat-loss accounting):
//   L₁ Dry flue gas loss     = m_dfg · cp_dfg · (T_flue − T_amb) / HV
//   L₂ Water vapour loss     = m_H2O · (2442 + cp_steam·(T_flue−100)
//                                       − cp_water·(T_amb−25)) / HV
//                           ≈ 9·H · (h_steam at flue T − h_water at ambient) / HV
//   L₃ Radiation/unaccounted = user-supplied % (1-3% typical)
//   η_ind = 100 − (L₁ + L₂ + L₃)
//
// Energy balance check: η_dir vs η_ind agree within ±2-3% in practice.

#pragma once

namespace forge::boilereff {

struct DirectInput {
    double steamFlowKgPerS;
    double feedwaterEnthalpyKjPerKg;
    double steamEnthalpyKjPerKg;
    double fuelFlowKgPerS;
    double heatingValueKjPerKg;   // HHV or LHV depending on convention
};

struct DirectResult {
    double heatOutputKw;
    double heatInputKw;
    double efficiencyPct;
};

DirectResult directMethod(const DirectInput& in);

struct IndirectInput {
    double dryFlueGasKgPerKgFuel;   // from Forge-259
    double moistureKgPerKgFuel;     // 9·H from Forge-259
    double flueGasTempC;
    double ambientTempC;
    double heatingValueKjPerKg;
    double dryFlueGasCpKjPerKgK;    // 1.005 typical for N₂/CO₂ mix
    double radiationLossPct;        // user-supplied
};

struct IndirectResult {
    double dryFlueGasLossPct;
    double waterVapourLossPct;
    double radiationLossPct;
    double totalLossesPct;
    double efficiencyPct;
};

IndirectResult indirectMethod(const IndirectInput& in);

}  // namespace forge::boilereff
