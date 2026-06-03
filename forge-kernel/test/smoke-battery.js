// Forge-254 — Battery sizing smoke.
//
// 100 Ah @ C/20 (rated), Peukert n = 1.2.
//   At I = 5 A (= C/20): C_eff = 100·(100/(5·20))^0.2 = 100·1 = 100 Ah; t = 20 h.
//   At I = 50 A (= C/2): C_eff = 100·(100/(50·20))^0.2 = 100·(0.1)^0.2
//                              = 100·0.6310 = 63.1 Ah; t = 1.262 h.
//
// Charge: 100 Ah, charge at 20 A, SOC 0.20 → 0.95, cvFactor 0.5.
//   ΔSOC = 0.75; t_cc = 0.75·100/20 = 3.75 h
//   t_cv = 1.875 h; total = 5.625 h.
//
// Terminal: V_oc = 12.6 V, R = 0.02 Ω, I = 50 A.
//   drop = 1 V; V_term = 11.6 V; SOC = (12.6−11.7)/(12.7−11.7) = 0.9.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const r1 = kernel.battery.runtime({
  ratedCapacityAh: 100, ratedHours: 20, peukertExponent: 1.2,
  loadCurrentA: 5,
});
console.log('runtime @ 5A:', r1);
if (!approx(r1.effectiveCapacityAh, 100, 0.001)) throw new Error('C_eff at 5A off');
if (!approx(r1.runtimeHours, 20, 0.001))         throw new Error('t at 5A off');

const r2 = kernel.battery.runtime({
  ratedCapacityAh: 100, ratedHours: 20, peukertExponent: 1.2,
  loadCurrentA: 50,
});
console.log('runtime @ 50A:', r2);
if (!approx(r2.effectiveCapacityAh, 63.10, 0.01)) throw new Error('C_eff at 50A off');
if (!approx(r2.runtimeHours, 1.262, 0.01))         throw new Error('t at 50A off');

const ch = kernel.battery.chargeTime({
  ratedCapacityAh: 100, chargeCurrentA: 20,
  initialSoc: 0.2, targetSoc: 0.95, cvPhaseFactor: 0.5,
});
console.log('charge:', ch);
if (!approx(ch.constantCurrentHours, 3.75, 1e-9)) throw new Error('CC off');
if (!approx(ch.totalHours, 5.625, 1e-9))           throw new Error('total off');

const term = kernel.battery.terminalState({
  openCircuitVoltage: 12.6, internalResistanceOhm: 0.02, loadCurrentA: 50,
});
console.log('term:', term);
if (!approx(term.dropV, 1.0, 1e-9))         throw new Error('drop off');
if (!approx(term.terminalVoltageV, 11.6, 1e-9)) throw new Error('V_term off');
if (!approx(term.stateOfCharge, 0.9, 1e-6))      throw new Error('SOC off');

console.log('OK — battery smoke green');
