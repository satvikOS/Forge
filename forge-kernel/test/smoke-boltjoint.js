// Forge-214 — bolt joint smoke.

const kernel = require('../build/Release/forge-kernel.node');
const bj = kernel.boltjoint;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) M10 bolt, K = 0.2, T = 50 N·m:
//     F_i = 50 / (0.2 · 0.010) = 25000 N
const Fi = bj.computePreload({ torque: 50, nutFactor: 0.2, diameter: 0.010 });
close(Fi, 25000, 1e-9, 'preload M10 @ 50 N·m');

// (2) Stiffness: bolt E = 200 GPa, At = 58e-6 m², L = 0.025 m,
//                member E = 200 GPa, Aeff = 200e-6 m², L = 0.025 m.
//     k_b = 200e9 · 58e-6 / 0.025 = 4.64e8 N/m
//     k_m = 200e9 · 200e-6 / 0.025 = 1.6e9 N/m
//     C = 4.64 / (4.64 + 16) ≈ 0.225
const sf = bj.jointStiffness({
  boltE: 200e9, boltAt: 58e-6, gripLength: 0.025,
  memberE: 200e9, memberArea: 200e-6,
});
close(sf.boltStiffness,   200e9 * 58e-6 / 0.025,   1, 'kb');
close(sf.memberStiffness, 200e9 * 200e-6 / 0.025, 10, 'km');
close(sf.loadFactor, 4.64 / (4.64 + 16), 1e-3, 'C');

// (3) Check vs class 8.8 proof: σ_p = 580 MPa, At = 58e-6 → F_p = 33640 N.
//     F_b = 25000 + 0.225 · 5000 = 26125 N.
//     MS = 33640 / 26125 - 1 ≈ 0.288.
const ch = bj.check({
  preload: 25000, externalLoad: 5000, loadFactor: 0.225,
  tensileArea: 58e-6, proofStrength: 580e6,
});
close(ch.workingBoltForce, 25000 + 0.225 * 5000, 1e-9, 'Fb');
close(ch.proofLoad, 580e6 * 58e-6, 1e-9, 'Fp');
close(ch.marginOfSafety, (580e6 * 58e-6) / (25000 + 0.225 * 5000) - 1, 1e-6, 'MS');
ck(ch.adequate === true, 'adequate at MS > 0');

// (4) Metric bolt lookup.
const m10 = bj.metricBolt('M10');
close(m10.diameter, 0.010, 1e-12, 'M10 d');
close(m10.tensileArea, 57.99e-6, 1e-10, 'M10 At');
close(m10.proofStrengthClass88, 580e6, 1e-3, 'M10 σp 8.8');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-214 bolt joint smoke: OK');
console.log(`  Preload @ 50 N·m on M10 = ${Fi.toFixed(0)} N`);
console.log(`  C (load factor) = ${sf.loadFactor.toFixed(3)}`);
console.log(`  MS @ 5 kN ext = ${ch.marginOfSafety.toFixed(3)}`);
