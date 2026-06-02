// Forge-200 — mesh repair smoke.
//
// Builds a small mesh, runs each pass, and asserts the invariants.

const kernel = require('../build/Release/forge-kernel.node');
const mr = kernel.meshrepair;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };

// --- (1) analyse + dedupe ---
const dup = {
  // Two coincident vertex 0/3 (within eps), a square split into 2 tris.
  positions: new Float32Array([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0.0001, 0, 0,   // duplicate of vertex 0
    0, 1, 0,
  ]),
  indices: new Uint32Array([
    0, 1, 2,
    3, 2, 4,
  ]),
};
const dedup = mr.dedupeVertices(dup, 0.001);
ck(dedup.positions.length / 3 === 4, `dedupe: expected 4 verts, got ${dedup.positions.length/3}`);
ck(dedup.indices.length === 6,      `dedupe: expected 6 indices, got ${dedup.indices.length}`);

const s0 = mr.analyse(dedup);
ck(s0.triangleCount === 2, `analyse: triCount ${s0.triangleCount}`);
ck(s0.vertexCount === 4,  `analyse: vCount ${s0.vertexCount}`);
ck(s0.boundaryEdgeCount === 4, `analyse: boundaryEdgeCount ${s0.boundaryEdgeCount}`);

// --- (2) removeDegenerate ---
const deg = {
  positions: new Float32Array([0,0,0, 1,0,0, 2,0,0, 1,1,0]),
  indices:   new Uint32Array([0,1,2,  0,1,3]),  // first triangle is collinear
};
const cleaned = mr.removeDegenerate(deg);
ck(cleaned.indices.length === 3, `removeDegenerate: expected 1 tri (3 indices), got ${cleaned.indices.length/3}`);

// --- (3) fillHoles ---
// Open quad with one missing triangle: a square with only ONE triangle present
const open = {
  positions: new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0]),
  indices:   new Uint32Array([0, 1, 2]),  // one tri, the other half is missing
};
const before = mr.analyse(open);
ck(before.boundaryEdgeCount === 3, `before fill: boundary ${before.boundaryEdgeCount}`);
const filled = mr.fillHoles(open, 64);
const after = mr.analyse(filled);
ck(after.boundaryEdgeCount === 0, `after fill: boundary ${after.boundaryEdgeCount}`);
ck(after.triangleCount > before.triangleCount, `after fill: triCount ${after.triangleCount}`);

// --- (4) laplacianSmooth ---
// Tetrahedron-ish: outer ring of 4 verts + 1 displaced apex; smooth should
// pull the apex closer to the centroid of its neighbours.
const tetra = {
  positions: new Float32Array([
    0, 0, 0,
    2, 0, 0,
    2, 2, 0,
    0, 2, 0,
    1, 1, 5,  // displaced apex
  ]),
  indices: new Uint32Array([
    0,1,4,  1,2,4,  2,3,4,  3,0,4,
  ]),
};
const apexZ0 = tetra.positions[14];
const smoothed = mr.laplacianSmooth(tetra, 5, 0.5);
const apexZ1 = smoothed.positions[14];
ck(apexZ1 < apexZ0, `smooth: apex Z should decrease (was ${apexZ0}, now ${apexZ1})`);

// --- (5) decimate ---
// Subdivided square (32 tris) → ask for ~16.
function buildGrid(n) {
  const pos = [];
  const idx = [];
  for (let j = 0; j <= n; ++j) {
    for (let i = 0; i <= n; ++i) {
      pos.push(i, j, 0);
    }
  }
  for (let j = 0; j < n; ++j) {
    for (let i = 0; i < n; ++i) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      idx.push(a, b, c,  b, d, c);
    }
  }
  return {
    positions: new Float32Array(pos),
    indices: new Uint32Array(idx),
  };
}
const grid = buildGrid(4);            // 32 triangles
const targetTris = 16;
const decim = mr.decimate(grid, targetTris);
const sd = mr.analyse(decim);
ck(sd.triangleCount <= targetTris + 8, `decimate: triCount ${sd.triangleCount} > ${targetTris + 8}`);
ck(sd.triangleCount > 0, `decimate: emitted no triangles`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-200 meshrepair smoke: OK');
console.log('  dedupe: 5→4 verts, 2 tris');
console.log('  removeDegenerate: 2→1 tri');
console.log('  fillHoles: boundary 3→0');
console.log(`  smooth: apex Z ${apexZ0.toFixed(2)} → ${apexZ1.toFixed(2)}`);
console.log(`  decimate: 32→${sd.triangleCount} tris`);
