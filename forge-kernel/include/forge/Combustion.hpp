// Forge-259 — Combustion analysis.
//
// Given fuel ultimate analysis (mass fraction of C, H, O, N, S), compute:
//
// Stoichiometric oxygen demand (kg O₂ per kg fuel):
//   m_O2,stoich = (8/3)·C + 8·H + S − O
//
// Stoichiometric air demand (air is 23.2% O₂ by mass):
//   AFR_stoich = m_O2,stoich / 0.232
//
// Actual AFR with excess air λ (λ = 1 → stoichiometric):
//   AFR_actual = λ · AFR_stoich
//
// Flue gas products per kg fuel (CO₂, H₂O, SO₂, N₂, excess O₂):
//   m_CO2  = (44/12)·C
//   m_H2O  = 9·H
//   m_SO2  = 2·S
//   m_N2   = 0.768·AFR_actual + N (fuel N usually negligible)
//   m_O2_excess = (λ − 1)·m_O2,stoich
//
// Dry-basis flue gas composition:
//   m_dry  = m_CO2 + m_SO2 + m_N2 + m_O2_excess
//   %_CO2_dry = m_CO2 / m_dry (mass)
//   %_O2_dry  = m_O2_excess / m_dry

#pragma once

namespace forge::combustion {

struct FuelAnalysis {
    double C;   // mass fraction
    double H;
    double O;
    double N;
    double S;
};

struct Input {
    FuelAnalysis fuel;
    double excessAirRatio;  // λ ≥ 1
};

struct Result {
    double stoichiometricOxygenKgPerKgFuel;
    double stoichiometricAirKgPerKgFuel;     // AFR_stoich (mass)
    double actualAirKgPerKgFuel;             // AFR_actual
    double co2KgPerKgFuel;
    double h2oKgPerKgFuel;
    double so2KgPerKgFuel;
    double n2KgPerKgFuel;
    double excessO2KgPerKgFuel;
    double dryFlueGasKgPerKgFuel;
    double dryCO2MassPct;
    double dryO2MassPct;
    double dryN2MassPct;
};

Result analyse(const Input& in);

}  // namespace forge::combustion
