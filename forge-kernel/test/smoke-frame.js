// Forge-205 — frame / truss FEA smoke.
//
// Single-element axial test: a horizontal bar fixed at node 0, loaded
// with -1000 N at node 1. With E = 200 GPa, A = 100 mm², L = 1000 mm,
// expected displacement = F·L/(E·A) = 1000·1000 / (200e3 · 100) = 0.05 mm.

const kernel = require('../build/Release/forge-kernel.node');
const fr = kernel.frame;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// --- (1) Single axial bar ---
const r = fr.solve({
  nodes: [
    { position: [0, 0, 0],    fixed: [true, true, true] },
    { position: [1000, 0, 0], fixed: [false, true, true] },
  ],
  elements: [
    { a: 0, b: 1, E: 200e3, A: 100 },  // E in MPa (N/mm²), A in mm²
  ],
  loads: [
    { node: 1, force: [1000, 0, 0] },  // 1000 N along +X
  ],
});
ck(r.singular === false, `singular ${r.singular}`);
// Displacements are 6 entries (2 nodes × 3 DOF). Node 1 X displacement is
// the 3rd entry.
close(r.displacements[3], 0.05, 1e-6, 'node1 X disp');
close(r.displacements[0], 0,    1e-12, 'node0 X disp');
// Axial force = +1000 N (tension)
close(r.axialForce[0], 1000, 1e-6, 'axial force');
// Reactions at node 0: -1000 N in X.
close(r.reactions[0], -1000, 1e-6, 'reaction X at node 0');

// --- (2) Two-bar V-shape — classic statics test ---
//   Node 0 at origin (fixed all). Node 1 at (1000, 0, 0) — pin only in
//   X and Z. Node 2 at (500, 866, 0) — the load point. Two bars 0-2 and
//   1-2 meet at node 2 at 60° + 60° from the floor.
//   Apply F = -1000 N in Y at node 2. Each bar carries the load via its
//   vertical component sin(60°)·F = -1155.7 N (compression both).
const r2 = fr.solve({
  nodes: [
    { position: [0, 0, 0],     fixed: [true, true, true] },
    { position: [1000, 0, 0],  fixed: [true, true, true] },
    { position: [500, 866.025, 0], fixed: [false, false, true] },
  ],
  elements: [
    { a: 0, b: 2, E: 200e3, A: 100 },
    { a: 1, b: 2, E: 200e3, A: 100 },
  ],
  loads: [
    { node: 2, force: [0, -1000, 0] },
  ],
});
ck(r2.singular === false, `Vshape singular ${r2.singular}`);
// Vertical equilibrium: 2 · F_bar · sin(60°) = 1000 → F_bar = 577.35 N
// in compression for symmetric V. The axial force sign is + tension. Bar
// 0→2 has direction (500, 866, 0)/1000 — push node 2 down-left
// (compression). axialForce should be negative for both bars.
close(r2.axialForce[0], -577.35, 0.5, 'V bar 0-2 axial');
close(r2.axialForce[1], -577.35, 0.5, 'V bar 1-2 axial');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-205 frame smoke: OK');
console.log(`  axial bar: u₁ₓ = ${r.displacements[3].toExponential(3)} mm, N = ${r.axialForce[0]} N`);
console.log(`  V truss:   bar0 ${r2.axialForce[0].toFixed(2)} N, bar1 ${r2.axialForce[1].toFixed(2)} N`);
