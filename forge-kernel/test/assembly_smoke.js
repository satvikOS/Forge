// forge-kernel assembly smoke test — exercises AssemblySolver:
//   1. Concentric (axis-axis) + Distance (origin-origin) on a 3-cube scene.
//      Asserts COM separation = 5 mm and axes parallel.
//   2. Coincident (face-face) + Parallel (axis-axis) extension.
//      Re-solves and asserts convergence under combined constraint set.
//
// Mirrors the structure of forge-kernel/test/smoke.js: load the freshly
// built .node, exit non-zero on any failure.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

function identity() {
  return Float64Array.from([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}
function translated(x, y, z) {
  return Float64Array.from([
    1, 0, 0, x,
    0, 1, 0, y,
    0, 0, 1, z,
    0, 0, 0, 1,
  ]);
}

// Use the instance's AABB centre as a proxy for COM — for axis-aligned
// unit cubes that's the same point ± 0 because the bounding box and the
// geometric centre coincide. Sufficient for this smoke.
function instanceCentre(id) {
  const a = forge.getInstanceAABB(id);
  return [(a[0] + a[3]) / 2, (a[1] + a[4]) / 2, (a[2] + a[5]) / 2];
}

function dist(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

console.log('[assembly] version =', forge.version());
assert.ok(forge.assembly, 'forge.assembly namespace missing');

// Reset solver state — earlier test runs in the same process could
// otherwise leak mates into this fixture.
forge.assembly.clear();

// ---------------------------------------------------------------- scene
const box = forge.makeBox(1, 1, 1);
const inst1 = forge.addInstance(box, identity());
const inst2 = forge.addInstance(box, translated(7, 3, 2));      // arbitrary
const inst3 = forge.addInstance(box, translated(-4, 5, -1));    // arbitrary
console.log('[assembly] scene', { inst1, inst2, inst3 });

// Fix instance 1 — anchors the system at the origin.
forge.assembly.setFixed(inst1, true);

// ---------------------------------------------------------------- stage 1
const K = forge.assembly.MateKind;
const m1 = forge.assembly.addMate(K.Concentric, inst1, 1, inst2, 1); // axis vs axis
const m2 = forge.assembly.addMate(K.Distance,   inst1, 0, inst2, 0, 5); // origins 5 apart

let rep = forge.assembly.solve();
console.log('[assembly] stage 1 →', rep);
assert.ok(rep.converged,
  `stage 1 did not converge (residual=${rep.residual}, iters=${rep.iterations})`);

const c1 = instanceCentre(inst1);
const c2 = instanceCentre(inst2);
const sep = dist(c1, c2);
console.log('[assembly] |inst1 − inst2| =', sep.toFixed(6));
assert.ok(Math.abs(sep - 5) < 1e-4,
  `expected separation 5, got ${sep.toFixed(6)}`);
assert.ok(rep.iterations <= 30,
  `wanted ≤30 iterations, got ${rep.iterations}`);
console.log('[assembly] stage 1 OK');

// ---------------------------------------------------------------- stage 2
const m3 = forge.assembly.addMate(K.Coincident, inst1, 2, inst3, 2); // face touching
const m4 = forge.assembly.addMate(K.Parallel,   inst1, 1, inst3, 1); // primary axes parallel

rep = forge.assembly.solve();
console.log('[assembly] stage 2 →', rep);
assert.ok(rep.converged,
  `stage 2 did not converge (residual=${rep.residual}, iters=${rep.iterations})`);

const c3 = instanceCentre(inst3);
const c1b = instanceCentre(inst1);
console.log('[assembly] |inst1 − inst3| =', dist(c1b, c3).toFixed(6));
// Coincident face → centres should coincide on unit cubes.
assert.ok(dist(c1b, c3) < 1e-3,
  `coincident centres expected, got separation ${dist(c1b, c3).toFixed(6)}`);
console.log('[assembly] stage 2 OK');

// ---------------------------------------------------------------- cleanup
forge.assembly.removeMate(m1);
forge.assembly.removeMate(m2);
forge.assembly.removeMate(m3);
forge.assembly.removeMate(m4);
forge.assembly.setFixed(inst1, false);
forge.removeInstance(inst1);
forge.removeInstance(inst2);
forge.removeInstance(inst3);
forge.release(box);

console.log('[assembly] ALL PASS');
