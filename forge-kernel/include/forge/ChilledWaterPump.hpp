// Forge-320b — Chilled-water pumping power (ASHRAE Fundamentals Ch.3).
//
//   ṁ      = Q_cooling / (c_p · ΔT)        c_p = 4.186 kJ/kg·K water
//   V̇      = ṁ / ρ                          ρ = 1000 kg/m³
//   P_hyd  = ρ · g · V̇ · H                  hydraulic power (W)
//   P_pump = P_hyd / η_pump                 shaft (W)
//   P_elec = P_pump / η_motor               electrical (W)

#pragma once

namespace forge::chwpump {

struct Input {
    double coolingLoadKw;            // Q_cooling
    double designDeltaTKelvin;       // ΔT chilled water (typ 6 K)
    double pumpHeadM;                // H pump head (m H₂O)
    double pumpEfficiency;           // η_pump (0.65-0.85)
    double motorEfficiency;          // η_motor (0.92-0.95)
};

struct Result {
    double massFlowKgPerS;
    double volumeFlowLPerS;
    double hydraulicPowerW;
    double pumpShaftPowerW;
    double electricalPowerW;
    double overallEfficiency;
};

Result analyse(const Input& in);

}  // namespace forge::chwpump
