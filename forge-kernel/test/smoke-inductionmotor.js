// Forge-246 — Induction motor smoke (Chapman example 7-5).
//
// 460 V (line), Δ-connected so V_ph = 460 V, but Chapman uses Y-equivalent
// V_ph = 460/√3 = 265.6 V for per-phase analysis. f = 60 Hz, 4 poles.
//   R_1 = 0.641 Ω, X_1 = 1.106 Ω
//   R_2 = 0.332 Ω (referred), X_2 = 0.464 Ω
//   X_m = 26.3 Ω
// Slip s = 0.022 (2.2%).
//
// ω_s = 4π·60/4 = 188.5 rad/s; n_s = 1800 rpm; n_m = (1−0.022)·1800 = 1760 rpm
//
// Thevenin:
//   V_th magnitude ≈ V_ph · X_m / √(R_1² + (X_1 + X_m)²)
//                 ≈ 265.6 · 26.3 / √(0.641² + 27.41²)
//                 ≈ 265.6 · 26.3 / 27.42 = 254.7 V
//   Z_th from full complex divide: R_th ≈ 0.59 Ω, X_th ≈ 1.06 Ω
//
// At s=0.022:
//   R_2/s = 15.09 Ω; denom = (0.59+15.09)² + (1.06+0.464)² ≈ 245.8 + 2.32 = 248.1
//   T_d = (3/188.5)·254.7²·15.09/248.1 = 0.01592·64872·0.0608 ≈ 62.8 N·m  (Chapman 60 N·m ballpark)
//
// Breakdown slip s_b = R_2 / √(R_th² + (X_th + X_2)²) = 0.332/√(0.59² + 1.524²)
//                    = 0.332 / 1.634 = 0.2032
//
// We'll accept ±5% on T_max and starting torque values.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const r = kernel.inductionmotor.analyse({
  phaseVoltageV: 460 / Math.sqrt(3),
  frequencyHz: 60, poles: 4,
  stator_R1: 0.641, stator_X1: 1.106,
  rotor_R2:  0.332, rotor_X2:  0.464,
  mag_Xm: 26.3,
  slip: 0.022,
});
console.log(r);

if (!approx(r.synchronousRpm, 1800, 1e-6))          throw new Error('n_s off');
if (!approx(r.mechanicalRpm, 1800 * (1 - 0.022), 1e-6))
  throw new Error('n_m off');
if (!approx(r.thevenin_V, 254.7, 0.01))             throw new Error('V_th off');
if (!approx(r.developedTorqueNm, 62.8, 0.05))       throw new Error('T_d off');
if (!approx(r.breakdownSlip, 0.2032, 0.02))         throw new Error('s_b off');
// Sanity: T_max ≥ T_d (it's the breakdown).
if (!(r.breakdownTorqueNm > r.developedTorqueNm))   throw new Error('T_max not > T_d');
// Starting current is much larger than running current.
if (!(r.startingCurrentA > r.rotorCurrentA * 4))    throw new Error('I_start should be much > I_run');

console.log('OK — inductionmotor smoke green');
