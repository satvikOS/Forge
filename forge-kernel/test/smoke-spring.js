// Forge-217 — compression spring smoke.
//
// Shigley example 10-1 sized spring:
//   d = 2 mm, D = 16 mm, G = 80 GPa, N_a = 10, F = 50 N.
//   C = D/d = 8
//   K_W = (4·8-1)/(4·8-4) + 0.615/8 = 31/28 + 0.0769 ≈ 1.184
//   k = G·d⁴/(8·D³·N_a) = 80e9 · 16e-12 / (8 · 4.096e-6 · 10) ≈ 3906 N/m
//   τ = 1.184 · (8·50·0.016)/(π·8e-9) ≈ 30.16 MPa

const kernel = require('../build/Release/forge-kernel.node');
const sp = kernel.spring;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

const r = sp.design({
  wireDiameter: 0.002, meanDiameter: 0.016,
  activeCoils: 10, totalCoils: 12,
  shearModulus: 80e9, appliedForce: 50,
});

close(r.springIndex, 8, 1e-12, 'C = D/d');
close(r.wahlFactor, 31/28 + 0.615/8, 1e-9, 'K_W');
const expected_k = 80e9 * Math.pow(0.002, 4) / (8 * Math.pow(0.016, 3) * 10);
close(r.rate, expected_k, expected_k * 1e-9, 'k');
const expected_tau = (31/28 + 0.615/8) * (8 * 50 * 0.016) / (Math.PI * Math.pow(0.002, 3));
close(r.maxShearStress, expected_tau, expected_tau * 1e-9, 'τ');
close(r.solidHeight, 12 * 0.002, 1e-12, 'h_s');
close(r.deflectionAtF, 50 / r.rate, 1e-12, 'δ at F');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-217 spring smoke: OK');
console.log(`  k = ${r.rate.toFixed(1)} N/m, K_W = ${r.wahlFactor.toFixed(4)}`);
console.log(`  τ_max = ${(r.maxShearStress/1e6).toFixed(2)} MPa`);
console.log(`  solid height = ${(r.solidHeight*1000).toFixed(1)} mm`);
