// Forge-255 — Solar PV array sizing (NABCEP / IEEE 1547).
//
// Off-grid system sizing chain:
//   E_dc_required (Wh/day) = E_load_ac / (η_inverter · η_battery)
//   Array W_p             = E_dc_required / (PSH · η_array_losses)
//   N_panels              = ceil(W_p / W_p_per_panel)
//
// Battery bank:
//   E_storage_Wh = E_load_ac · autonomy_days / DoD
//   C_battery_Ah = E_storage_Wh / V_battery_bank
//
// Inverter: VA = E_load_peak_kW / pf
//
// Grid-tie: skip battery; PV size = daily AC load / (PSH · η_total).

#pragma once

namespace forge::solarpv {

struct ArrayInput {
    double dailyEnergyAcWh;       // E_load (Wh AC)
    double peakSunHours;          // PSH per day at design location
    double panelWattPeak;         // STC Wp per panel
    double inverterEfficiency;    // η_inverter ∈ (0, 1]
    double batteryEfficiency;     // η_battery ∈ (0, 1] (use 1.0 for grid-tie)
    double arrayDeratingFactor;   // soiling+temp+mismatch (0.7 typical)
};

struct ArrayResult {
    double requiredArrayPowerWp;
    int    numberOfPanels;
    double installedArrayPowerWp;
};

ArrayResult sizeArray(const ArrayInput& in);

struct BatteryInput {
    double dailyEnergyAcWh;
    double autonomyDays;
    double depthOfDischarge;       // 0.5 lead-acid; 0.8 Li-ion
    double batteryBankVoltage;     // 12 / 24 / 48 V
    double batteryEfficiency;
};

struct BatteryResult {
    double storageEnergyWh;
    double batteryCapacityAh;
};

BatteryResult sizeBatteryBank(const BatteryInput& in);

struct InverterInput {
    double peakAcLoadW;
    double powerFactor;            // for VA sizing
    double sizingFactor;            // 1.25 typical safety
};

double sizeInverterVA(const InverterInput& in);

}  // namespace forge::solarpv
