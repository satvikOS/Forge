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
// Cut a true through-hole positioned through the box centre.  An origin-axis
// cylinder only grazes the unit box corner and can drive OCCT's boolean into a
// pathological tangent case; the smoke gate should exercise the production
// through-bore path, not a degenerate contact.
const hole = forge.cut(box, forge.translate(forge.makeCylinder(0.3, 2), 0.5, 0.5, -0.5));
const holeMp = forge.massProps(hole);
assert.ok(holeMp.volume < 1 && holeMp.volume > 0.7,
          `cut volume ${holeMp.volume} out of expected range`);
console.log('[smoke] cut ok — residual volume', holeMp.volume);

// ----- Task #16 canonical primitives: analytic-volume + validity --------
function checkSolid(label, h, expectedVol, relTol, expectFaces) {
  assert.ok(typeof h === 'number' && h > 0, `${label}: bad handle ${h}`);
  const v = forge.massProps(h).volume;
  assert.ok(Math.abs(v - expectedVol) / expectedVol < relTol,
            `${label} volume ${v} != ${expectedVol} (relTol ${relTol})`);
  const val = forge.heal.checkValidity(h);
  assert.ok(val.isClosed,   `${label} not closed`);
  assert.ok(val.isManifold, `${label} not manifold`);
  assert.ok(!val.hasSelfIntersect, `${label} self-intersects`);
  const faces = forge.direct.faceCount(h);
  if (expectFaces !== undefined) {
    assert.strictEqual(faces, expectFaces, `${label} faceCount ${faces} != ${expectFaces}`);
  }
  console.log(`[smoke] ${label} ok — volume ${v.toFixed(6)} faces ${faces} closed=${val.isClosed} manifold=${val.isManifold}`);
}

// hex prism: n=6, R=10, h=20 → V = 0.5·6·100·sin(60°)·20 = 6000·sin(π/3)
//            = 6000·0.8660254 = 5196.152; topology = 6 sides + 2 caps = 8 faces.
checkSolid('prism(hex)', forge.makePrism(6, 10, 20),
           0.5 * 6 * 100 * Math.sin(Math.PI / 3) * 20, 1e-6, 8);
// pentagonal prism (n=5) just to exercise the general n-gon path.
checkSolid('prism(pent)', forge.makePrism(5, 8, 12),
           0.5 * 5 * 64 * Math.sin(2 * Math.PI / 5) * 12, 1e-6, 7);
// wedge: dx=10 dy=6 dz=4 ltx=4 → V = 0.5·(10+4)·4·6 = 168.
checkSolid('wedge', forge.makeWedge(10, 6, 4, 4),
           0.5 * (10 + 4) * 4 * 6, 1e-6);
// pyramid: dx=10 dy=8 h=12 → V = (1/3)·10·8·12 = 320; 4 tri sides + 1 base = 5 faces.
checkSolid('pyramid', forge.makePyramid(10, 8, 12),
           (1 / 3) * 10 * 8 * 12, 1e-6, 5);
// ellipsoid: rx=4 ry=3 rz=2 → V = (4/3)·π·24 = 100.5310.
checkSolid('ellipsoid', forge.makeEllipsoid(4, 3, 2),
           (4 / 3) * Math.PI * 4 * 3 * 2, 1e-3);
// tube: rO=5 rI=3 h=10 → V = π·(25-9)·10 = 160π = 502.6548.
checkSolid('tube', forge.makeTube(5, 3, 10),
           Math.PI * (25 - 9) * 10, 1e-6);

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
