// Slice-9 — Surface workbench: Knit (sew) surfaces → shell smoke.
//
// Build two adjacent flat 100x60 patches that share the edge at x=100
// (patch A spans x 0..100, patch B spans x 100..200), then knit them into
// a single shell via surfacing.sew. We expect:
//   * the sewn shell area == 2 * (100*60) == 12000 mm²  (both patches)
//   * thickening the sewn shell 4mm yields ONE solid of |volume| ==
//     200 * 60 * 4 == 48000 mm³  — proving the two patches really merged
//     into one continuous 200-wide shell (not two disjoint faces).
//
// This anchors the Knit command (SolidWorks Knit Surface / NX Sew /
// CATIA GSD Join) on an analytical baseline and proves the knit→thicken
// pipeline end to end in the kernel.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.surfacing && typeof forge.surfacing.sew === 'function',
          'forge.surfacing.sew missing');
assert.ok(forge.part && typeof forge.part.thickenSurface === 'function',
          'forge.part.thickenSurface missing');

const A = new Float64Array([0, 0, 0, 100, 0, 0, 0, 60, 0, 100, 60, 0]);
const B = new Float64Array([100, 0, 0, 200, 0, 0, 100, 60, 0, 200, 60, 0]);
const pa = forge.surfacing.buildPatch({ uCount: 2, vCount: 2, xyz: A }, 1, 1);
const pb = forge.surfacing.buildPatch({ uCount: 2, vCount: 2, xyz: B }, 1, 1);
assert.ok(pa > 0 && pb > 0, 'buildPatch returned no handle');

const shell = forge.surfacing.sew([pa, pb], 1e-3);
assert.ok(shell > 0, 'sew returned no handle');

const shellProps = forge.massProps(shell);
console.log('[knit-smoke] patches =', pa, pb, ' shell =', shell);
console.log('[knit-smoke] shell area =', shellProps.area, ' (expected 12000)');
assert.ok(Math.abs(shellProps.area - 12000) < 1e-6,
  `knit shell area ${shellProps.area} != 12000`);

// Thicken the sewn shell: if the patches truly merged, this is one
// 200 x 60 x 4 slab == 48000 mm³.
const solid = forge.part.thickenSurface(shell, 4, 1);
const solidProps = forge.massProps(solid);
const vol = Math.abs(solidProps.volume);
console.log('[knit-smoke] thickened shell volume =', vol, ' (expected 48000)');
console.log('[knit-smoke] CoM =', JSON.stringify(solidProps.centerOfMass));

assert.ok(Math.abs(vol - 48000) < 1e-6,
  `knit→thicken volume ${vol} != 48000 (patches did not merge into one shell)`);
// CoM x at the centre of the merged 200-wide slab == 100.
assert.ok(Math.abs(solidProps.centerOfMass[0] - 100) < 1e-6,
  `knit→thicken CoM x ${solidProps.centerOfMass[0]} != 100`);

console.log('[knit-smoke] PASS — two patches knit into one shell, thickened to exact 48000 mm³');
