// Forge-215 — Euler buckling smoke.

const kernel = require('../build/Release/forge-kernel.node');
const bk = kernel.buckling;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) Section table sanity.
const rect = bk.sectionRectangle(0.02, 0.04);  // 20 × 40 mm
close(rect.area, 8e-4, 1e-12, 'rect area');
// weak axis (h=40, b=20): I = h·b³/12 = 0.04 · 0.02³ / 12 ≈ 2.67e-8
close(rect.secondMomentI, 0.04 * Math.pow(0.02, 3) / 12, 1e-15, 'rect I weak axis');

const circ = bk.sectionSolidCircle(0.020);  // 20 mm
close(circ.area, Math.PI * 0.020 * 0.020 / 4, 1e-12, 'circ area');
close(circ.secondMomentI, Math.PI * Math.pow(0.020, 4) / 64, 1e-15, 'circ I');

// (2) Classic pinned-pinned column (long, Euler):
//     d = 20 mm steel rod, L = 2 m, E = 200 GPa, σy = 250 MPa.
//     I = π·d⁴/64 = 7.854e-9 m⁴
//     P_cr = π²·E·I/L² = π² · 2e11 · 7.854e-9 / 4 ≈ 3878 N
const r = bk.analyse({
  area: circ.area, secondMomentI: circ.secondMomentI, length: 2.0,
  youngsModulus: 2e11, yieldStrength: 250e6,
  ends: 'pinned-pinned',
});
close(r.criticalLoad, Math.PI * Math.PI * 2e11 * circ.secondMomentI / 4, 1e-1, 'P_cr long pinned');
ck(r.mode === 'euler', `mode ${r.mode}`);

// (3) Short stocky column → Johnson should kick in.
//     d = 20 mm, L = 0.05 m (very short), same material.
//     slenderness λ = KL/r should be < λ_c.
const r2 = bk.analyse({
  area: circ.area, secondMomentI: circ.secondMomentI, length: 0.05,
  youngsModulus: 2e11, yieldStrength: 250e6,
  ends: 'pinned-pinned',
});
ck(r2.mode === 'johnson', `mode ${r2.mode}`);
ck(r2.criticalLoad > 50000, `short col load reasonable ${r2.criticalLoad}`);

// (4) End condition factors.
const r3 = bk.analyse({
  area: circ.area, secondMomentI: circ.secondMomentI, length: 2.0,
  youngsModulus: 2e11, yieldStrength: 250e6, ends: 'fixed-fixed',
});
// Fixed-fixed: K=0.5 → P_cr 4× the pinned case
close(r3.criticalLoad, 4 * r.criticalLoad, 1, 'fixed-fixed = 4× pinned');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-215 buckling smoke: OK');
console.log(`  long pinned d=20mm L=2m: ${r.criticalLoad.toFixed(0)} N (Euler)`);
console.log(`  short d=20mm L=50mm: ${r2.criticalLoad.toFixed(0)} N (Johnson)`);
console.log(`  fixed-fixed 4× factor: ${(r3.criticalLoad / r.criticalLoad).toFixed(3)}`);
