// Forge-262 — Boiler efficiency smoke.
//
// Direct method: m_steam = 5 kg/s, h_in = 100 kJ/kg, h_out = 2780 kJ/kg
// (saturated steam ~10 bar), m_fuel = 0.4 kg/s, HV = 42 MJ/kg.
//   Q_out = 5·(2780−100) = 13,400 kW
//   Q_in  = 0.4·42000 = 16,800 kW
//   η = 13400/16800 = 0.798 = 79.8%
//
// Indirect method: m_dfg = 12 kg/kg, m_H2O = 0.45 kg/kg,
// T_flue = 250°C, T_amb = 25°C, HV = 42000 kJ/kg,
// cp_dfg = 1.005, radiation 2%.
//   L1 = 100·12·1.005·(250−25)/42000 = 100·2713.5/42000 = 6.46%
//   L2 = moistureEnergy = 2442 + 1.88·(250−100) − 4.186·(25−25)
//                       = 2442 + 282 = 2724 kJ/kg
//        = 100·0.45·2724/42000 = 100·1225.8/42000 = 2.92%
//   L3 = 2%
//   total = 11.38%
//   η = 100 − 11.38 = 88.62%

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const dir = kernel.boilereff.directMethod({
  steamFlowKgPerS: 5, feedwaterEnthalpyKjPerKg: 100,
  steamEnthalpyKjPerKg: 2780, fuelFlowKgPerS: 0.4,
  heatingValueKjPerKg: 42000,
});
console.log('direct:', dir);
if (!approx(dir.heatOutputKw, 13400, 0.001)) throw new Error('Q_out off');
if (!approx(dir.heatInputKw, 16800, 0.001))  throw new Error('Q_in off');
if (!approx(dir.efficiencyPct, 79.76, 0.01)) throw new Error('η_direct off');

const ind = kernel.boilereff.indirectMethod({
  dryFlueGasKgPerKgFuel: 12, moistureKgPerKgFuel: 0.45,
  flueGasTempC: 250, ambientTempC: 25,
  heatingValueKjPerKg: 42000,
  dryFlueGasCpKjPerKgK: 1.005,
  radiationLossPct: 2.0,
});
console.log('indirect:', ind);
if (!approx(ind.dryFlueGasLossPct, 6.46, 0.01)) throw new Error('L1 off');
if (!approx(ind.waterVapourLossPct, 2.92, 0.02)) throw new Error('L2 off');
if (!approx(ind.totalLossesPct, 11.38, 0.02))   throw new Error('total off');
if (!approx(ind.efficiencyPct, 88.62, 0.01))    throw new Error('η_indirect off');

console.log('OK — boilereff smoke green');
