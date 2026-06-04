// Forge-322c — Galvanic sacrificial-anode cathodic protection sizing
// (NACE SP0169 / Peabody Ch.7).
//   I_protect = i_density · A_steel
//   m_anode   = I · t·hours / (η_util · c_kg_per_A_yr · 1/8760)
//              = (I [A] · life [yr] · k [kg/A·yr]) / η_util

#pragma once

namespace forge::cp {

struct Input {
    double protectedAreaM2;
    double currentDensityMaPerM2;       // 50 mA/m² steel-in-soil typical
    double designLifeYears;
    double anodeConsumptionKgPerAmpYr;  // Zn 11.9, Mg 7.6, Al 3.3
    double anodeUtilizationFactor;      // 0.85 typical
};

struct Result {
    double totalCurrentRequiredA;
    double anodeMassRequiredKg;
    double currentDensityMaPerM2Echo;
};

Result analyse(const Input& in);

}  // namespace forge::cp
