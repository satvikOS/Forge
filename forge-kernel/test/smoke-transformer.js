// Forge-245 — Transformer smoke (Chapman/Theraja textbook).
//
// 50 kVA, 11000/415 V, 50 Hz single-phase.
//
// OC (LV side): V_oc = 415 V, I_oc = 5 A, P_oc = 250 W.
//   cosφ = 250/(415·5) = 0.12048
//   I_c = 5·0.12048 = 0.6024 A; R_c = 415/0.6024 = 689.0 Ω (referred to LV)
//   I_m = 5·sinφ = 5·√(1−0.12²) = 5·0.9927 = 4.964 A; X_m = 415/4.964 = 83.6 Ω
//
// SC (HV side, rated I = 50000/11000 = 4.545 A):
//   V_sc = 400 V, I_sc = 4.545 A, P_sc = 800 W.
//   R_eq = 800/4.545² = 800/20.66 = 38.72 Ω (HV)
//   Z_eq = 400/4.545 = 88.0 Ω
//   X_eq = √(88² − 38.72²) = √(7744 − 1499) = √6245 = 79.02 Ω
//
// Voltage regulation at full load (x=1), pf=0.8 lag, HV side:
//   I_L = 4.545 A; V_rated = 11000 V
//   ΔV = 4.545·(38.72·0.8 + 79.02·0.6) = 4.545·(30.98 + 47.41) = 4.545·78.39 = 356.2 V
//   reg = 356.2/11000 = 3.24%
//
// Efficiency at full load, pf=0.8:
//   output = 1·50000·0.8 = 40,000 W
//   P_cu   = 800 W (full load)
//   η = 40000 / (40000 + 250 + 800) = 40000 / 41050 = 97.44%
//
// Max-efficiency load fraction: √(P_oc / P_sc) = √(250/800) = 0.559.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const oc = kernel.transformer.openCircuitTest({
  openCircuitVoltageV: 415, openCircuitCurrentA: 5, openCircuitPowerW: 250,
});
console.log('OC:', oc);
if (!approx(oc.cosPhiOc, 0.1205, 0.005)) throw new Error('cosφ_oc off');
if (!approx(oc.coreResistanceOhm, 689.0, 0.01)) throw new Error('R_c off');
if (!approx(oc.magnetisingReactanceOhm, 83.6, 0.02)) throw new Error('X_m off');

const sc = kernel.transformer.shortCircuitTest({
  shortCircuitCurrentA: 4.545, shortCircuitVoltageV: 400, shortCircuitPowerW: 800,
});
console.log('SC:', sc);
if (!approx(sc.equivalentResistanceOhm, 38.72, 0.01)) throw new Error('R_eq off');
if (!approx(sc.equivalentImpedanceOhm, 88.0, 0.01)) throw new Error('Z_eq off');
if (!approx(sc.equivalentReactanceOhm, 79.02, 0.02)) throw new Error('X_eq off');

const reg = kernel.transformer.voltageRegulation({
  equivalentResistanceOhm: 38.72, equivalentReactanceOhm: 79.02,
  ratedHvCurrentA: 4.545, loadFraction: 1.0,
  powerFactor: 0.8, leading: false, ratedHvVoltageV: 11000,
});
console.log('reg:', reg);
if (!approx(reg.regulationPct, 3.24, 0.02)) throw new Error('reg% off');

const eff = kernel.transformer.efficiency({
  ratedKva: 50, openCircuitPowerW: 250, shortCircuitPowerW: 800,
  loadFraction: 1.0, powerFactor: 0.8,
});
console.log('η:', eff);
if (!approx(eff, 0.9744, 0.001)) throw new Error('η off');

const xstar = kernel.transformer.maximumEfficiencyLoadFraction(250, 800);
console.log('x*:', xstar);
if (!approx(xstar, 0.559, 0.005)) throw new Error('x* off');

console.log('OK — transformer smoke green');
