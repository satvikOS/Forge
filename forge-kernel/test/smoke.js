// forge-kernel smoke test — runs against the freshly built .node file.
// Verifies: load → makeBox → mass props → tessellate → release → liveCount
// returns to zero. Exits non-zero on any failure so `npm run forge:kernel:test`
// can gate CI.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');

let forge;
try {
  forge = require(KERNEL);
} catch (e) {
  console.error(`[smoke] failed to load ${KERNEL}: ${e.message}`);
  process.exit(1);
}

console.log('[smoke] version =', forge.version());

// ----- box ------------------------------------------------------------
const box = forge.makeBox(1, 1, 1);
assert.strictEqual(typeof box, 'number', 'makeBox returned non-number handle');
assert.ok(box > 0, 'handle must be > 0');

const mp = forge.massProps(box);
assert.ok(Math.abs(mp.volume - 1) < 1e-9, `box volume ${mp.volume} != 1`);
assert.ok(Math.abs(mp.area   - 6) < 1e-9, `box area ${mp.area} != 6`);
assert.ok(Math.abs(mp.centerOfMass[0] - 0.5) < 1e-9, 'box COM.x != 0.5');
console.log('[smoke] box ok — volume', mp.volume, 'area', mp.area, 'com', mp.centerOfMass);

// ----- cylinder -------------------------------------------------------
const cyl = forge.makeCylinder(2, 5);
const cmp = forge.massProps(cyl);
const expectedVol = Math.PI * 4 * 5;
assert.ok(Math.abs(cmp.volume - expectedVol) / expectedVol < 1e-6,
          `cylinder volume ${cmp.volume} != ${expectedVol}`);
console.log('[smoke] cylinder ok — volume', cmp.volume);

// ----- boolean: box - cylinder ---------------------------------------
const hole = forge.cut(box, forge.makeCylinder(0.3, 1));
const holeMp = forge.massProps(hole);
assert.ok(holeMp.volume < 1 && holeMp.volume > 0.7,
          `cut volume ${holeMp.volume} out of expected range`);
console.log('[smoke] cut ok — residual volume', holeMp.volume);

// ----- tessellate -----------------------------------------------------
const mesh = forge.tessellate(box, 0.05, 0.5);
assert.ok(mesh.positions.length > 0, 'tessellate returned empty positions');
assert.ok(mesh.indices.length % 3 === 0, 'tessellate indices not divisible by 3');
console.log('[smoke] tessellate ok — vertices', mesh.positions.length / 3,
            'triangles', mesh.triangleCount);

// ----- lifecycle ------------------------------------------------------
const before = forge.liveCount();
const extra = forge.makeBox(0.1, 0.1, 0.1);
const after = forge.liveCount();
assert.strictEqual(after, before + 1, 'liveCount did not increment on makeBox');
forge.release(extra);
const restored = forge.liveCount();
assert.strictEqual(restored, before, 'liveCount did not decrement on release');
console.log('[smoke] lifecycle ok — refcounting honored');

console.log('[smoke] ALL PASS');
