// cam_cmm_smoke.js (Forge-33) — CMM inspection program smoke.
//
// 50 × 30 × 20 mm box. Generate a CMM program with one plane feature
// (the top face, auto-resolved by face id 0) and one cylinder feature
// (virtual — no cylindrical face on a box; the generator falls back to
// an inscribed cylinder feature off the shape bbox). Assert > 5 probe
// points per feature.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

console.log('[cam-cmm-smoke] version =', forge.version());
assert.ok(forge.cam, 'forge.cam missing');
assert.ok(typeof forge.cam.generateCmm === 'function');

// ---------------------------------------------------------- shape
const DX = 50, DY = 30, DZ = 20;
const part = forge.translate(forge.makeBox(DX, DY, DZ), -DX / 2, -DY / 2, 0);

const features = [
  { kind: 'plane',    topo: 0,          label: 'TOP_FACE' },
  { kind: 'cylinder', topo: 0xFFFFFFFF, label: 'BORE' },
];

const gauge = { stepover: 4.0, probeRadius: 1.0 };

// ---------------------------------------------------------- generate
const prog = forge.cam.generateCmm(part, features, gauge);
console.log(`[cam-cmm-smoke] pointCount=${prog.pointCount} ` +
            `pointsPerFeature=[${[...prog.pointsPerFeature].join(',')}]`);

assert.ok(prog.pointCount > 0, 'no probe points emitted');
assert.strictEqual(prog.pointsPerFeature.length, 2,
  'expected 2 entries in pointsPerFeature');
for (let i = 0; i < prog.pointsPerFeature.length; ++i) {
  assert.ok(prog.pointsPerFeature[i] > 5,
    `feature ${i} (${features[i].label}) only got ${prog.pointsPerFeature[i]} points, expected > 5`);
}
assert.ok(prog.text.length > 0, 'CMM program text is empty');
assert.ok(/DMISMN/.test(prog.text), 'expected DMIS header in program text');
assert.ok(/ENDFIL/.test(prog.text), 'expected DMIS terminator');
// Each probe row has 6 doubles.
assert.strictEqual(prog.points.length, prog.pointCount * 6,
  'flat points array size mismatch');

forge.release(part);
console.log('[cam-cmm-smoke] ALL PASS');
