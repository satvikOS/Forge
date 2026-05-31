// forge-kernel buckling smoke (Forge-31).
//
// Geometry: 100 × 10 × 10 mm steel cantilever ("fixed-free column").
//   E   = 210 GPa,  ν = 0.3,  ρ = 7850 kg/m³
//   I   = b h³ / 12 = 1e-2 · (1e-2)³ / 12  m⁴
//   L   = 0.1 m
// Axial preload: 1000 N (compressive, -X direction) distributed across the +X tip face.
//
// Euler critical-load reference for a fixed-free column:
//   P_cr = π² E I / (2 L)²
//        = π² · 210e9 · 8.333e-9 / (0.2)² ≈ 4.32e5 N
//
// The smoke asserts the first critical-load factor λ₁ × |preload| is within
// ±20 % of the Euler reference.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge  = require(KERNEL);

assert.ok(forge.fea && forge.fea.solveBuckling, 'forge.fea.solveBuckling missing');
console.log('[buckling-smoke] version =', forge.version());

// ----------------------------------------------------------- constants
const L  = 0.100;     // 100 mm
const b  = 0.010;     // 10 mm
const h  = 0.010;
const E  = 210e9;
const nu = 0.3;
const rho = 7850;
const P_pre = 1000;   // 1 kN compressive preload (magnitude)
const I  = (b * h * h * h) / 12;
// Fixed-free Euler:
const P_cr_theory = (Math.PI ** 2) * E * I / ((2 * L) ** 2);

console.log(`[buckling-smoke] beam: L=${L} m, b=${b} m, h=${h} m, I=${I.toExponential(3)} m⁴`);
console.log(`[buckling-smoke] Euler P_cr (fixed-free) = ${P_cr_theory.toFixed(2)} N`);
console.log(`[buckling-smoke] applied axial preload   = ${P_pre} N (compressive)`);

// ----------------------------------------------------------- mesh
const beam = forge.makeBox(L, b, h);
// b/2 keeps DOF count modest (10×2×2 hex grid ≈ 567 DOFs) — well inside
// the dense-eigen cap. Brick-grid hex is famously stiff in bending; we
// document the deviation from textbook Euler in the assertion tolerance.
const mesh = forge.fea.meshFromBrep(beam, b / 2);
console.log(`[buckling-smoke] mesh: ${mesh.nodeCount} nodes, ${mesh.elemCount} elements (${3 * mesh.nodeCount} DOFs)`);

function findFaceNodes(faceBit) {
  const out = [];
  for (let i = 0; i < mesh.nodeCount; i++) {
    if (mesh.nodeToFace[i] & (1 << faceBit)) out.push(i);
  }
  return out;
}
const pinNodes = findFaceNodes(0); // -X face: clamped
const tipNodes = findFaceNodes(1); // +X face: load applied here

// Pin -X face fully.
const bcs = pinNodes.map((id) => ({ nodeId: id, fx: true, fy: true, fz: true }));
// Distribute compressive load across tip face nodes (acts in -X direction).
const perNode = -P_pre / tipNodes.length;
const loads = tipNodes.map((id) => ({ nodeId: id, fx: perNode, fy: 0, fz: 0 }));

// ----------------------------------------------------------- solve
const t0 = Date.now();
const r = forge.fea.solveBuckling(mesh, { E, nu, rho }, loads, bcs, 3);
const ms = Date.now() - t0;
console.log(`[buckling-smoke] solve in ${ms} ms (kernel cpuMs = ${r.cpuMs.toFixed(1)} ms) — ${r.nModes} modes`);
for (let i = 0; i < r.loadFactors.length; i++) {
  console.log(`[buckling-smoke]   mode ${i + 1}: λ = ${r.loadFactors[i].toExponential(3)}, ` +
              `P_cr = ${(r.loadFactors[i] * P_pre).toExponential(3)} N`);
}

const P_cr_solver = r.firstCriticalLoad;
const err = (P_cr_solver - P_cr_theory) / P_cr_theory;
console.log(`[buckling-smoke] solver P_cr = ${P_cr_solver.toExponential(3)} N`);
console.log(`[buckling-smoke] Euler  P_cr = ${P_cr_theory.toExponential(3)} N`);
console.log(`[buckling-smoke] error  = ${(err * 100).toFixed(2)} %`);

assert.ok(r.nModes >= 1, 'no buckling modes returned');
assert.ok(r.loadFactors[0] > 0, 'first load factor must be > 0');
assert.ok(Math.abs(err) < 0.20,
  `critical load factor error ${(err * 100).toFixed(2)} % outside ±20 %`);

forge.release(beam);
console.log('\n[buckling-smoke] ALL PASS');
