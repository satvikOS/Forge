// Forge-227 — V-belt drive smoke.
//
// Reference: d_1 = 150 mm, d_2 = 300 mm, C = 600 mm, n_1 = 1750 rpm,
// P = 7.5 kW, K_S = 1.2, per-belt = 3 kW.
//   L_p = 2·0.6 + (π/2)·0.45 + 0.15²/(4·0.6)
//       = 1.2 + 0.707 + 0.00938 ≈ 1.916 m
//   wrap angle (small) = π - 2·asin(0.15/1.2) = π - 2·0.1253 = 2.891 rad ≈ 165.6°
//   V = π · 0.15 · 1750 / 60 = 13.74 m/s
//   P_design = 1.2 · 7500 = 9000 W
//   n_belts = 9000 / 3000 = 3.0

const kernel = require('../build/Release/forge-kernel.node');
const vb = kernel.vbelt;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) pitchLength closed form
const Lp = vb.pitchLength(0.15, 0.30, 0.6);
const Lp_expected = 2*0.6 + (Math.PI/2)*0.45 + 0.15*0.15/(4*0.6);
close(Lp, Lp_expected, 1e-12, 'L_p');

// (2) centreDistFromLength round-trip
const C = vb.centreDistFromLength(0.15, 0.30, Lp);
close(C, 0.6, 1e-9, 'C round-trip');

// (3) wrapAngle small pulley
const theta = vb.wrapAngleSmallRad(0.15, 0.30, 0.6);
const theta_expected = Math.PI - 2 * Math.asin(0.15 / 1.2);
close(theta, theta_expected, 1e-12, 'θ_s');

// (4) full analyse
const r = vb.analyse({
  d1: 0.15, d2: 0.30, centreDist: 0.6,
  rpmSmall: 1750, nominalPower: 7500,
  serviceFactor: 1.2, ratingPerBelt: 3000,
});
close(r.beltSpeed, Math.PI * 0.15 * 1750 / 60, 1e-9, 'belt speed');
close(r.designPower, 9000, 1e-9, 'design power');
close(r.beltCount, 3, 1e-9, 'belt count');
close(r.wrapAngleSmallDeg, theta * 180 / Math.PI, 1e-9, 'wrap angle (deg)');

// (5) Larger d_2 → smaller wrap angle, more belts
const r2 = vb.analyse({
  d1: 0.10, d2: 0.50, centreDist: 0.6,
  rpmSmall: 1750, nominalPower: 7500,
  serviceFactor: 1.2, ratingPerBelt: 3000,
});
ck(r2.wrapAngleSmallDeg < r.wrapAngleSmallDeg, `wrap shrinks (${r2.wrapAngleSmallDeg} < ${r.wrapAngleSmallDeg})`);
close(r2.beltSpeed, Math.PI * 0.10 * 1750 / 60, 1e-9, 'belt speed (small d_1)');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-227 V-belt smoke: OK');
console.log(`  L_p = ${(Lp*1000).toFixed(1)} mm`);
console.log(`  θ_s = ${(theta * 180/Math.PI).toFixed(1)}°`);
console.log(`  V = ${r.beltSpeed.toFixed(2)} m/s, belts = ${r.beltCount.toFixed(2)}`);
