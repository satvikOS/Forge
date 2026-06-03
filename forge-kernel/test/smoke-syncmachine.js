// Forge-249 — Synchronous machine smoke (Chapman example 5-1).
//
// 480 V (line, 60 Hz), Y-connected, so V_t per-phase = 277 V.
// X_s = 1.0 Ω, R_a ≈ 0.
// Generator at rated P_3φ = 200 kW per phase, pf = 0.8 lag.
//   I_a = (200000/0.8)/277 = 250000/277 = 902.5 A
//   φ = −acos(0.8) = −36.87° (lag → I lags V)
//   E_f = V_t + jX_s·I_a (R_a = 0)
//       jX_s·I_a = 1·902.5 ∠(90 − 36.87) = 902.5 ∠ 53.13°
//                = 541.5 + j722.0
//   E_f = 277 + 541.5 + j722.0 = 818.5 + j722.0
//   |E_f| = √(669,944 + 521,284) = √1,191,228 = 1091.4 V
//   δ = atan2(722, 818.5) = 41.4° (Chapman value)
//   P_e (closed form) = V_t · E_f sinδ / X_s = 277·1091.4·sin(41.4°)/1.0
//                     = 277·1091.4·0.6614 = 200000 W ≈ 200 kW ✓
//   Q_e = V_t·(E_f cosδ − V_t)/X_s = 277·(1091.4·0.7501 − 277)/1.0
//       = 277·(818.5 − 277)/1.0 = 277·541.5 = 149994 VAR ≈ 150 kVAR
//   P_max = V_t·E_f/X_s = 277·1091.4 = 302.3 kW

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const r = kernel.syncmachine.analyse({
  mode: 'generator',
  terminalPhaseVoltageV: 277,
  synchronousReactanceOhm: 1.0,
  armatureResistanceOhm: 0,
  realPowerPerPhaseW: 200000,
  powerFactor: 0.8, leading: false,
});
console.log(r);

if (!approx(r.armatureCurrentA, 902.5, 0.01)) throw new Error('I_a off');
if (!approx(r.inducedEmfV, 1091.4, 0.01)) throw new Error('|E_f| off');
if (!approx(r.inducedEmfAngDeg, 41.4, 0.02)) throw new Error('δ off');
if (!approx(r.reactivePowerPerPhaseVar / 1000, 149.99, 0.01)) throw new Error('Q off');
if (!approx(r.maxPullOutPowerW / 1000, 302.3, 0.01)) throw new Error('P_max off');

// Motor: same fixture, mode = motor.
const m = kernel.syncmachine.analyse({
  mode: 'motor',
  terminalPhaseVoltageV: 277,
  synchronousReactanceOhm: 1.0,
  armatureResistanceOhm: 0,
  realPowerPerPhaseW: 200000,
  powerFactor: 0.8, leading: false,
});
// For motor: E_f = V_t − jX_s·I_a, so E_f angle should be negative.
if (!(m.inducedEmfAngDeg < 0)) throw new Error('motor δ should be negative');
console.log('motor:', m);

console.log('OK — syncmachine smoke green');
