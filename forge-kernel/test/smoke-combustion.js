// Forge-259 — Combustion analysis smoke.
//
// Bituminous coal ultimate: C=0.75, H=0.05, O=0.05, N=0.01, S=0.04, ash=0.10.
// (Mass fractions: C+H+O+N+S = 0.90; ash + moisture make up the rest.)
//
// m_O2,stoich = (8/3)·0.75 + 8·0.05 + 0.04 − 0.05
//             = 2.00 + 0.40 + 0.04 − 0.05 = 2.39 kg/kg fuel
// AFR_stoich = 2.39/0.232 = 10.30 kg air per kg fuel
//
// With λ = 1.20 (20% excess air):
// AFR_actual = 1.20·10.30 = 12.36 kg air per kg fuel
//
// Products:
//   m_CO2 = (44/12)·0.75 = 2.75 kg/kg
//   m_H2O = 9·0.05 = 0.45 kg/kg
//   m_SO2 = 2·0.04 = 0.08 kg/kg
//   m_N2  = 0.768·12.36 + 0.01 = 9.50 kg/kg
//   m_O2_excess = 0.20·2.39 = 0.478 kg/kg
//
// Dry flue gas:
//   m_dry = 2.75 + 0.08 + 9.50 + 0.478 = 12.81 kg/kg
//   %_CO2_dry = 2.75/12.81 = 21.5%
//   %_O2_dry  = 0.478/12.81 = 3.73%
//   %_N2_dry  = 9.50/12.81 = 74.2%

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const r = kernel.combustion.analyse({
  fuel: { C: 0.75, H: 0.05, O: 0.05, N: 0.01, S: 0.04 },
  excessAirRatio: 1.20,
});
console.log(r);

if (!approx(r.stoichiometricOxygenKgPerKgFuel, 2.39, 0.01))
  throw new Error('O₂ stoich off');
if (!approx(r.stoichiometricAirKgPerKgFuel, 10.30, 0.01))
  throw new Error('AFR stoich off');
if (!approx(r.actualAirKgPerKgFuel, 12.36, 0.01))
  throw new Error('AFR actual off');
if (!approx(r.co2KgPerKgFuel, 2.75, 0.01))
  throw new Error('CO₂ off');
if (!approx(r.dryCO2MassPct, 21.5, 0.05))
  throw new Error('%CO₂ dry off');
if (!approx(r.dryO2MassPct, 3.73, 0.05))
  throw new Error('%O₂ dry off');

// Stoichiometric (λ = 1): excess O₂ = 0; dry %O₂ = 0.
const stoic = kernel.combustion.analyse({
  fuel: { C: 0.75, H: 0.05, O: 0.05, N: 0.01, S: 0.04 },
  excessAirRatio: 1.0,
});
if (Math.abs(stoic.excessO2KgPerKgFuel) > 1e-9)
  throw new Error('λ=1 should give zero excess O₂');
if (Math.abs(stoic.dryO2MassPct) > 1e-9)
  throw new Error('λ=1 should give 0% O₂ in flue gas');

console.log('OK — combustion smoke green');
