// Slice-8 — Surface workbench: thicken-surface-to-solid smoke.
//
// Build a flat 100 x 60 NURBS patch on z=0 (an OPEN surface — zero volume,
// not a solid), then run forge.part.thickenSurface to offset it into a
// closed solid of wall thickness 5mm. We expect:
//   * |volume| == 100 * 60 * 5 == 30000 mm³  (exact, planar slab)
//   * surface area == 2 * 100*60 + perimeter*5 == 13600 mm²
//   * centre of mass z == 2.5  (one-sided +outward offset ⇒ slab spans 0..5)
//
// This anchors the Thicken command (SolidWorks Insert>Boss>Thicken,
// Fusion Thicken, NX Thicken) on an analytical baseline and detects
// regressions in the BRepOffset_MakeOffset wiring.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.surfacing, 'forge.surfacing missing');
assert.ok(forge.part && typeof forge.part.thickenSurface === 'function',
          'forge.part.thickenSurface missing');

const LX = 100, LY = 60, T = 5;

// 2x2 control grid → flat bilinear patch on z=0.
const xyz = new Float64Array([
  0,  0,  0,   LX, 0,  0,
  0,  LY, 0,   LX, LY, 0,
]);
const patch = forge.surfacing.buildPatch({ uCount: 2, vCount: 2, xyz }, 1, 1);
assert.ok(patch > 0, 'buildPatch returned no handle');

// +outward (side = +1) thicken.
const solid = forge.part.thickenSurface(patch, T, 1);
assert.ok(solid > 0, 'thickenSurface returned no handle');

const mp = forge.massProps(solid);
const vol = Math.abs(mp.volume);
const expectedVol = LX * LY * T;            // 30000
const expectedArea = 2 * LX * LY + 2 * (LX + LY) * T;  // 12000 + 1600 = 13600

console.log('[thicken-smoke] patch =', patch, ' solid =', solid);
console.log('[thicken-smoke] volume =', vol, ' (expected', expectedVol, ')');
console.log('[thicken-smoke] area   =', mp.area, ' (expected', expectedArea, ')');
console.log('[thicken-smoke] CoM    =', JSON.stringify(mp.centerOfMass));

assert.ok(Math.abs(vol - expectedVol) < 1e-6,
  `thicken volume ${vol} != expected ${expectedVol}`);
assert.ok(Math.abs(mp.area - expectedArea) < 1e-6,
  `thicken area ${mp.area} != expected ${expectedArea}`);
assert.ok(Math.abs(mp.centerOfMass[2] - T / 2) < 1e-6,
  `thicken CoM z ${mp.centerOfMass[2]} != expected ${T / 2}`);

console.log('[thicken-smoke] PASS — open surface thickened to exact', expectedVol, 'mm³ solid');
