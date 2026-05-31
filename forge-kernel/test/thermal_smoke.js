// forge-kernel thermal smoke (Forge-12b) — 1D heat conduction in a steel bar.
//
// Geometry: 100 × 10 × 10 mm steel bar.
//   k = 50 W/(m·K)
//   Left face (x=0)  fixed at T = 100 °C
//   Right face (x=L) fixed at T =   0 °C
//   No heat source, no convection (pure conduction).
//
// Analytical solution: linear T(x) = 100 (1 − x/L). Mid-bar T(L/2) = 50 °C.
// We tolerate ±5 % i.e. ±2.5 °C around 50 °C.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge  = require(KERNEL);

assert.ok(forge.fea && forge.fea.solveThermal, 'forge.fea.solveThermal missing');

const L = 0.100;
const b = 0.010;
const h = 0.010;
const k = 50;     // W/(m·K)
const TL = 100;   // °C at -X face
const TR = 0;     // °C at +X face

const bar = forge.makeBox(L, b, h);
const mesh = forge.fea.meshFromBrep(bar, b / 2);
console.log(`[thermal-smoke] mesh: ${mesh.nodeCount} nodes, ${mesh.elemCount} elements`);

function findFaceNodes(faceBit) {
  const ids = [];
  for (let i = 0; i < mesh.nodeCount; i++) {
    if (mesh.nodeToFace[i] & (1 << faceBit)) ids.push(i);
  }
  return ids;
}

const leftNodes  = findFaceNodes(0); // -X
const rightNodes = findFaceNodes(1); // +X
assert.ok(leftNodes.length && rightNodes.length, 'left/right face nodes missing');

const dirichlet = [
  ...leftNodes.map((id) => ({ nodeId: id, T: TL })),
  ...rightNodes.map((id) => ({ nodeId: id, T: TR })),
];

const t0 = Date.now();
const result = forge.fea.solveThermal(mesh, { k }, dirichlet, [], []);
const ms = Date.now() - t0;
console.log(`[thermal-smoke] solve in ${ms} ms — T range [${result.minT.toFixed(2)}, ${result.maxT.toFixed(2)}] °C`);
console.log(`[thermal-smoke] residual ‖KT-f‖∞ = ${result.residual.toExponential(3)}`);

// Find a mid-bar node (x ≈ L/2).
let midNode = 0;
let bestDx = 1e9;
for (let i = 0; i < mesh.nodeCount; i++) {
  const x = mesh.nodes[3 * i];
  if (Math.abs(x - L / 2) < bestDx) { bestDx = Math.abs(x - L / 2); midNode = i; }
}
const Tmid = result.T[midNode];
const Tanal = 50;
const err = (Tmid - Tanal) / Tanal;
console.log(`[thermal-smoke] mid-bar T (node ${midNode}, x=${(mesh.nodes[3*midNode]*1000).toFixed(2)} mm) = ${Tmid.toFixed(2)} °C (analytical ${Tanal} °C, err ${(err*100).toFixed(2)} %)`);

assert.ok(Math.abs(err) < 0.05,
  `mid-bar T err ${(err*100).toFixed(2)} % exceeds ±5 %`);

// Sanity-check flux: |q| should be ≈ k (TL−TR)/L = 50 · 100 / 0.1 = 50000 W/m².
const qAnal = k * (TL - TR) / L;
let qSum = 0;
for (const f of result.elemFluxMag) qSum += f;
const qMean = qSum / result.elemFluxMag.length;
console.log(`[thermal-smoke] mean |q| = ${qMean.toFixed(1)} W/m² (theory ${qAnal.toFixed(1)} W/m²)`);
assert.ok(Math.abs(qMean - qAnal) / qAnal < 0.1,
  `mean flux err ${((qMean - qAnal) / qAnal * 100).toFixed(2)} % > 10 %`);

forge.release(bar);
console.log('\n[thermal-smoke] ALL PASS');
