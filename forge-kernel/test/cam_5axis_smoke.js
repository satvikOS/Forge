// cam_5axis_smoke.js (Forge-33) — multi-axis indexed + continuous smokes.
//
// Indexed: 4 orientations (B=0, 30, 60, 90 degrees). Assert 4 sub-toolpaths
// joined by safe-Z rapids — i.e. perOrientation.length === 4 and each
// startMove is reached via a rapid.
//
// Continuous: sketched arc of 16 stations following a tilted cone normal.
// Assert per-move (a,b,c) values are within ±360°.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

console.log('[cam-5axis-smoke] version =', forge.version());
assert.ok(forge.cam, 'forge.cam missing');
assert.ok(typeof forge.cam.multiAxisIndexed === 'function');
assert.ok(typeof forge.cam.multiAxisContinuous === 'function');

// ---------------------------------------------------------- shape
const DX = 60, DY = 60, DZ = 30;
const shape = forge.translate(forge.makeBox(DX, DY, DZ), -DX / 2, -DY / 2, 0);

const endMill = {
  id: 21, name: '6mm endmill', diameter: 6, fluteLength: 25,
  helix: 30, flutes: 4, type: 'EndMill',
};
const params = {
  feedXY: 1000, feedZ: 250, spindleRPM: 15000,
  stepover: 3, stepdown: 5, coolant: 1.0,
};

// ---------------------------------------------------------- indexed
const orientations = [
  [0, 0,  0],
  [0, 30, 0],
  [0, 60, 0],
  [0, 90, 0],
];
const tpIdx = forge.cam.multiAxisIndexed(shape, endMill, params,
  orientations, /*zTop*/ 30, /*zBottom*/ 0);
console.log(`[cam-5axis-smoke] indexed moves=${tpIdx.moveCount} perOrient=${tpIdx.perOrientation.length}`);
assert.strictEqual(tpIdx.perOrientation.length, 4, '4 orientations expected');

// Each orientation's startMove should be preceded by a non-cutting (rapid)
// move at safe Z. Walk perOrientation and verify a rapid exists just
// before each (except the first).
for (let i = 1; i < tpIdx.perOrientation.length; ++i) {
  const s = tpIdx.perOrientation[i].startMove;
  assert.ok(s > 0, 'startMove should be > 0');
  // Inspect move at s-1: cutting flag must be 0 (rapid).
  const cuttingFlag = tpIdx.moves[(s - 1) * 5 + 3];
  assert.ok(cuttingFlag < 0.5,
    `orientation ${i} should be preceded by a safe-Z rapid (was cutting=${cuttingFlag})`);
}

// ---------------------------------------------------------- continuous
// Sketched arc — 16 stations along a half-circle in the XY plane at z=20,
// with surface normals tilted outward (cone-like).
const N = 16;
const surfacePath = [];
const radius = 20;
for (let i = 0; i < N; ++i) {
  const t = (i / (N - 1)) * Math.PI;
  const x = radius * Math.cos(t);
  const y = radius * Math.sin(t);
  // Outward radial normal tilted 30° toward +Z.
  const tiltZ = Math.cos(Math.PI / 6);   // 30° tilt
  const tiltR = Math.sin(Math.PI / 6);
  surfacePath.push({
    x, y, z: 20,
    nx: tiltR * Math.cos(t),
    ny: tiltR * Math.sin(t),
    nz: tiltZ,
  });
}

const tpCont = forge.cam.multiAxisContinuous(shape, endMill, params, surfacePath);
console.log(`[cam-5axis-smoke] continuous moves=${tpCont.moveCount} ` +
            `axisOrientations.length=${tpCont.axisOrientations.length / 3}`);
assert.ok(tpCont.moveCount >= surfacePath.length,
  `expected at least ${surfacePath.length} moves, got ${tpCont.moveCount}`);
assert.strictEqual(tpCont.axisOrientations.length, tpCont.moveCount * 3,
  'axisOrientations triple-count must equal move count');

// Each (a,b,c) within ±360°. NaN entries (rapids) skipped.
let validTriples = 0;
for (let i = 0; i < tpCont.moveCount; ++i) {
  const a = tpCont.axisOrientations[i * 3 + 0];
  const b = tpCont.axisOrientations[i * 3 + 1];
  const c = tpCont.axisOrientations[i * 3 + 2];
  if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) continue;
  assert.ok(Math.abs(a) <= 360, `A axis out of range: ${a}`);
  assert.ok(Math.abs(b) <= 360, `B axis out of range: ${b}`);
  assert.ok(Math.abs(c) <= 360, `C axis out of range: ${c}`);
  ++validTriples;
}
console.log(`[cam-5axis-smoke] valid (a,b,c) triples = ${validTriples}`);
assert.ok(validTriples >= surfacePath.length,
  `expected >= ${surfacePath.length} valid axis triples, got ${validTriples}`);

forge.release(shape);
console.log('[cam-5axis-smoke] ALL PASS');
