// Forge-340d — Arc welding heat input (AWS D1.1 §3.6 / Kou §2.3).
//   HI = η · V · I / v             V volts, I amps, v travel mm/s → J/mm
//   Convert to kJ/mm by /1000.
//   Cooling time t_8/5 (Adams/Rosenthal — thin plate):
//     t_8/5 = (HI/(2·π·k·t_plate²)) · ((1/(500-T0))² − (1/(800-T0))²) − approximation.
//   HAZ peak temperature decays with distance.

#pragma once

namespace forge::weldhi {

struct Input {
    double arcEfficiency_eta;     // 0.7 SMAW, 0.8 GMAW, 0.9 SAW, 0.7 GTAW
    double voltage_V;
    double current_A;
    double travelSpeed_mmPerS;
    double plateThickness_mm;     // for cooling rate
    double preheatTemp_C;         // T_0
    double thermalConductivity_k_WmK;
    double densityRho_kgM3;
    double specificHeat_cp_JkgK;
};

struct Result {
    double heatInput_kJperMm;
    double tEightFive_s;          // 800→500 °C cooling time, thin-plate Rosenthal
    double maxHAZWidthEstimate_mm;
    double thermalCycleSeverity;  // qualitative HI / (k·thickness)
};

Result analyse(const Input& in);

}  // namespace forge::weldhi
