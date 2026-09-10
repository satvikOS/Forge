// PUSH-11 — forge.fea.tet smoke (Tet4 linear FEA on canonical cantilever).
//
// Beam: 100 × 10 × 10 mm steel cantilever
//   E   = 200 GPa
//   nu  = 0.3
//   rho = 7850 kg/m³
//
// 1. Fix all nodes at x≈0,
// 2. Apply 100 N tip load at x≈100mm in -Z,
// 3. Verify mesh + solver + modal exercise correctly.
//
// SI throughout (m, N, Pa, kg).
//
// --- ACCEPTANCE BAND NOTES (read me before bumping numbers) ---
//
// The task spec quotes "(PL³)/(3·E·I) = (100·0.1³)/(3·200e9·0.01·0.01³/12)
// = (0.1)/(50000) ≈ 2 µm" and asks for [0.5e-6, 1e-5] m. The denominator
// 3·E·I evaluates to 3·200e9·(8.33e-10) = 500, so the true Bernoulli
// tip deflection is **200 µm**, not 2 µm — the spec has an order-of-
// magnitude error in the divisor.
//
// This file used to say that constant-strain Tet4 elements "suffer
// severe shear-locking in pure bending — typically returning 5–15×
// under the Bernoulli prediction EVEN ON A REFINED MESH", citing a
// hand-crafted 5-tet box that gave 2.9 µm against 200 µm theory, and
// concluded the locking was "inherent to the element type, not a bug
// in this code path". The bands were widened to fit that belief.
//
// MEASUREMENT REFUTES IT. The tet mesher densified the CAD surface in
// a SINGLE pass, so the clamped face of this very beam carried ELEVEN
// nodes at every refinement level — the cantilever was restrained at
// 11 points instead of 51. With that fixed, the SAME element on the
// SAME beam gives (see reports/FEA_BOUNDARY_FIX_MEASURED.md):
//
//     tip displacement  184.146 µm  vs 200.0 µm theory   (−7.9 %)
//     peak von Mises     56.35 MPa  vs  60.0 MPa         (−6.1 %)
//     first mode        848.6 Hz    vs 815.4 Hz analytic (+4.1 %)
//
// A 5-tet box genuinely does lock — five elements cannot represent
// bending — but the generalisation to "even on a refined mesh" was
// wrong, and the bands it justified let a −91.2 % displacement and a
// +226 % first mode PASS. This test printed "within engineering
// plausibility band" on the exact defect a whole task existed to fix.
//
// Bands now live in fea_smoke_bands.cjs, at ±40 % of the analytic
// value, and are tested WITHOUT an addon build by
// fea_smoke_band_test.cjs against both measured runs. ±40 % is looser
// than the ~8 % now achieved on purpose: this is a smoke test, and
// accuracy is ratcheted by test/fea_nafems_ratchet.sh.

'use strict';

const path   = require('path');
const assert = require('assert');
const { checkBands } = require('./fea_smoke_bands.cjs');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge  = require(KERNEL);

assert.ok(forge.fea && forge.fea.tet,
    'forge.fea.tet namespace missing — PUSH-11 binding not registered');
assert.equal(typeof forge.fea.tet.meshShape,        'function');
assert.equal(typeof forge.fea.tet.solveLinearStatic, 'function');
assert.equal(typeof forge.fea.tet.solveModal,        'function');

console.log('[push-11] kernel version =', forge.version());

// --------------------------------------------------------------- geometry
const L = 0.100;   // 100 mm
const b = 0.010;   // 10 mm
const h = 0.010;   // 10 mm
const E   = 200e9;
const nu  = 0.3;
const rho = 7850;
const F   = 100; // N tip load

const beam = forge.makeBox(L, b, h);
console.log('[push-11] beam handle =', beam);

// Mesh — 2 mm seeds give ~5 layers across the 10 mm bending depth and
// enough nodes to keep CST locking around 10×.
const t0 = Date.now();
const mesh = forge.fea.tet.meshShape(beam, 0.002);
const meshMs = Date.now() - t0;
console.log(
    `[push-11] mesh: ${mesh.nodeCount} nodes, ${mesh.tetCount} tets ` +
    `(shellTetsOnly=${mesh.shellTetsOnly}, ${meshMs} ms)`
);
assert.ok(mesh.nodeCount >= 4,  'mesh has too few nodes');
assert.ok(mesh.tetCount  >= 1,  'mesh has zero elements');

// --------------------------------------------------------------- BCs
const nodes = mesh.nodes;
const N = mesh.nodeCount;

const xs = new Float64Array(N);
for (let i = 0; i < N; i++) xs[i] = nodes[3 * i + 0];

let xmin = Infinity, xmax = -Infinity;
for (let i = 0; i < N; i++) { if (xs[i] < xmin) xmin = xs[i]; if (xs[i] > xmax) xmax = xs[i]; }
const tol = (xmax - xmin) * 1e-3;
const fixedNodes = [];
for (let i = 0; i < N; i++) if (xs[i] - xmin < tol) fixedNodes.push(i);
assert.ok(fixedNodes.length >= 3,
    `expected >=3 nodes near x=0 to fix, got ${fixedNodes.length}`);
console.log(`[push-11] fixed ${fixedNodes.length} nodes at x=${xmin.toFixed(5)}`);

const tipNodes = [];
for (let i = 0; i < N; i++) if (xmax - xs[i] < tol) tipNodes.push(i);
assert.ok(tipNodes.length >= 1, 'no tip nodes found');
const perNodeFz = -F / tipNodes.length;
const nodalForces = tipNodes.map(nid => ({nodeId: nid, fx: 0, fy: 0, fz: perNodeFz}));
console.log(`[push-11] applying ${F} N total over ${tipNodes.length} tip nodes ` +
            `(${perNodeFz.toFixed(3)} N each, -Z)`);

const bc  = { fixedNodes, nodalForces };
const mat = { E, nu, rho };

// --------------------------------------------------------------- static
const I = b * h * h * h / 12;
const theoreticalDelta = F * L * L * L / (3 * E * I);
const theoreticalSigma = F * L * (h / 2) / I;

const tStatic = Date.now();
const res = forge.fea.tet.solveLinearStatic(mesh, mat, bc);
const staticMs = Date.now() - tStatic;
console.log(
    `[push-11] static: maxDisp = ${(res.maxDisp * 1e6).toFixed(3)} µm, ` +
    `maxVonMises = ${(res.maxVonMises / 1e6).toFixed(2)} MPa, ` +
    `cgIters = ${res.cgIterations}, cgRes = ${res.cgResidual.toExponential(2)}, ` +
    `converged = ${res.converged} (${staticMs} ms)`
);
console.log(
    `[push-11] beam theory: δ = ${(theoreticalDelta * 1e6).toFixed(1)} µm, ` +
    `σ_max = ${(theoreticalSigma / 1e6).toFixed(1)} MPa`
);

assert.ok(res.converged, 'CG did not converge');

// --------------------------------------------------------------- modal
const tModal = Date.now();
const modal = forge.fea.tet.solveModal(mesh, mat, fixedNodes, 3);
const modalMs = Date.now() - tModal;
const freqs = Array.from(modal.eigenfrequencies);
console.log(
    `[push-11] modal: freqs = [${freqs.map(f => f.toFixed(1) + ' Hz').join(', ')}] ` +
    `(${modalMs} ms, converged=${modal.converged})`
);
assert.ok(freqs.length >= 1, 'no modal frequencies returned');
const f1 = freqs[0];
// All three bands are applied together, from fea_smoke_bands.cjs, so a run that is
// wrong in one observable and plausible in the others cannot slip through on the
// strength of the others.
const violations = checkBands({
  maxDisp_m:      res.maxDisp,
  maxVonMises_Pa: res.maxVonMises,
  firstMode_Hz:   f1,
});
assert.ok(violations.length === 0,
    'outside the cantilever acceptance bands:\n  ' + violations.join('\n  '));

console.log('[push-11] PASS — Tet4 FEA cantilever within ±40% of analytic on displacement, stress AND first mode.');
