// Forge-334c — Off-grid PV battery bank sizing (NREL / IEEE 1013 / IEC 61724).
//   Daily energy demand   E_d = Σ (P_i · h_i)            Wh/day
//   Bank A·h corrected:
//     A·h_bank = (E_d · DoA) / (V_sys · DoD · η_inv · K_T · K_age)
//   Plate count = A·h_bank / A·h_cell, series strings = V_sys / V_cell.

#pragma once

namespace forge::pvbatt {

struct Input {
    double dailyLoadWh;            // E_d
    double systemVoltage_V;        // V_sys (12/24/48)
    double daysOfAutonomy;         // DoA (2–5 typ)
    double depthOfDischarge;       // DoD (0.5 lead-acid, 0.8 LiFePO4)
    double inverterEfficiency;     // η_inv (0.90 typical)
    double temperatureDerate;      // K_T (0.95 typ for 25 °C, lower for cold)
    double ageingDerate;           // K_age (0.80–0.95 EOL)
    double singleCellAh;           // per cell
    double singleCellV;            // 2.0 lead-acid, 3.2 LiFePO4
};

struct Result {
    double bankCapacity_Ah;
    double bankCapacity_kWh;
    int    seriesStringSize;
    int    parallelStringCount;
    int    totalCellCount;
    double effectiveAutonomyHours;
};

Result analyse(const Input& in);

}  // namespace forge::pvbatt
