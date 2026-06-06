// Slice-14 — Routing: A* pipe route → real 3D pipe solid smoke.
//
// Routes a pipe centerline around an obstacle with the A* router, then
// sweeps a circular profile along it to build a real 3D pipe SOLID:
//   * piperoute.route finds a polyline (>= 2 segments) around the box
//     obstacle, with totalLength > the straight-line distance.
//   * part.pipeFromPolyline(polyline, r) sweeps a radius-r circle along it
//     → a watertight tube whose volume is positive and close to
//     π·r²·length (mitred corners make it a touch less, never more).
//
// Mirrors SolidWorks/NX Routing: route centerline → pipe from centerline.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.piperoute && typeof forge.piperoute.route === 'function', 'piperoute missing');
assert.ok(forge.part && typeof forge.part.pipeFromPolyline === 'function',
          'forge.part.pipeFromPolyline missing');

const route = forge.piperoute.route({
  start: { position: [0, 0, 0],  direction: [1, 0, 0] },
  end:   { position: [20, 8, 0], direction: [1, 0, 0] },
  obstacles: [{ min: [6, -3, -3], max: [12, 3, 3] }],
  gridSpacing: 1.0, elbowPenalty: 0.5, bbMargin: 6.0, maxIterations: 200000,
});
assert.ok(route.found !== false, 'router failed to find a path');
const poly = Array.from(route.polyline);
const ptCount = poly.length / 3;
console.log('[pipe-smoke] route pts =', ptCount, ' totalLength =', route.totalLength,
            ' elbows =', route.elbowCount);
assert.ok(ptCount >= 3, `expected a routed polyline with >=3 pts, got ${ptCount}`);
// Routed around the obstacle ⇒ longer than the straight start→end distance.
const straight = Math.hypot(20, 8, 0);
assert.ok(route.totalLength > straight, `routed length ${route.totalLength} should exceed straight ${straight.toFixed(1)}`);

const R = 1.5;
const pipe = forge.part.pipeFromPolyline(poly, R);
assert.ok(pipe > 0, 'pipeFromPolyline returned no handle');

const mp = forge.massProps(pipe);
const vol = Math.abs(mp.volume);
const naive = Math.PI * R * R * route.totalLength; // upper bound (no mitre loss)
console.log('[pipe-smoke] pipe volume =', vol.toFixed(1), ' (naive πr²L =', naive.toFixed(1), ')');

const mesh = forge.tessellate(pipe, 0.3, 0.6);
const tris = mesh.indices.length / 3;
console.log('[pipe-smoke] pipe mesh tris =', tris);

assert.ok(vol > 0, 'pipe volume must be positive');
// A solid tube: between half the naive volume (generous mitre allowance)
// and the naive upper bound.
assert.ok(vol > naive * 0.5 && vol <= naive * 1.02,
  `pipe volume ${vol.toFixed(1)} not in expected band (${(naive*0.5).toFixed(1)}..${naive.toFixed(1)})`);
assert.ok(tris > 0, 'pipe must tessellate to real geometry');

console.log('[pipe-smoke] PASS — A* route → swept 3D pipe solid around the obstacle');
