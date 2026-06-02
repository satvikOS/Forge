// Forge-210 — modal analysis smoke.
//
// Classic single axial bar fixed at node 0, free at node 1.
//   f_1 = (1 / 2π) · √(K/M)
// With K = E·A/L and lumped mass = ρ·A·L (the free node carries half
// from each end, here just one half), the bar's fundamental
// longitudinal frequency in lumped form is:
//   M_free = ρ·A·L / 2
//   ω = √(EA/L / (ρAL/2)) = √(2E / (ρL²))
//   f = ω / (2π)
// E = 200 GPa = 2e11 Pa, ρ = 7800 kg/m³, L = 1 m, A = 1e-4 m²
//   ω = √(2 · 2e11 / (7800 · 1²)) = √(5.128e7) ≈ 7160 rad/s
//   f ≈ 1139 Hz

const kernel = require('../build/Release/forge-kernel.node');
const fr = kernel.frame;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

const r = fr.modal({
  nodes: [
    { position: [0, 0, 0], fixed: [true, true, true] },
    { position: [1, 0, 0], fixed: [false, true, true] },
  ],
  elements: [
    { a: 0, b: 1, E: 2e11, A: 1e-4, density: 7800 },
  ],
  kModes: 1,
});
ck(r.frequenciesHz.length === 1, `freq count ${r.frequenciesHz.length}`);
close(r.frequenciesHz[0], 1139, 5, 'fundamental freq');

// Mode shape: only the X DOF of the free node should be 1.
ck(Math.abs(r.modeShapes[0][3] - 1) < 1e-9, `mode X at free node = ${r.modeShapes[0][3]}`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-210 modal smoke: OK');
console.log(`  f1 = ${r.frequenciesHz[0].toFixed(2)} Hz (expected ~1139)`);
