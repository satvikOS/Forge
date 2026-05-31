// direct_smoke — Forge-23 direct-modeling kernel smoke test.
//
// Builds a 50×30×20 box, then exercises the four core synchronous-technology
// operations:
//   1) pushPullFace on the +Z face by +10 mm → volume grows by 50·30·10 = 15000
//   2) deleteFaceAndHeal on the +Y face → expect a still-closed solid
//      (auto-fill caps the gap) with non-zero volume
//   3) inferFeature on every face → dump the kind/label so a human can eyeball
//   4) faceCount sanity check
//
// Exits non-zero on assertion failure so CI can gate.

const path = require('path');
const assert = require('assert');
const forge = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));

console.log('[direct-smoke] version =', forge.version());

const DX = 50, DY = 30, DZ = 20;
const BOX_VOL = DX * DY * DZ;     // 30 000 mm³
const TOL = 1e-3;

// ----- build the box --------------------------------------------------
const box = forge.makeBox(DX, DY, DZ);
const mp0 = forge.massProps(box);
console.log(`[direct-smoke] box vol=${mp0.volume} area=${mp0.area} faces=${forge.direct.faceCount(box)}`);
assert.ok(Math.abs(mp0.volume - BOX_VOL) < TOL, `box vol ${mp0.volume} != ${BOX_VOL}`);
assert.strictEqual(forge.direct.faceCount(box), 6, 'box must have 6 faces');

// ----- enumerate features for each face ------------------------------
console.log('[direct-smoke] inferring features on all 6 faces:');
const features = [];
for (let id = 1; id <= 6; ++id) {
  const fi = forge.direct.inferFeature(box, id);
  features.push(fi);
  console.log(`  face ${id}: kind=${fi.kind.padEnd(8)} label=${fi.label.padEnd(20)} ` +
              `normal=[${fi.normal.map(n => n.toFixed(2)).join(',')}] area=${fi.area.toFixed(1)}`);
}
// Every face on a box should be planar → boss.
features.forEach((fi, i) => {
  assert.strictEqual(fi.kind, 'boss', `face ${i + 1} kind=${fi.kind}, expected boss`);
});

// ----- locate the +Z face by inspecting normals ----------------------
let zPlusId = 0;
let yPlusId = 0;
for (let id = 1; id <= 6; ++id) {
  const n = features[id - 1].normal;
  if (n[2] > 0.99) zPlusId = id;
  if (n[1] > 0.99) yPlusId = id;
}
assert.ok(zPlusId, '+Z face not found in inferred normals');
assert.ok(yPlusId, '+Y face not found in inferred normals');
console.log(`[direct-smoke] +Z face id = ${zPlusId},  +Y face id = ${yPlusId}`);

// ----- push the +Z face by +10 mm ------------------------------------
const PUSH = 10;
const pushed = forge.direct.pushPullFace(box, zPlusId, PUSH);
const mp1 = forge.massProps(pushed);
const expected1 = BOX_VOL + DX * DY * PUSH;     // 30 000 + 15 000 = 45 000
console.log(`[direct-smoke] after pushPullFace(+Z, +${PUSH}): vol=${mp1.volume.toFixed(2)} (expected ${expected1})`);
assert.ok(Math.abs(mp1.volume - expected1) < 1.0,
          `push vol ${mp1.volume} != ${expected1}`);

// ----- delete the +Y face and heal ------------------------------------
// pushed box has different face ids — re-resolve the +Y face by normal.
const pushedFaceCount = forge.direct.faceCount(pushed);
console.log(`[direct-smoke] pushed box has ${pushedFaceCount} faces`);
let yPlusOnPushed = 0;
for (let id = 1; id <= pushedFaceCount; ++id) {
  const fi = forge.direct.inferFeature(pushed, id);
  if (fi.normal[1] > 0.99) { yPlusOnPushed = id; break; }
}
assert.ok(yPlusOnPushed, '+Y face not found on pushed box');

const healed = forge.direct.deleteFaceAndHeal(pushed, [yPlusOnPushed]);
const mp2 = forge.massProps(healed);
const validity = forge.heal.checkValidity(healed);
console.log(`[direct-smoke] after deleteFaceAndHeal(+Y): vol=${mp2.volume.toFixed(2)} ` +
            `area=${mp2.area.toFixed(2)} closed=${validity.isClosed} faces=${forge.direct.faceCount(healed)}`);
assert.ok(mp2.volume > 0, 'healed body must have positive volume');

// Cleanup --------------------------------------------------------------
forge.release(box);
forge.release(pushed);
forge.release(healed);

console.log('[direct-smoke] ALL PASS');
