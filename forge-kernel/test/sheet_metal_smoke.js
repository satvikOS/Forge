// sheet_metal_smoke — Forge-24 sheet-metal authoring + unfold.
//
// Build a 100×60×2 mm base flange from a rectangle wire, add 4 edge
// flanges, 1 hem, 1 sketched bend, then unfold + flatPattern.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

console.log('[sheet-metal-smoke] version =', forge.version());
assert.ok(forge.sheetMetal, 'sheetMetal namespace missing');

const params = { thickness: 2.0, kFactor: 0.44, minBendRadius: 1.0 };

// ----- base flange ---------------------------------------------------
const wire = forge.sheetMetal.makeWireRect(100, 60);
assert.ok(wire > 0, 'makeWireRect failed');

const base = forge.sheetMetal.baseFlange(wire, params);
assert.ok(base > 0, 'baseFlange returned invalid handle');

const baseMp = forge.massProps(base);
// 100 × 60 × 2 = 12000 mm³ exactly (rectangle prism).
assert.ok(Math.abs(baseMp.volume - 12000) < 1e-3,
  `base volume ${baseMp.volume} != 12000`);
console.log('[sheet-metal-smoke] base volume =', baseMp.volume.toFixed(1));

// ----- edge flanges (4 sides) ---------------------------------------
// After the prism, perimeter edges of the base sit on z=0 (bottom rect)
// and z=2 (top rect). We use edge indices 0..3 — the first 4 rectangle
// edges produced by TopExp_Explorer on a planar prism. The exact mapping
// depends on OCCT iteration order; each edgeFlange returns a new fused
// handle and records a BendRecord on it.
let cur = base;
const flangeCount = 4;
for (let i = 0; i < flangeCount; i++) {
  cur = forge.sheetMetal.edgeFlange(
    cur, i, params, 15.0, Math.PI / 2, 'rect');
  assert.ok(cur > 0, `edge flange ${i} returned invalid handle`);
}
console.log(`[sheet-metal-smoke] ${flangeCount} edge flanges added`);

// ----- hem -----------------------------------------------------------
cur = forge.sheetMetal.hem(cur, 0, params, 'closed', 3.0);
console.log('[sheet-metal-smoke] hem added');

// ----- sketched bend -------------------------------------------------
const bendLine = forge.sheetMetal.makeLineEdge(20, 0, 0, 20, 60, 0);
cur = forge.sheetMetal.sketchedBend(cur, bendLine, params, Math.PI / 4, 2.0);
console.log('[sheet-metal-smoke] sketched bend added');

// ----- bend list -----------------------------------------------------
const bends = forge.sheetMetal.bends(cur);
console.log('[sheet-metal-smoke] bend count =', bends.length);
// 4 edge flanges + hem (main + fold-back) + 1 sketched bend = 7
assert.ok(bends.length >= 5,
  `expected bend count ≥ 5, got ${bends.length}`);
for (const b of bends) {
  assert.ok(b.devLength >= 0, 'bend devLength must be ≥ 0');
  assert.ok(b.radius > 0,     'bend radius must be > 0');
  assert.ok(typeof b.angleRad === 'number', 'bend angle must be a number');
}

// ----- unfold --------------------------------------------------------
const flat = forge.sheetMetal.unfold(cur, params);
assert.ok(flat > 0, 'unfold returned invalid handle');
const flatMp = forge.massProps(flat);
assert.ok(flatMp.volume > 0, 'flat volume must be > 0');
console.log('[sheet-metal-smoke] flat volume =', flatMp.volume.toFixed(1));

// ----- flat pattern --------------------------------------------------
const fp = forge.sheetMetal.flatPattern(cur, params);
assert.ok(fp.wire > 0, 'flatPattern.wire invalid');
assert.ok(Array.isArray(fp.bbox) && fp.bbox.length === 4, 'flatPattern.bbox shape');
const [minX, minY, maxX, maxY] = fp.bbox;
const flatLen = maxX - minX;
const flatWid = maxY - minY;
// Flat length = base 100 + Σ devLength (positive). Width = base 60.
assert.ok(flatLen > 100,
  `flat length ${flatLen} must exceed base 100 mm`);
assert.ok(Math.abs(flatWid - 60) < 1e-3,
  `flat width ${flatWid} should ≈ 60 mm`);
assert.ok(fp.formedHeight >= 0, 'formedHeight must be ≥ 0');
console.log(`[sheet-metal-smoke] flat bbox = ${flatLen.toFixed(2)} x ${flatWid.toFixed(2)} mm`);
console.log(`[sheet-metal-smoke] formedHeight = ${fp.formedHeight.toFixed(2)} mm`);

// ----- cleanup -------------------------------------------------------
forge.release(wire);
forge.release(bendLine);
forge.release(flat);
forge.release(fp.wire);

console.log('[sheet-metal-smoke] ALL PASS');
