// forge-kernel Terrain smoke (Forge-191) — Delaunay + cut/fill.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.terrain && typeof forge.terrain.delaunay === 'function',
          'forge.terrain.delaunay missing');

// ---------- Delaunay: regular 5×5 grid (25 points, ~32 triangles)
const N = 5;
const pts = [];
for (let j = 0; j < N; ++j) {
  for (let i = 0; i < N; ++i) {
    pts.push(i * 1.0, j * 1.0, 0.5);   // flat plane z = 0.5
  }
}
const dr = forge.terrain.delaunay({ points: new Float64Array(pts) });
assert.strictEqual(dr.n, N * N);
// Expected triangle count for an n×n grid Delaunay ≈ 2(n−1)².
const expectedTri = 2 * (N - 1) * (N - 1);
assert.ok(Math.abs(dr.triangles.length / 3 - expectedTri) <= 2,
          `triangle count ${dr.triangles.length/3} far from expected ${expectedTri}`);

// Every triangle index is a valid point id.
for (let i = 0; i < dr.triangles.length; ++i) {
  assert.ok(dr.triangles[i] < N * N);
}

// ---------- Cut/fill against a sloped design plane z = 0.1·x + 0
// On a flat z=0.5 TIN over 0..4×0..4, average z = 0.5, average plane =
// 0.1×2 = 0.2, so net volume = (0.5 − 0.2) × 16 = 4.8.
const cf = forge.terrain.cutFillVsPlane({
  points: new Float64Array(pts),
  triangles: dr.triangles,
  a: 0.1, b: 0.0, c: 0.0,
});
assert.ok(Math.abs(cf.tinArea - 16) < 1e-6,
          `TIN area ${cf.tinArea} should be 16`);
assert.ok(Math.abs(cf.netVolume - 4.8) < 0.05,
          `net volume ${cf.netVolume} should be ≈ 4.8`);
// Net should equal cut − fill.
assert.ok(Math.abs(cf.netVolume - (cf.cutVolume - cf.fillVolume)) < 1e-6);

// ---------- Surface above plane everywhere → all cut, no fill.
const cf2 = forge.terrain.cutFillVsPlane({
  points: new Float64Array(pts),
  triangles: dr.triangles,
  a: 0.0, b: 0.0, c: 0.0,
});
assert.ok(cf2.fillVolume < 1e-9, `expected zero fill, got ${cf2.fillVolume}`);
assert.ok(Math.abs(cf2.cutVolume - 8.0) < 0.05,
          `cut volume ${cf2.cutVolume} should be ≈ 8 (16 m² × 0.5 m)`);

// ---------- Surface below plane everywhere → all fill, no cut.
const cf3 = forge.terrain.cutFillVsPlane({
  points: new Float64Array(pts),
  triangles: dr.triangles,
  a: 0.0, b: 0.0, c: 2.0,
});
assert.ok(cf3.cutVolume < 1e-9, `expected zero cut, got ${cf3.cutVolume}`);
assert.ok(Math.abs(cf3.fillVolume - 24.0) < 0.05,
          `fill volume ${cf3.fillVolume} should be ≈ 24 m³ (1.5 m × 16 m²)`);

// ---------- Random scatter: 30 points → consistent triangulation
const randPts = [];
let seed = 7;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed % 1000) / 1000;
};
for (let i = 0; i < 30; ++i) {
  randPts.push(rnd() * 10, rnd() * 10, rnd() * 2);
}
const dr2 = forge.terrain.delaunay({ points: new Float64Array(randPts) });
assert.ok(dr2.triangles.length / 3 >= 30,
          `random scatter triangle count too low: ${dr2.triangles.length/3}`);

console.log('✅ Terrain smoke PASSED');
console.log(`   5×5 grid Delaunay   ${dr.triangles.length / 3} triangles (expected ${expectedTri})`);
console.log(`   sloped plane cut/fill   cut ${cf.cutVolume.toFixed(2)} − fill ${cf.fillVolume.toFixed(2)} = net ${cf.netVolume.toFixed(2)}`);
console.log(`   all-cut case             cut ${cf2.cutVolume.toFixed(2)}, fill ${cf2.fillVolume.toFixed(2)}`);
console.log(`   all-fill case            cut ${cf3.cutVolume.toFixed(2)}, fill ${cf3.fillVolume.toFixed(2)}`);
console.log(`   30-point scatter         ${dr2.triangles.length / 3} triangles`);
