// Task #66 Inc 4 — FEA mesh-quality report gate (headless).
//
//   • A structured unit cube at a known element size yields the expected
//     element-count band and aspect ≈ 1 (every voxel is a perfect cube),
//     min dihedral ≈ 90°, total volume ≈ 1, zero poor elements.
//   • A hand-injected sliver tet is flagged poor (huge aspect / tiny
//     dihedral), while the regular tet beside it reads aspect ≈ 1.
//
// Built-ins only + the structured-mesh builder from the mock-kernel helper.

import assert from 'node:assert/strict';
import { buildBoxHexMesh } from './simMockKernel.mjs';
import { feaMeshQuality, POOR_ASPECT, POOR_MIN_DIHEDRAL_DEG } from '../feaMeshQuality.js';

// ── 1. structured cube → element-count band + aspect ≈ 1 ──────────────────
const Lc = 1.0, hElem = 0.25;            // 1 m cube at 0.25 m element size
const nx = Math.round(Lc / hElem);        // = 4
const cube = buildBoxHexMesh({ L: Lc, W: Lc, H: Lc, nx, ny: nx, nz: nx });
const q = feaMeshQuality(cube);

const expectedElems = nx * nx * nx;       // 64
assert.equal(q.elementType, 'hex', 'cube meshes to hex elements');
assert.equal(q.elemCount, expectedElems, `element-count band: exactly ${expectedElems}`);
assert.equal(q.nodeCount, (nx + 1) ** 3, 'node count = (n+1)³');
// element-count band tolerance (±10%) — exact here, but assert the band too
assert.ok(q.elemCount >= 0.9 * expectedElems && q.elemCount <= 1.1 * expectedElems,
          'element count within the expected band');

assert.ok(Math.abs(q.aspect.max - 1) < 1e-9,
          `worst aspect ≈ 1 on a structured cube (got ${q.aspect.max})`);
assert.ok(Math.abs(q.aspect.avg - 1) < 1e-9, 'avg aspect ≈ 1');
assert.ok(Math.abs(q.minDihedralDeg.min - 90) < 1e-6,
          `min dihedral ≈ 90° (got ${q.minDihedralDeg.min})`);
assert.ok(Math.abs(q.volume.total - 1) < 1e-9,
          `total volume ≈ 1 m³ (got ${q.volume.total})`);
assert.equal(q.poorCount, 0, 'no poor elements on a clean structured cube');
assert.equal(q.histogram[0].count, expectedElems, 'every element in the best aspect bin [1,1.5)');
console.log(`[#66 Inc4] cube: ${q.elemCount} hexes / ${q.nodeCount} nodes  ` +
            `aspect[min ${q.aspect.min.toFixed(3)} avg ${q.aspect.avg.toFixed(3)} worst ${q.aspect.max.toFixed(3)}]  ` +
            `minDih ${q.minDihedralDeg.min.toFixed(2)}°  vol ${q.volume.total.toFixed(4)}  poor ${q.poorCount} ✓`);

// ── 2. sliver tet flagged, regular tet beside it is fine ─────────────────
// node 0-3: regular tetrahedron (edge 1). node 4-7: a near-degenerate sliver
// (4th node 0.1 mm above the base plane → vanishing volume + inradius).
const nodes = new Float64Array([
  // regular tet (edge 1)
  0, 0, 0,
  1, 0, 0,
  0.5, 0.8660254, 0,
  0.5, 0.28867513, 0.81649658,
  // sliver tet
  0, 0, 0,
  1, 0, 0,
  0, 1, 0,
  0.3, 0.3, 1e-4,
]);
const tetMesh = {
  nodes,
  elements: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]),
  elemNodeCount: 4, nodeCount: 8, elemCount: 2,
};
const tq = feaMeshQuality(tetMesh);

assert.equal(tq.elementType, 'tet', 'tet mesh detected');
assert.equal(tq.elemCount, 2, 'two tets');
// regular tet → aspect ≈ 1
assert.ok(tq.aspect.min > 0.999 && tq.aspect.min < 1.01,
          `regular tet aspect ≈ 1 (got ${tq.aspect.min})`);
// sliver → worst aspect huge AND min dihedral tiny
assert.ok(tq.aspect.worst > POOR_ASPECT,
          `sliver worst aspect > ${POOR_ASPECT} (got ${tq.aspect.worst.toExponential(2)})`);
assert.ok(tq.minDihedralDeg.min < POOR_MIN_DIHEDRAL_DEG,
          `sliver min dihedral < ${POOR_MIN_DIHEDRAL_DEG}° (got ${tq.minDihedralDeg.min})`);
assert.equal(tq.poorCount, 1, 'exactly one poor element');
assert.deepEqual(tq.poor, [1], 'the sliver (index 1) is the flagged element');
console.log(`[#66 Inc4] tets: good aspect ${tq.aspect.min.toFixed(3)}  ` +
            `sliver aspect ${tq.aspect.worst.toExponential(2)}  ` +
            `sliver minDih ${tq.minDihedralDeg.min.toExponential(2)}°  ` +
            `poor=${JSON.stringify(tq.poor)} ✓`);

console.log('[#66 Inc4] all mesh-quality gates passed');
