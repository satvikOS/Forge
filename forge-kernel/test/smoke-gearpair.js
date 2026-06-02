// Forge-221 — gear pair smoke.

const kernel = require('../build/Release/forge-kernel.node');
const gp = kernel.gearpair;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) Lewis form factor sanity: N=17 → ~0.300, N=50 → ~0.4452, N=100 → ~0.4565
close(gp.lewisFormFactor(17),  0.484 - 0.2745 / Math.sqrt(17),  1e-12, 'Y(17)');
close(gp.lewisFormFactor(50),  0.484 - 0.2745 / Math.sqrt(50),  1e-12, 'Y(50)');
close(gp.lewisFormFactor(100), 0.484 - 0.2745 / Math.sqrt(100), 1e-12, 'Y(100)');

// (2) Textbook gear pair (Shigley example 14-1 territory):
//   m = 2 mm, N1 = 20, N2 = 60, b = 25 mm, T1 = 200 N·m = 200000 N·mm,
//   E_steel = 200 GPa, ν = 0.3, φ = 20°.
//   d1 = 40 mm, d2 = 120 mm
//   C = 80 mm
//   W_t = T1/r1 = 200000 / 20 = 10000 N
//   Y(20) ≈ 0.484 - 0.2745/√20 = 0.484 - 0.0614 = 0.4226
//   σ_b1 (Lewis) = 10000 / (25 · 2 · 0.4226) · 1e6 = 473.3 MPa
const r = gp.analyse({
  module: 2, teeth1: 20, teeth2: 60, faceWidth: 25, torque1: 200000,
  pressureAngleDeg: 20,
  materialE1: 200e9, materialE2: 200e9,
  materialNu1: 0.3, materialNu2: 0.3,
});

close(r.pitchDiameter1, 40, 1e-12, 'd1');
close(r.pitchDiameter2, 120, 1e-12, 'd2');
close(r.centreDistance, 80, 1e-12, 'C');
close(r.gearRatio, 3, 1e-12, 'mG');
close(r.tangentialLoadN, 10000, 1e-12, 'Wt');
close(r.lewisFormFactor1, 0.484 - 0.2745/Math.sqrt(20), 1e-12, 'Y1');

const Y1 = 0.484 - 0.2745/Math.sqrt(20);
close(r.bendingStressLewis1, 10000 / (25 * 2 * Y1) * 1e6, 1, 'σ_b1');

ck(r.contactStressHertz > 100e6, `Hertz contact > 100 MPa (got ${r.contactStressHertz})`);

// (3) AGMA factors: KO = 1.5, KV = 1.2 → stress 1.8× the Lewis baseline.
const r2 = gp.analyse({
  module: 2, teeth1: 20, teeth2: 60, faceWidth: 25, torque1: 200000,
  pressureAngleDeg: 20,
  materialE1: 200e9, materialE2: 200e9,
  materialNu1: 0.3, materialNu2: 0.3,
  KO: 1.5, KV: 1.2,
});
close(r2.bendingStressAGMA1, r2.bendingStressLewis1 * 1.8, 1, 'AGMA factor 1.8×');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-221 gear pair smoke: OK');
console.log(`  C = ${r.centreDistance} mm, ratio = ${r.gearRatio}, Wt = ${r.tangentialLoadN} N`);
console.log(`  σ_b1 = ${(r.bendingStressLewis1 / 1e6).toFixed(1)} MPa (Lewis)`);
console.log(`  σ_H  = ${(r.contactStressHertz / 1e6).toFixed(1)} MPa (Hertz)`);
