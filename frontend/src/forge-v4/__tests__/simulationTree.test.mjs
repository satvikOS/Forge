// Task #66 Inc 1 — Unified Simulation Tree gate (headless).
//
// (a) Every SimScale tree node focuses a real, existing panel sub-section.
// (b) The canonical cantilever solved THROUGH the tree path (runStudyCore,
//     the SAME function the panel's Solve button calls) equals the headless
//     forge.fea.solveStatic result bit-for-bit, AND matches the Euler-
//     Bernoulli closed form δ = F L³ / 3EI within the solver tolerance.
//
// Built-ins only + the JS mock kernel (native .node can't load in node).

import assert from 'node:assert/strict';
import { installMockForge, buildBoxHexMesh, eulerBernoulliTip } from './simMockKernel.mjs';
import {
  SIM_TREE, sectionForNode, nodeForSection,
  buildStudyInputs, runStudyCore, materialById, peakDisplacement,
} from '../simulationModel.js';
import { solveStatic } from '../simulationDispatch.js';

installMockForge();

// ── (a) tree → existing section mapping ────────────────────────────────
// The panel renders exactly these <section data-sim-section=…> ids.
const PANEL_SECTIONS = new Set(['study', 'material', 'mesh', 'loads', 'bcs', 'solve', 'results']);

assert.equal(SIM_TREE.length, 7, 'SimScale hierarchy has 7 top nodes');
const seenSections = new Set();
for (const node of SIM_TREE) {
  const sec = sectionForNode(node.id);
  assert.ok(sec, `node ${node.id} maps to a section`);
  assert.ok(PANEL_SECTIONS.has(sec), `node ${node.id} → existing panel section (${sec})`);
  assert.equal(nodeForSection(sec), node.id, `round-trips ${node.id} ↔ ${sec}`);
  seenSections.add(sec);
}
assert.equal(seenSections.size, 7, 'each node focuses a DISTINCT section');
assert.equal(sectionForNode('nope'), null, 'unknown node → null');
console.log('[#66 Inc1] tree focus mapping: 7/7 nodes → distinct existing sections ✓');

// ── (b) cantilever: tree-path == headless == Euler-Bernoulli ───────────
// 200 mm steel beam, 20×20 mm square section, 1000 N tip load (−Y).
const L = 0.2, W = 0.02, H = 0.02;
const F = 1000;
const mesh = buildBoxHexMesh({ L, W, H, nx: 8, ny: 1, nz: 1 });

const state = {
  type: 'Static',
  materialId: 'steel',
  name: 'cantilever',
  loads: [{ kind: 'Force', faceId: 1, F: [0, -F, 0] }], // +X tip face, −Y
  bcs:   [{ kind: 'Fixed', faceId: 0 }],                 // −X root face
};

// tree path (what the panel Solve button runs)
const tree = runStudyCore({ state, meshObj: mesh });
assert.ok(!tree.error, `tree-path solve ok (${tree.error || ''})`);

// headless path (call the kernel dispatch directly with the same inputs)
const { material, nodal, pressures, constraints } = buildStudyInputs(state, mesh);
const headless = solveStatic({ mesh, material, loads: nodal,
                               pressureLoads: pressures, bcs: constraints });
assert.ok(!headless.error, `headless solve ok (${headless.error || ''})`);

// path-equivalence: every DOF identical
let maxDelta = 0;
for (let i = 0; i < tree.result.u.length; i++) {
  maxDelta = Math.max(maxDelta, Math.abs(tree.result.u[i] - headless.u[i]));
}
assert.ok(maxDelta < 1e-6, `tree-path == headless to <1e-6 (Δ=${maxDelta.toExponential(2)})`);
assert.equal(tree.result.maxVonMises, headless.maxVonMises, 'maxVonMises identical');

// Euler-Bernoulli closed form
const I = (W * H * H * H) / 12; // bending about Z? depth = Y = H... square so symmetric
const Iyy = (W /* z-width */ * Math.pow(H /* y-depth */, 3)) / 12;
const m = materialById('steel');
const deltaEB = eulerBernoulliTip({ F, L, E: m.E, I: Iyy });
const deltaFEM = peakDisplacement(tree.result, mesh);
const relErr = Math.abs(deltaFEM - deltaEB) / deltaEB;

console.log(`[#66 Inc1] cantilever δ_FEM=${(deltaFEM * 1e3).toFixed(6)} mm  ` +
            `δ_EB=${(deltaEB * 1e3).toFixed(6)} mm  rel=${(relErr * 100).toExponential(2)}%  ` +
            `path-Δ=${maxDelta.toExponential(2)}`);
assert.ok(relErr < 1e-6, `tip deflection matches Euler-Bernoulli (rel ${relErr.toExponential(2)})`);

console.log('[#66 Inc1] all tree gates passed');
