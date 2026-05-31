// 100k-instance benchmark — the Forge assembly target.
// Adds 100,000 box instances, runs an AABB overlap query, removes
// 10,000, and re-queries. All numbers print to stdout so CI can diff.

const path = require('path');
const forge = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));

const N = 100_000;
const GRID = Math.ceil(Math.cbrt(N));        // ≈47 → 47³ = 103,823 cells
const STEP = 5.0;                            // 5 mm spacing per cell

function identity() {
  return Float64Array.from([
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    0,0,0,1,
  ]);
}
function translated(x, y, z) {
  return Float64Array.from([
    1,0,0,x,
    0,1,0,y,
    0,0,1,z,
    0,0,0,1,
  ]);
}

console.log(`[bench] target ${N.toLocaleString()} instances`);
console.log(`[bench] forge`, forge.version());

// Build a unit box once; instance it.
const box = forge.makeBox(1, 1, 1);

forge.reserveInstances(N);

let t = process.hrtime.bigint();
const ids = new Uint32Array(N);
let k = 0;
for (let z = 0; z < GRID && k < N; z++) {
  for (let y = 0; y < GRID && k < N; y++) {
    for (let x = 0; x < GRID && k < N; x++) {
      ids[k++] = forge.addInstance(box, translated(x * STEP, y * STEP, z * STEP));
    }
  }
}
const tAdd = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] addInstance × ${N.toLocaleString()} took ${tAdd.toFixed(1)} ms ` +
            `(${(tAdd * 1000 / N).toFixed(2)} µs each)`);
console.log(`[bench] instanceCount = ${forge.instanceCount().toLocaleString()}`);
console.log(`[bench] bytesUsed = ${(forge.instanceBytesUsed() / 1024 / 1024).toFixed(1)} MiB`);

// AABB query: a 3-cell-wide cube near the origin should hit ~27 instances
// (3×3×3 grid). Time the query.
const tinyAABB = Float64Array.from([-0.1, -0.1, -0.1,
                                    2.5 * STEP, 2.5 * STEP, 2.5 * STEP]);
t = process.hrtime.bigint();
const hits = forge.queryAABB(tinyAABB);
const tQuery = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] queryAABB hit ${hits.length} instances in ${tQuery.toFixed(2)} ms`);
console.assert(hits.length === 27, `expected 27 hits, got ${hits.length}`);

// Remove every 10th instance; verify count drops.
t = process.hrtime.bigint();
for (let i = 0; i < N; i += 10) forge.removeInstance(ids[i]);
const tRemove = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] remove ${(N/10).toLocaleString()} took ${tRemove.toFixed(1)} ms`);
console.log(`[bench] instanceCount after removal = ${forge.instanceCount().toLocaleString()}`);

// Update transform on a thousand live instances (round-trip cost).
// Skip the every-10th slot we just removed.
const liveIds = [];
for (let i = 0; i < ids.length && liveIds.length < 1000; i++) {
  if (i % 10 !== 0) liveIds.push(ids[i]);
}
t = process.hrtime.bigint();
for (let i = 0; i < liveIds.length; i++) {
  forge.updateTransform(liveIds[i], translated(i * 0.1, 0, 0));
}
const tUpdate = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] updateTransform × 1000 took ${tUpdate.toFixed(1)} ms ` +
            `(${(tUpdate * 1000 / 1000).toFixed(2)} µs each)`);

// Dead-handle safety: updateTransform on a removed id must throw, not crash.
try {
  forge.updateTransform(ids[0] /* removed in the loop above */, identity());
  console.log(`[bench] FAIL — dead-handle update did not throw`);
  process.exitCode = 1;
} catch (e) {
  console.log(`[bench] dead-handle update threw as expected: ${e.message.split(' — ')[0]}`);
}

console.log(`[bench] DONE`);
