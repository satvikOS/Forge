// Forge-240 — Retaining wall smoke (Das textbook 8.2 style).
//
// H = 6 m, D = 1 m, B_base = 4 m, toe = 1 m, stem = 0.4 m, base = 0.6 m
// φ = 30°, γ_soil = 18000 N/m³, γ_c = 23600 N/m³, c = 0 (sand)
// μ = 0.5, q_s = 0, q_allow = 200 kPa.
//
// K_a = (1−sin30°)/(1+sin30°) = 0.5/1.5 = 0.333
// K_p = 1/K_a = 3.0
//
// P_soil = 0.5·0.333·18000·6² = 108000 N = 108 kN  at H/3 = 2 m
// M_OT   = 108000 · 2 = 216 kN·m
//
// P_p = 0.5·3·18000·1² = 27000 N = 27 kN
//
// Weights (per metre):
//   stem  : 23600·0.4·6 = 56640 N at x = 1 + 0.4/2 = 1.2 m
//   base  : 23600·4·0.6 = 56640 N at x = 2 m
//   heel-w: heelW = 4−1−0.4 = 2.6 m. soil = 18000·2.6·6 = 280800 N
//           at x = 1+0.4+1.3 = 2.7 m
//   surch = 0
// W_total = 56640+56640+280800 = 394080 N ≈ 394 kN
// M_R = 56640·1.2 + 56640·2 + 280800·2.7
//      = 67968 + 113280 + 758160 = 939408 N·m ≈ 939 kN·m
//
// FS_OT = 939 / 216 ≈ 4.35 ≥ 2 ✓
// F_d   = 108 kN
// F_R   = 0.5·394 + 0 + 27 = 224 kN
// FS_S  = 224 / 108 ≈ 2.07 ≥ 1.5 ✓
//
// M_net = 939 − 216 = 723 kN·m; x_R = 723000/394080 = 1.836 m
// e     = 2.0 − 1.836 = 0.164 m
// q_avg = 394080/4 = 98520 Pa = 98.5 kPa
// dQ    = 6·394080·0.164 / 16 = 24235 Pa = 24.2 kPa
// q_max ≈ 122.7 kPa, q_min ≈ 74.3 kPa
// FS_B  = 200/122.7 ≈ 1.63 ✓

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) {
  return Math.abs(a - b) <= rel * Math.abs(b);
}

const r = kernel.retwall.analyse({
  totalHeightM: 6.0, embedmentDepthM: 1.0,
  baseWidthM: 4.0, toeWidthM: 1.0,
  stemThicknessM: 0.4, baseThicknessM: 0.6,
  unitWeightSoilNPerM3: 18000, frictionAngleDeg: 30,
  cohesionPa: 0, frictionCoeffBase: 0.5,
  surchargePa: 0, unitWeightConcreteNPerM3: 23600,
  allowableBearingPa: 200000,
});
console.log(r);

if (!approx(r.Ka, 1/3, 1e-3))    throw new Error('K_a off');
if (!approx(r.Kp, 3.0, 1e-3))    throw new Error('K_p off');
if (!approx(r.activeForceN/1000, 108, 0.01))    throw new Error('P_a off');
if (!approx(r.activeMomentNm/1000, 216, 0.01))  throw new Error('M_OT off');
if (!approx(r.passiveForceN/1000, 27, 0.01))    throw new Error('P_p off');
if (!approx(r.weightTotalN/1000, 394.08, 0.01)) throw new Error('W off');
if (!approx(r.resistingMomentNm/1000, 939.4, 0.01))
  throw new Error('M_R off');
if (!approx(r.safetyFactorOverturning, 4.35, 0.02))
  throw new Error('FS_OT off');
if (!approx(r.safetyFactorSliding, 2.07, 0.02))
  throw new Error('FS_S off');
if (!approx(r.toeBearingPa/1000, 122.7, 0.02))
  throw new Error('q_max off');
if (!approx(r.safetyFactorBearing, 1.63, 0.02))
  throw new Error('FS_B off');

console.log('OK — retwall smoke green');
