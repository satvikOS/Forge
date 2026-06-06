// Slice-10 — Surface workbench: Trim (parametric UV trim) smoke.
//
// Build a flat 100x60 patch (area 6000 mm²), then trim it to the UV
// sub-rectangle u∈[0.25,0.75], v∈[0,1] via surfacing.trim. We expect:
//   * the trimmed face area == 6000 * 0.5 == 3000 mm²  (half the u-range)
//   * the trimmed mesh spans x∈[25,75]  (the kept parametric window)
//
// This guards the trimNurbsFace fix: the old impl built the trim wire from
// 3D straight edges (no pcurve) so MakeFace(surface, wire) returned an
// EMPTY face — trim silently did nothing. The fix builds 2D parametric
// (Geom2d) edges on the surface + BRepLib::BuildCurves3d, so the trim is
// real. Mirrors SolidWorks "Trim Surface" / NX "Trim Sheet" / CATIA "Split".

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.surfacing && typeof forge.surfacing.trim === 'function',
          'forge.surfacing.trim missing');

const xyz = new Float64Array([0, 0, 0, 100, 0, 0, 0, 60, 0, 100, 60, 0]);
const patch = forge.surfacing.buildPatch({ uCount: 2, vCount: 2, xyz }, 1, 1);
assert.ok(patch > 0, 'buildPatch returned no handle');

const fullArea = forge.massProps(patch).area;
console.log('[trim-smoke] full patch area =', fullArea, ' (expected 6000)');
assert.ok(Math.abs(fullArea - 6000) < 1e-6, `full area ${fullArea} != 6000`);

// Trim to u[0.25,0.75] x v[0,1] — a CCW loop in UV space.
const trimmed = forge.surfacing.trim(patch, [0.25, 0, 0.75, 0, 0.75, 1, 0.25, 1]);
assert.ok(trimmed > 0, 'trim returned no handle');

const area = forge.massProps(trimmed).area;
const mesh = forge.tessellate(trimmed, 0.5, 0.6);
const triCount = mesh.indices.length / 3;
let minx = Infinity, maxx = -Infinity;
for (let i = 0; i < mesh.positions.length; i += 3) {
    minx = Math.min(minx, mesh.positions[i]);
    maxx = Math.max(maxx, mesh.positions[i]);
}

console.log('[trim-smoke] trimmed area =', area, ' (expected 3000)');
console.log('[trim-smoke] trimmed mesh tris =', triCount, ' x-range =', minx, maxx, ' (expected 25..75)');

assert.ok(triCount > 0, 'trimmed face produced an EMPTY mesh — trim did nothing');
assert.ok(Math.abs(area - 3000) < 1e-6, `trimmed area ${area} != 3000`);
assert.ok(Math.abs(minx - 25) < 1e-6 && Math.abs(maxx - 75) < 1e-6,
  `trimmed x-range [${minx},${maxx}] != [25,75]`);

console.log('[trim-smoke] PASS — patch trimmed to exact 3000 mm² (u[0.25,0.75]) parametric window');
