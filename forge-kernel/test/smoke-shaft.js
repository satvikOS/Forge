// Forge-235 — Shaft design smoke test.
//
// Static (textbook): d = 25 mm, M = 200 N·m, T = 150 N·m, S_y = 600 MPa.
//   Z   = π·d³/32 = π·(0.025)³/32 = 1.534e-6 m³
//   Zp  = π·d³/16 = 3.068e-6 m³
//   σ_x = 200 / 1.534e-6 = 130.4 MPa
//   τ   = 150 / 3.068e-6 = 48.9 MPa
//   σ_vm= √(130.4² + 3·48.9²) = √(17004 + 7174) = √24178 ≈ 155.5 MPa
//   SF  = 600 / 155.5 ≈ 3.86
//
// Fatigue: same loads, S_ut = 800 MPa, k_total = 0.8, K_f = 1.5, K_fs = 1.3.
//   S_e' = 0.5·800 = 400 MPa
//   S_e  = 0.8·400 = 320 MPa
//   σ_vm_a = 1.5·130.4 = 195.6 MPa
//   σ_vm_m = √3·1.3·48.9 = 110.1 MPa
//   1/n  = 195.6/320 + 110.1/800 = 0.6113 + 0.1377 = 0.7490
//   n    = 1.335

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, tol = 1e-2) {
  return Math.abs(a - b) <= tol;
}

const rs = kernel.shaft.analyseStatic({
  diameterM: 0.025, bendingMomentNm: 200, torqueNm: 150, yieldMPa: 600,
});
console.log('static:', rs);
if (!approx(rs.bendingStressMPa, 130.4, 0.5))
  throw new Error('σ_x off');
if (!approx(rs.shearStressMPa, 48.9, 0.5))
  throw new Error('τ off');
if (!approx(rs.vonMisesStressMPa, 155.5, 1.0))
  throw new Error('σ_vm off');
if (!approx(rs.safetyFactor, 600 / rs.vonMisesStressMPa, 1e-9))
  throw new Error('SF off');

const rf = kernel.shaft.analyseFatigue({
  diameterM: 0.025, bendingMomentNm: 200, torqueNm: 150,
  ultimateMPa: 800, marinFactor: 0.8, kfBending: 1.5, kfsTorsion: 1.3,
});
console.log('fatigue:', rf);
if (!approx(rf.enduranceLimitMPa, 320, 1e-6))
  throw new Error('S_e off');
if (!approx(rf.safetyFactor, 1.335, 0.02))
  throw new Error('Goodman n off');

console.log('OK — shaft smoke green');
