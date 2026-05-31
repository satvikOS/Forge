// weldments_smoke — Forge-24 structural members + end caps + gussets +
// weld beads + cut list.
//
// Build a 500×500 mm square frame from 4 rect-tube structural members,
// add 4 end caps, 4 gussets, fillet weld beads at the joints. Cut list
// returns 4 members each ≈500 mm.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

console.log('[weldments-smoke] version =', forge.version());
assert.ok(forge.weldments, 'weldments namespace missing');

const profile = {
  kind: 'RectTube',
  name: 'HSS-50x50x3',
  dims: { w: 50, h: 50, t: 3 },
};

// 4 path segments forming a 500×500 square (centerlines).
const L = 500;
const p1 = forge.weldments.makePathEdge(0, 0,   0, L, 0,   0);  // bottom (along X)
const p2 = forge.weldments.makePathEdge(0, L,   0, L, L,   0);  // top    (along X)
const p3 = forge.weldments.makePathEdge(0, 0,   0, 0, L,   0);  // left   (along Y)
const p4 = forge.weldments.makePathEdge(L, 0,   0, L, L,   0);  // right  (along Y)

const m1 = forge.weldments.structuralMember(p1, profile, 'centroid');
const m2 = forge.weldments.structuralMember(p2, profile, 'centroid');
const m3 = forge.weldments.structuralMember(p3, profile, 'centroid');
const m4 = forge.weldments.structuralMember(p4, profile, 'centroid');

assert.ok(m1 > 0 && m2 > 0 && m3 > 0 && m4 > 0, 'all members must have valid handles');
console.log('[weldments-smoke] 4 members built');

// ----- end caps ------------------------------------------------------
let cm1 = forge.weldments.endCap(m1, 0, 3.0, 0);
let cm2 = forge.weldments.endCap(m2, 0, 3.0, 0);
let cm3 = forge.weldments.endCap(m3, 0, 3.0, 0);
let cm4 = forge.weldments.endCap(m4, 0, 3.0, 0);
console.log('[weldments-smoke] 4 end caps fused');

// ----- gussets -------------------------------------------------------
cm1 = forge.weldments.gusset(cm1, 0, 30, 5);
cm2 = forge.weldments.gusset(cm2, 0, 30, 5);
cm3 = forge.weldments.gusset(cm3, 0, 30, 5);
cm4 = forge.weldments.gusset(cm4, 0, 30, 5);
console.log('[weldments-smoke] 4 gussets fused');

// ----- weld beads at joints -----------------------------------------
cm1 = forge.weldments.weldBead(cm1, [0, 1], 2.5, 'fillet');
cm2 = forge.weldments.weldBead(cm2, [0, 1], 2.5, 'fillet');
console.log('[weldments-smoke] weld beads fused');

// ----- cut list ------------------------------------------------------
const bom = forge.weldments.cutList([cm1, cm2, cm3, cm4]);
assert.ok(Array.isArray(bom), 'cutList must return an array');
console.log('[weldments-smoke] cut list:');
for (const r of bom) {
  console.log('  -',
    `member ${r.memberId} ${r.profileName} L=${r.length.toFixed(1)} mm qty=${r.qty} w=${r.weight.toFixed(3)} kg trim=${r.trim}`);
}
assert.strictEqual(bom.length, 4,
  `expected 4 members, got ${bom.length}`);

for (const r of bom) {
  assert.ok(Math.abs(r.length - L) < 1.0,
    `member length ${r.length} should ≈ ${L} mm`);
  assert.strictEqual(r.profileName, 'HSS-50x50x3');
  assert.ok(r.qty >= 1, 'qty must be ≥ 1');
  assert.ok(r.weight > 0, 'weight must be > 0');
}

// ----- trim member ---------------------------------------------------
const trimmed = forge.weldments.trimMember(cm1, cm3, 'miter');
const trimBom = forge.weldments.cutList(trimmed);
assert.ok(trimBom.length >= 1, 'trimMember should still have member metadata');
assert.strictEqual(trimBom[0].trim, 'miter', 'trim mode must be recorded');
assert.ok(Math.abs(trimBom[0].miterDeg - 45) < 0.001, 'miter degree must be recorded');
console.log('[weldments-smoke] trim metadata propagates');

console.log('[weldments-smoke] ALL PASS');
