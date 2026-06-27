// Task #66 Inc 2 — Archie-CUA control surface gate (HEADLESS, no window).
//
// Drives the `sim.setup.*` setters exactly as if Archie had typed:
//   "fix the base, 500 N downward on the top, solve static, report max
//    von Mises"
// and asserts:
//   • the panel STATE fills correctly (study=Static, BC=Fixed on −Z/base,
//     load=500 N downward on +Z/top) — driven through the event-reducer,
//     NEVER a React setState;
//   • the setters are idempotent (re-issuing the instruction does not
//     duplicate rows);
//   • solving via the CUA path equals the headless solveStatic path that an
//     engineer would run on the SAME final state, to ~1e-6;
//   • the same flow works when dispatched through ForgeToolBridge's
//     registered `sim.setup.*` family (so Archie can reach it).
//
// No headed Electron, no kernel build — the JS Euler-Bernoulli mock kernel
// stands in for forge-kernel.node.

import assert from 'node:assert/strict';
import { installMockForge } from './simMockKernel.mjs';

// Install the mock kernel + a native body in the scene registry BEFORE the
// store module reads it.
installMockForge();
globalThis.window.__forgeBodies = [{ kind: 'native', id: 'b1', handle: 1, name: 'block' }];

const { simStore, simSetup } = await import('../simulationStore.js');
const { buildStudyInputs } = await import('../simulationModel.js');
const { solveStatic } = await import('../simulationDispatch.js');
const bridge = await import('../../ai/ForgeToolBridge.js');

// ── helper: run the canonical Archie instruction through the setters ──────
function driveCanonical() {
  simSetup.setStudyType('Static');
  simSetup.setMaterial('steel');
  simSetup.setElementSize(2);
  simSetup.mesh();
  // "fix the base" → Fixed BC on the −Z (base) face, in place (index 0)
  simSetup.addBC({ index: 0, kind: 'Fixed', face: 'base' });
  // "500 N downward on the top" → Force on the +Z (top) face, −Z direction
  simSetup.addLoad({ index: 0, kind: 'Force', face: 'top', magnitude: 500, axis: 'z', sign: -1 });
}

// ── 1. clean slate, then drive ────────────────────────────────────────────
simSetup.reset();
driveCanonical();

let st = simStore.getState();
assert.equal(st.type, 'Static', 'study type set to Static');
assert.equal(st.materialId, 'steel', 'material set to steel');
assert.equal(st.elemSizeMm, 2, 'element size set to 2 mm');
assert.ok(st.meshObj, 'body meshed through the CUA mesh setter');

assert.equal(st.bcs.length, 1, 'exactly one BC row');
assert.equal(st.bcs[0].kind, 'Fixed', 'BC is Fixed');
assert.equal(st.bcs[0].faceId, 4, 'BC on −Z (base) face → faceId 4');

assert.equal(st.loads.length, 1, 'exactly one load row');
assert.equal(st.loads[0].kind, 'Force', 'load is a Force');
assert.equal(st.loads[0].faceId, 5, 'load on +Z (top) face → faceId 5');
assert.deepEqual(st.loads[0].F, [0, 0, -500], 'load is 500 N downward (−Z)');
console.log('[#66 Inc2] CUA setters filled state: Static · Fixed@−Z · 500N↓@+Z ✓');

// ── 2. idempotency — re-issue the SAME instruction, state must not grow ───
driveCanonical();
st = simStore.getState();
assert.equal(st.bcs.length, 1, 'idempotent: BC not duplicated on re-issue');
assert.equal(st.loads.length, 1, 'idempotent: load not duplicated on re-issue');
assert.deepEqual(st.loads[0].F, [0, 0, -500], 'idempotent: load unchanged');
console.log('[#66 Inc2] setters idempotent (rows: 1 BC / 1 load after re-issue) ✓');

// ── 3. solve via the CUA path, then the headless engineer path ────────────
const ack = simSetup.solve();
assert.ok(ack.ok, `CUA solve ok (${ack.error || ''})`);
st = simStore.getState();
assert.ok(st.result && st.result.u, 'result present on store after CUA solve');
assert.ok(st.result.maxVonMises > 0, 'max von Mises is positive');

// headless: build the SAME inputs from the final state + call solveStatic.
const { material, nodal, pressures, constraints } = buildStudyInputs(st, st.meshObj);
const headless = solveStatic({ mesh: st.meshObj, material,
                               loads: nodal, pressureLoads: pressures, bcs: constraints });
let cuaDelta = 0;
for (let i = 0; i < st.result.u.length; i++) {
  cuaDelta = Math.max(cuaDelta, Math.abs(st.result.u[i] - headless.u[i]));
}
assert.ok(cuaDelta < 1e-6, `CUA path == headless path to <1e-6 (Δ=${cuaDelta.toExponential(2)})`);
assert.ok(Math.abs(st.result.maxVonMises - headless.maxVonMises) < 1e-6,
          'maxVonMises matches the headless path');
const rr = simSetup.readResult();
console.log(`[#66 Inc2] CUA solve maxVonMises=${(rr.maxVonMises_MPa).toFixed(3)} MPa  ` +
            `peakDisp=${(rr.maxDisplacement_m * 1e6).toFixed(3)} µm  ` +
            `CUA-vs-headless Δ=${cuaDelta.toExponential(2)}`);

// ── 4. the SAME flow through the registered ForgeToolBridge family ────────
const names = new Set(bridge.FORGE_TOOLS.map((t) => t.name));
for (const n of ['sim.setup.study-type', 'sim.setup.material', 'sim.setup.element-size',
                 'sim.setup.mesh', 'sim.setup.add-bc', 'sim.setup.add-load',
                 'sim.setup.assign-face', 'sim.setup.solve', 'sim.setup.read-result']) {
  assert.ok(names.has(n), `bridge registers ${n}`);
}

simSetup.reset();
const calls = [
  { name: 'sim.setup.study-type', arguments: { type: 'Static' } },
  { name: 'sim.setup.material', arguments: { id: 'steel' } },
  { name: 'sim.setup.element-size', arguments: { mm: 2 } },
  { name: 'sim.setup.mesh', arguments: {} },
  { name: 'sim.setup.add-bc', arguments: { index: 0, kind: 'Fixed', face: 'base' } },
  { name: 'sim.setup.add-load', arguments: { index: 0, kind: 'Force', face: 'top', magnitude: 500, axis: 'z', sign: -1 } },
  { name: 'sim.setup.solve', arguments: {} },
];
let lastResp = null;
for (const c of calls) {
  lastResp = await bridge.dispatchToolCall(c);
  assert.ok(lastResp.ok, `bridge ${c.name} ok (${lastResp.error || ''})`);
}
const bst = simStore.getState();
assert.equal(bst.bcs[0].faceId, 4, 'bridge path: BC on base/−Z');
assert.equal(bst.loads[0].faceId, 5, 'bridge path: load on top/+Z');
assert.ok(bst.result && bst.result.maxVonMises > 0, 'bridge path solved a result');
const read = await bridge.dispatchToolCall({ name: 'sim.setup.read-result', arguments: {} });
assert.ok(read.ok && read.result.maxVonMises_Pa > 0, 'bridge read-result returns von Mises');
console.log('[#66 Inc2] ForgeToolBridge sim.setup.* family drives the same flow ✓');

console.log('[#66 Inc2] all CUA-control-surface gates passed');
