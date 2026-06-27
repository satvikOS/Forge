// Gate — sciviz Inc 3 : threshold.js (ParaView "Threshold").
//
// Run head-less:  node frontend/test/sciviz/threshold.test.js
//
// Gates:
//   • retained cell count == integer count of cell centroids with scalar in
//     range (exact),
//   • retained volume == Σ kept-cell volumes (exact),
//   • boundary-face sanity (a non-empty closed-ish skin is emitted).
import assert from 'node:assert/strict';
import {
  thresholdStructuredGrid, thresholdMesh,
} from '../../src/forge-v4/sciviz/threshold.js';

let checks = 0;

// ── GATE A: structured grid ───────────────────────────────────────────────
{
  const n = 12, L = 6.0, dx = L / n;
  const grid = { nx: n, ny: n, nz: n, dx, dy: dx, dz: dx, sliceXY: n * n, N: n * n * n };
  const field = new Float64Array(n * n * n);
  // a non-trivial field: distance from centre, so the kept set is a shell
  const Cx = L / 2, Cy = L / 2, Cz = L / 2;
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * dx, y = (j + 0.5) * dx, z = (k + 0.5) * dx;
    field[i + n * j + n * n * k] = Math.hypot(x - Cx, y - Cy, z - Cz);
  }
  const lo = 1.0, hi = 2.0;

  // independent expected count: loop over cell centroids
  let expectCount = 0;
  for (let id = 0; id < field.length; id++) if (field[id] >= lo && field[id] <= hi) expectCount++;

  const res = thresholdStructuredGrid(grid, field, [lo, hi]);
  assert.equal(res.keptCount, expectCount, `structured keptCount ${res.keptCount} != centroid count ${expectCount}`);
  const cellVol = dx * dx * dx;
  assert.ok(Math.abs(res.keptVolume - expectCount * cellVol) < 1e-12 * Math.max(1, res.keptVolume),
    `structured keptVolume ${res.keptVolume} != count*cellVol ${expectCount * cellVol}`);
  assert.ok(res.faceCount > 0, 'structured threshold emitted no boundary faces');
  // empty range → nothing kept, no faces
  const empty = thresholdStructuredGrid(grid, field, [100, 200]);
  assert.equal(empty.keptCount, 0, 'out-of-range threshold should keep nothing');
  assert.equal(empty.faceCount, 0, 'empty kept set should emit no faces');
  checks += 4;
  console.log(`  GATE A structured: keptCount=${res.keptCount} (== centroid count) `
    + `keptVolume=${res.keptVolume.toFixed(6)} == ${(expectCount * cellVol).toFixed(6)} faces=${res.faceCount}`);
}

// ── GATE B: hex8 FE mesh of unit cubes ────────────────────────────────────
{
  // a 3×1×1 row of unit hex cubes → 4×2×2 node lattice, exact volume = 1 each.
  const NX = 3, NY = 1, NZ = 1;          // cubes per axis
  const gx = NX + 1, gy = NY + 1, gz = NZ + 1;
  const nodeId = (i, j, k) => i + gx * j + gx * gy * k;
  const nodes = new Float64Array(gx * gy * gz * 3);
  for (let k = 0; k < gz; k++) for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const id = nodeId(i, j, k);
    nodes[3 * id] = i; nodes[3 * id + 1] = j; nodes[3 * id + 2] = k;
  }
  const conn = [];
  const elemCentreX = [];
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    // corner order matching HEX_FACES: 0..3 bottom CCW, 4..7 top
    conn.push(
      nodeId(i, j, k), nodeId(i + 1, j, k), nodeId(i + 1, j + 1, k), nodeId(i, j + 1, k),
      nodeId(i, j, k + 1), nodeId(i + 1, j, k + 1), nodeId(i + 1, j + 1, k + 1), nodeId(i, j + 1, k + 1),
    );
    elemCentreX.push(i + 0.5);
  }
  const nodeCount = gx * gy * gz;
  const elemCount = NX * NY * NZ;
  const mesh = { nodes, tets: new Uint32Array(conn), nodeCount, elemCount, elemNodeCount: 8 };

  // nodal field = node x-coordinate → element centroid scalar = element centre x
  const nodal = new Float64Array(nodeCount);
  for (let id = 0; id < nodeCount; id++) nodal[id] = nodes[3 * id];

  const lo = 0.0, hi = 1.5;   // keeps cubes whose centre-x ∈ [0,1.5] → cubes 0 (x=0.5) and 1 (x=1.5)
  // independent expected count via element centroid means
  let expect = 0, expectVol = 0;
  for (let e = 0; e < elemCount; e++) {
    let mean = 0;
    for (let c = 0; c < 8; c++) mean += nodal[mesh.tets[e * 8 + c]];
    mean /= 8;
    if (mean >= lo && mean <= hi) { expect++; expectVol += 1.0; } // each cube vol = 1
  }

  const res = thresholdMesh(mesh, nodal, [lo, hi]);
  assert.equal(res.keptCount, expect, `mesh keptCount ${res.keptCount} != centroid count ${expect}`);
  assert.ok(Math.abs(res.keptVolume - expectVol) < 1e-9,
    `mesh keptVolume ${res.keptVolume} != Σ kept-cube volumes ${expectVol}`);
  // each retained unit cube contributes 6 faces, but the shared face between
  // the two kept cubes is interior → 6+6-2 = 10 boundary faces.
  assert.equal(res.faceCount, 10, `expected 10 boundary faces for 2 adjacent kept cubes, got ${res.faceCount}`);
  checks += 3;
  console.log(`  GATE B hex mesh: keptCount=${res.keptCount} (==${expect}) `
    + `keptVolume=${res.keptVolume.toFixed(9)} (==${expectVol}) boundaryFaces=${res.faceCount}`);

  // sanity: a standalone unit cube volume == 1 exactly (validates the hex volume routine)
  const cubeCorners = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const cubeNodes = new Float64Array(8 * 3);
  const cubeNodal = new Float64Array(8);
  for (let i = 0; i < 8; i++) {
    cubeNodes[3 * i] = cubeCorners[i][0];
    cubeNodes[3 * i + 1] = cubeCorners[i][1];
    cubeNodes[3 * i + 2] = cubeCorners[i][2];
    cubeNodal[i] = 0.5; // centroid scalar = 0.5
  }
  const one = thresholdMesh(
    { nodes: cubeNodes, tets: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]), nodeCount: 8, elemCount: 1, elemNodeCount: 8 },
    cubeNodal, [-1, 1]);
  assert.equal(one.keptCount, 1, 'standalone cube should be kept');
  assert.ok(Math.abs(one.keptVolume - 1.0) < 1e-12, `unit-cube volume ${one.keptVolume} != 1`);
  assert.equal(one.faceCount, 6, `standalone cube should expose 6 faces, got ${one.faceCount}`);
  checks += 2;
  console.log(`  GATE B unit-cube hex volume = ${one.keptVolume.toFixed(15)} (expect 1), faces=${one.faceCount}`);
}

console.log(`[sciviz Inc3 threshold] OK — ${checks} checks passed.`);
