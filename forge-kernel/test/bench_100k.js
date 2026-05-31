// 100k-instance benchmark — the Forge assembly target.
// Adds 100,000 box instances, runs an AABB overlap query (linear scan +
// BVH), removes 10,000, and re-queries. Then scales up to 500k and
// measures buildBvh / queryAABB / queryRay / queryFrustum. All numbers
// print to stdout so CI can diff.

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
// (3×3×3 grid). Time the linear-scan first (BVH is dirty after the bulk
// load), then build the BVH and time the indexed query.
const tinyAABB = Float64Array.from([-0.1, -0.1, -0.1,
                                    2.5 * STEP, 2.5 * STEP, 2.5 * STEP]);
t = process.hrtime.bigint();
const linHits = forge.queryAABB(tinyAABB);
const tLin = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] queryAABB (linear, BVH dirty) hit ${linHits.length} instances in ${tLin.toFixed(2)} ms`);
console.assert(linHits.length === 27, `expected 27 hits, got ${linHits.length}`);

t = process.hrtime.bigint();
const indexed = forge.buildBvh();
const tBvh = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] buildBvh × ${indexed.toLocaleString()} primitives took ${tBvh.toFixed(1)} ms`);

t = process.hrtime.bigint();
const bvhHits = forge.queryAABB(tinyAABB);
const tBvhQ = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] queryAABB (BVH) hit ${bvhHits.length} instances in ${tBvhQ.toFixed(3)} ms`);
console.assert(bvhHits.length === 27, `expected 27 BVH hits, got ${bvhHits.length}`);

// Ray pick straight up through the origin column. The last z-layer of
// the 100k grid is partially populated (N < GRID³), but the (0,0,*)
// column is filled completely so we expect ≥ GRID-1 hits.
const rayOrigin = Float64Array.from([0.5, 0.5, -1.0]);
const rayDir    = Float64Array.from([0.0, 0.0, 1.0]);
t = process.hrtime.bigint();
const rayHits = forge.queryRay(rayOrigin, rayDir);
const tRay = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] queryRay column hit ${rayHits.length} instances in ${tRay.toFixed(3)} ms`);
console.assert(rayHits.length >= GRID - 1,
  `ray should hit at least ${GRID - 1} cells in the column, got ${rayHits.length}`);

// Frustum: 6 planes that conservatively keep everything (each plane normal
// inward, with d so big the half-space contains the whole grid).
const big = 1e6;
const frustumPlanes = Float64Array.from([
   1, 0, 0, big,
  -1, 0, 0, big,
   0, 1, 0, big,
   0,-1, 0, big,
   0, 0, 1, big,
   0, 0,-1, big,
]);
t = process.hrtime.bigint();
const fHits = forge.queryFrustum(frustumPlanes);
const tFrustum = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] queryFrustum (everything) hit ${fHits.length} in ${tFrustum.toFixed(2)} ms`);

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

// ---------------- 500k grid: 5×100k stacks along +Z -----------------
// We already have ~90k live instances from the 100k - 10k removal pass
// above; add another 410k stacked on top of the existing footprint so
// the BVH index covers 500k primitives total. Targets:
//   buildBvh       < 200 ms
//   queryAABB tiny < 0.2 ms
//   queryFrustum   < 5 ms
const TARGET = 500_000;
const live = forge.instanceCount();
const need = TARGET - live;
console.log(`[bench] -- 500k grid: need ${need.toLocaleString()} more instances --`);
forge.reserveInstances(TARGET);
t = process.hrtime.bigint();
const stride = GRID; // ≈47, same lateral resolution
let added = 0;
let zBase = GRID;    // start above the existing stack
while (added < need) {
  const z = zBase++;
  for (let y = 0; y < GRID && added < need; y++) {
    for (let x = 0; x < GRID && added < need; x++) {
      forge.addInstance(box, translated(x * STEP, y * STEP, z * STEP));
      added++;
    }
  }
}
const tAdd2 = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] addInstance × ${need.toLocaleString()} took ${tAdd2.toFixed(1)} ms ` +
            `(${(tAdd2 * 1000 / need).toFixed(2)} µs each)`);
console.log(`[bench] 500k instanceCount = ${forge.instanceCount().toLocaleString()}`);

t = process.hrtime.bigint();
const indexed500 = forge.buildBvh();
const tBvh500 = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] 500k buildBvh × ${indexed500.toLocaleString()} took ${tBvh500.toFixed(1)} ms ` +
            `(target < 200 ms)`);
if (tBvh500 > 200) {
  console.log(`[bench] WARN — 500k buildBvh missed target (${tBvh500.toFixed(1)} ms > 200 ms)`);
}

t = process.hrtime.bigint();
const tinyHits500 = forge.queryAABB(tinyAABB);
const tTiny500 = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] 500k queryAABB (tiny cube) hit ${tinyHits500.length} in ${tTiny500.toFixed(3)} ms ` +
            `(target < 0.2 ms)`);

t = process.hrtime.bigint();
const fHits500 = forge.queryFrustum(frustumPlanes);
const tFrustum500 = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] 500k queryFrustum hit ${fHits500.length} in ${tFrustum500.toFixed(2)} ms ` +
            `(target < 5 ms)`);

t = process.hrtime.bigint();
const rayHits500 = forge.queryRay(rayOrigin, rayDir);
const tRay500 = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`[bench] 500k queryRay hit ${rayHits500.length} in ${tRay500.toFixed(3)} ms`);

console.log(`[bench] DONE`);
