// Forge-244 — Three-phase smoke (Bergen/Vittal textbook).
//
// V_LL = 415 V, I_L = 100 A, pf = 0.866 lag (cos 30°).
//   Star: V_ph = 415/√3 = 239.6 V, I_ph = 100 A
//   Delta: V_ph = 415 V, I_ph = 100/√3 = 57.7 A
//
// S = √3·415·100 = 71880 VA ≈ 71.88 kVA
// P = 71880·0.866 = 62247 W ≈ 62.25 kW
// Q = 71880·sin(30°) = 35940 VAR (lag, positive)
//
// PF correction: P = 100 kW, pf_1 = 0.8 (lag) → pf_2 = 0.95
//   φ_1 = acos(0.8) = 36.87°, tan = 0.75 → Q_1 = 75 kVAR
//   φ_2 = acos(0.95) = 18.19°, tan = 0.3287 → Q_2 = 32.87 kVAR
//   ΔQ_c = 75 − 32.87 = 42.13 kVAR
//   C    = ΔQ_c/(2π·50·V_LL²) at V_LL = 415 V
//        = 42130 / (314.16 · 172225) = 778.5 μF (Δ-bank)
//
// Per-unit: base 100 MVA at 138 kV. Z_base = 138e3²/100e6 = 190.44 Ω.
// I_base = 100e6/(√3·138e3) = 418.4 A.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const star = kernel.threephase.balancedPower({
  connection: 'star', lineLineVoltageV: 415, lineCurrentA: 100,
  powerFactor: 0.866, leading: false,
});
console.log('star:', star);
if (!approx(star.phaseVoltageV, 415 / Math.sqrt(3), 1e-6))
  throw new Error('V_ph star off');
if (!approx(star.apparentVA / 1000, 71.88, 0.01))
  throw new Error('S off');
if (!approx(star.realW / 1000, 62.25, 0.01))
  throw new Error('P off');
if (!(star.reactiveVAR > 0 && approx(star.reactiveVAR / 1000, 35.94, 0.01)))
  throw new Error('Q lag off');

const delta = kernel.threephase.balancedPower({
  connection: 'delta', lineLineVoltageV: 415, lineCurrentA: 100,
  powerFactor: 0.866, leading: true,
});
if (!approx(delta.phaseVoltageV, 415, 1e-6)) throw new Error('V_ph delta off');
if (!approx(delta.phaseCurrentA, 100 / Math.sqrt(3), 1e-6))
  throw new Error('I_ph delta off');
if (!(delta.reactiveVAR < 0)) throw new Error('leading Q sign wrong');

const pf = kernel.threephase.powerFactorCorrection({
  realPowerW: 100000, powerFactor1: 0.8, powerFactor2: 0.95,
  lineLineVoltageV: 415, frequencyHz: 50,
});
console.log('pf:', pf);
if (!approx(pf.reactiveBeforeVAR / 1000, 75.0, 0.01)) throw new Error('Q_1 off');
if (!approx(pf.reactiveAfterVAR / 1000, 32.87, 0.01)) throw new Error('Q_2 off');
if (!approx(pf.capacitorVAR / 1000, 42.13, 0.01)) throw new Error('ΔQ off');
if (!approx(pf.capacitanceF * 1e6, 778.5, 0.01)) throw new Error('C off');

const pu = kernel.threephase.perUnit({
  baseVA: 100e6, baseVoltageLineLineV: 138e3, ohmicZ: 50,
});
if (!approx(pu.baseImpedanceOhm, 190.44, 0.01)) throw new Error('Z_base off');
if (!approx(pu.baseCurrentA, 418.37, 0.01)) throw new Error('I_base off');
if (!approx(pu.zpu, 50/190.44, 0.001)) throw new Error('Z_pu off');

console.log('OK — threephase smoke green');
