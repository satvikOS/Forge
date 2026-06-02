#pragma once

// Forge-180 — Cradle-to-gate carbon footprint (LCA).
//
// Per-body kgCO2e accounting from raw material extraction, manufacturing
// energy, transport, and end-of-life recycling credit:
//
//   material   = mass_kg × co2_per_kg                 (ecoinvent-style)
//   manuf      = energy_kwh × grid_carbon_intensity
//                where energy_kwh ≈ (machining_min × spindle_kW × η⁻¹) / 60
//   transport  = mass_kg × distance_km × emissions_per_tkm
//   eol_credit = -recycled_fraction × mass × material_avoided_co2
//   total      = material + manuf + transport + eol_credit

#include <cstdint>
#include <string>
#include <vector>

namespace forge { namespace carbon {

struct LcaMaterial {
    std::string name;
    double densityKgM3;
    double co2PerKg;             // kg CO2e per kg material (cradle-to-gate)
    double recycledContent;      // 0..1, current recycled fraction in the supply
    double recyclingCredit;      // 0..1, credit retained at end-of-life
};

struct LcaProcess {
    std::string name;
    double spindleKW;            // average spindle draw
    double overheadFactor;       // multiplier for cooling/dust/chip handling
};

struct LcaInputs {
    LcaMaterial material;
    LcaProcess  process;
    double      volumeCm3;       // finished
    double      stockVolumeCm3;
    double      machiningTimeMin;
    double      gridCo2PerKwh;   // kg CO2e per kWh (varies 0.05 NO → 0.95 IN)
    double      transportKm;
    double      transportEmissionsPerTkm;   // kg CO2e per (t × km), truck ≈ 0.062
    int         qty;
};

struct LcaResult {
    double massKg;
    double unitMaterialKgCo2;
    double unitManufKgCo2;
    double unitTransportKgCo2;
    double unitRecyclingCreditKgCo2;   // negative
    double unitTotalKgCo2;
    double batchTotalKgCo2;
    double energyKwh;
};

LcaResult computeLca(const LcaInputs& in);

}} // namespace forge::carbon
