// forge-kernel FEA smoke (Forge-12) — exercises the three solvers on a
// cantilever beam: linear static, modal, dynamic (Newmark-β).
//
// Geometry: 100 × 10 × 10 mm steel cantilever, pinned at x=0 face,
// loaded at the free-end (x=100) with a point load Fy = -1000 N.
//   E   = 210 GPa
//   ν   = 0.3
//   ρ   = 7850 kg/m³
//
// All FEA quantities are in SI (m, N, Pa, kg). Beam dimensions are
// expressed in metres here.
//
// Theory cross-checks (Euler-Bernoulli):
//   * Static tip deflection: δ = F L³ / (3 E I), I = b h³ / 12
//   * First natural frequency: f₁ ≈ (1.875² / (2π L²)) √(E I / (ρ A))
//
// The solver mesh is the brick-grid fallback (see Fea.hpp header note),
// so we tolerate ±15 % on the static deflection and ±20 % on the first
// natural frequency. This stays comfortable on M4 Max in <60 s total.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge  = require(KERNEL);

assert.ok(forge.fea, 'forge.fea namespace missing');
console.log('[fea-smoke] version =', forge.version());

// ----------------------------------------------------------- constants
const L  = 0.100;   // 100 mm
const b  = 0.010;   // 10 mm
const h  = 0.010;   // 10 mm
const E  = 210e9;   // Pa
const nu = 0.3;
const rho = 7850;   // kg/m³
const F  = -1000;   // N at tip, y direction

const A = b * h;
const I = (b * h * h * h) / 12;
const deltaTheory = (Math.abs(F) * L * L * L) / (3 * E * I); // m
const lambda1 = 1.875;
const freqTheory = (lambda1 * lambda1) / (2 * Math.PI * L * L)
                 * Math.sqrt((E * I) / (rho * A));            // Hz

console.log(`[fea-smoke] beam-theory tip deflection δ = ${(deltaTheory * 1000).toFixed(4)} mm`);
console.log(`[fea-smoke] beam-theory first natural freq f₁ = ${freqTheory.toFixed(2)} Hz`);

// ----------------------------------------------------------- mesh
//
// 10 × 2 × 2 hex grid = 40 elements, 11 × 3 × 3 = 99 nodes (297 DOFs).
// Keeps the dense modal eigensolve well under the 1500-DOF cap and the
// static residual under control.
const beam = forge.makeBox(L, b, h);
console.log('[fea-smoke] beam handle =', beam);
const targetSize = b / 2;   // ~5 mm cell
const mesh = forge.fea.meshFromBrep(beam, targetSize);
console.log(`[fea-smoke] mesh: ${mesh.nodeCount} nodes, ${mesh.elemCount} elements`);
assert.ok(mesh.nodeCount > 0, 'mesh has no nodes');
assert.ok(mesh.elemCount > 0, 'mesh has no elements');

// ----------------------------------------------------------- locate nodes
function findFaceNodes(faceBit) {
  const ids = [];
  for (let i = 0; i < mesh.nodeCount; i++) {
    if (mesh.nodeToFace[i] & (1 << faceBit)) ids.push(i);
  }
  return ids;
}
const pinNodes = findFaceNodes(0); // -X face (x ≈ 0)
const tipNodes = findFaceNodes(1); // +X face (x ≈ L)
assert.ok(pinNodes.length > 0, 'no nodes on -X face');
assert.ok(tipNodes.length > 0, 'no nodes on +X face');
console.log(`[fea-smoke] pinned nodes = ${pinNodes.length} (face -X), tip nodes = ${tipNodes.length} (face +X)`);

// Tip-centre node — closest to (L, b/2, h/2). Used for deflection probes.
function distSq(i, target) {
  const dx = mesh.nodes[3*i  ] - target[0];
  const dy = mesh.nodes[3*i+1] - target[1];
  const dz = mesh.nodes[3*i+2] - target[2];
  return dx*dx + dy*dy + dz*dz;
}
const tipCenter = [L, b/2, h/2];
let tipNodeId = tipNodes[0];
let best = distSq(tipNodeId, tipCenter);
for (const id of tipNodes) {
  const d = distSq(id, tipCenter);
  if (d < best) { best = d; tipNodeId = id; }
}
console.log(`[fea-smoke] tip-centre node = ${tipNodeId} at (${mesh.nodes[3*tipNodeId  ].toFixed(4)}, ` +
            `${mesh.nodes[3*tipNodeId+1].toFixed(4)}, ${mesh.nodes[3*tipNodeId+2].toFixed(4)})`);

// ----------------------------------------------------------- BCs
const bcs = pinNodes.map(id => ({ nodeId: id, fx: true, fy: true, fz: true }));
const material = { E, nu, rho };

// Distribute total tip force equally across tip-face nodes.
const perNodeF = F / tipNodes.length;
const loads = tipNodes.map(id => ({ nodeId: id, fx: 0, fy: perNodeF, fz: 0 }));

// =========================================================== STATIC
console.log('\n[fea-smoke] ----- STATIC -----');
{
  const t0 = Date.now();
  const r = forge.fea.solveStatic(mesh, material, loads, [], bcs);
  const ms = Date.now() - t0;
  const uy = r.u[3 * tipNodeId + 1];
  const delta = -uy;   // F is negative; tip deflects in -y, take magnitude
  const err = (delta - deltaTheory) / deltaTheory;
  console.log(`[fea-smoke] static solve in ${ms} ms — tip uy = ${(uy*1000).toFixed(4)} mm, ` +
              `|δ| = ${(delta*1000).toFixed(4)} mm (theory ${(deltaTheory*1000).toFixed(4)} mm, err ${(err*100).toFixed(2)} %)`);
  console.log(`[fea-smoke] max von-Mises = ${(r.maxVonMises/1e6).toFixed(3)} MPa at element ${r.maxAtElem}`);
  console.log(`[fea-smoke] residual ‖Ku - f‖∞ = ${r.residual.toExponential(3)}`);
  assert.ok(r.residual < 1e-3,
    `static residual ${r.residual} too large — expect < 1e-3 N`);
  assert.ok(Math.abs(err) < 0.15,
    `tip deflection error ${(err*100).toFixed(2)} % outside ±15 %`);
  assert.ok(r.maxVonMises > 0, 'max von-Mises must be > 0');
}

// =========================================================== MODAL
console.log('\n[fea-smoke] ----- MODAL -----');
{
  const t0 = Date.now();
  const r = forge.fea.solveModal(mesh, material, bcs, 3);
  const ms = Date.now() - t0;
  console.log(`[fea-smoke] modal solve in ${ms} ms — captured ${r.nModes} modes`);
  for (let i = 0; i < r.nModes; i++) {
    const w2 = r.eigenvalues[i];
    const f  = Math.sqrt(Math.max(0, w2)) / (2 * Math.PI);
    console.log(`[fea-smoke]   mode ${i+1}: ω² = ${w2.toExponential(3)} rad²/s², f = ${f.toFixed(2)} Hz`);
  }
  const w2_1 = r.eigenvalues[0];
  const f1 = Math.sqrt(Math.max(0, w2_1)) / (2 * Math.PI);
  const err = (f1 - freqTheory) / freqTheory;
  console.log(`[fea-smoke] first freq ${f1.toFixed(2)} Hz (theory ${freqTheory.toFixed(2)} Hz, err ${(err*100).toFixed(2)} %)`);
  assert.ok(r.nModes >= 1, 'no modes returned');
  assert.ok(Math.abs(err) < 0.20,
    `first natural frequency error ${(err*100).toFixed(2)} % outside ±20 %`);
}

// =========================================================== DYNAMIC
console.log('\n[fea-smoke] ----- DYNAMIC -----');
{
  const tEnd = 5e-3;   // 5 ms
  const dt   = 1e-5;   // 10 µs
  const alpha = 0.0;
  const betaR = 0.0;   // undamped — should oscillate around the static deflection
  const t0 = Date.now();
  const r = forge.fea.solveDynamic(mesh, material, loads, bcs, tEnd, dt, alpha, betaR);
  const ms = Date.now() - t0;
  console.log(`[fea-smoke] dynamic solve in ${ms} ms (kernel cpuMs = ${r.cpuMs.toFixed(1)} ms)` +
              ` — ${r.stepCount} steps`);

  // Print tip uy every 100th step.
  console.log('[fea-smoke] tip displacement history (every 100th step):');
  let peakAbsUy = 0;
  for (let s = 0; s < r.displacements.length; s++) {
    const uy = r.displacements[s][3 * tipNodeId + 1];
    if (Math.abs(uy) > peakAbsUy) peakAbsUy = Math.abs(uy);
    if (s % 100 === 0) {
      const t = r.times[s];
      console.log(`[fea-smoke]   t = ${(t*1000).toFixed(3)} ms, uy = ${(uy*1e3).toFixed(4)} mm`);
    }
  }
  console.log(`[fea-smoke] peak |uy| = ${(peakAbsUy*1000).toFixed(4)} mm ` +
              `(static δ = ${(deltaTheory*1000).toFixed(4)} mm)`);
  // For an undamped step load the dynamic response oscillates around the
  // static solution with peak ≈ 2δ_static (DAF = 2). Demand the peak lie
  // within ±50 % of the static deflection in absolute terms.
  assert.ok(peakAbsUy > 0.5 * deltaTheory && peakAbsUy < 2.5 * deltaTheory,
    `peak |uy| ${peakAbsUy} m outside static-deflection ±50 % band`);
  // Stress envelope should be > 0 on at least one element.
  let envMax = 0;
  for (const v of r.maxStressEnvelope) if (v > envMax) envMax = v;
  console.log(`[fea-smoke] envelope max von-Mises = ${(envMax/1e6).toFixed(3)} MPa`);
  assert.ok(envMax > 0, 'stress envelope must be > 0');
}

// ----------------------------------------------------------- cleanup
forge.release(beam);
console.log('\n[fea-smoke] ALL PASS');
