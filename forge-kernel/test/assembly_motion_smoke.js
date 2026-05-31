// Forge-35 motion-study smoke.
//
// Builds a 3-bar linkage modelled as a chain of three instances with
// Distance mates between consecutive origins. bar1 is fixed at the
// origin; bar2's distance from bar1 is the driver; bar3 trails bar2 by
// a fixed distance. The motor sweeps the driver's value over a 2π range
// across 36 frames. We assert:
//   * 36 frames captured.
//   * Every frame converged (allConverged == true).
//   * The starting and ending mate values differ exactly by 2π.
//   * bar2 actually moved across the sweep (motion captured per frame).

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

console.log('[motion] version =', forge.version());
assert.ok(forge.assembly && forge.assembly.runMotionStudy,
  'forge.assembly.runMotionStudy missing — Forge-35 binding not loaded');

forge.assembly.clear();
if (forge.assembly.clearHierarchy) forge.assembly.clearHierarchy();

// ---------------------------------------------------------------- scene
const box = forge.makeBox(1, 1, 1);
const bar1 = forge.addInstance(box, identity());
const bar2 = forge.addInstance(box, translated(2, 0, 0));
const bar3 = forge.addInstance(box, translated(5, 0, 0));
forge.assembly.setFixed(bar1, true);

const K = forge.assembly.MateKind;
// 3-bar chain via origin-to-origin Distance mates. The bar1↔bar2 distance
// is the driver; bar2↔bar3 is fixed at 3 mm.
const distAB = forge.assembly.addMate(K.Distance, bar1, 0, bar2, 0, 2);
const distBC = forge.assembly.addMate(K.Distance, bar2, 0, bar3, 0, 3);
console.log('[motion] mates', { distAB, distBC });

// Quick sanity solve before the motion run.
const initial = forge.assembly.solve();
assert.ok(initial.converged, `initial solve failed (residual=${initial.residual})`);

// ---------------------------------------------------------------- motion run
const STEPS = 36;
const TOTAL = 2 * Math.PI;
const run = forge.assembly.runMotionStudy(bar2, 0 /* origin topo */, TOTAL, STEPS);
console.log('[motion] run summary', {
  frames: run.frames.length,
  allConverged: run.allConverged,
  maxResidual: run.maxResidual,
});

assert.strictEqual(run.frames.length, STEPS,
  `expected ${STEPS} frames, got ${run.frames.length}`);
assert.ok(run.allConverged,
  `motion run did not converge for every frame (maxResidual=${run.maxResidual})`);

// First + last frames must reflect the swept parameter.
const first = run.frames[0];
const last  = run.frames[STEPS - 1];
assert.ok(Math.abs(first.t - 0) < 1e-9, `first.t expected 0, got ${first.t}`);
assert.ok(Math.abs(last.t  - 1) < 1e-9, `last.t expected 1, got ${last.t}`);
const valueSwept = last.value - first.value;
assert.ok(Math.abs(valueSwept - TOTAL) < 1e-9,
  `mate value swept by ${valueSwept}, expected ${TOTAL}`);

// Each frame must contain a transform map keyed by InstanceId strings.
assert.ok(first.transforms && Object.keys(first.transforms).length >= 3,
  `frame 0 transforms missing instances (got ${Object.keys(first.transforms).length})`);

// Verify the bar2 transform actually moved between first and last frame.
const t0 = first.transforms[String(bar2)];
const tN = last.transforms[String(bar2)];
assert.ok(t0 && tN, 'bar2 transforms missing on first/last frame');
const origin0 = [t0[3], t0[7], t0[11]];
const originN = [tN[3], tN[7], tN[11]];
console.log('[motion] bar2 origin at t=0:', origin0, ', t=1:', originN);
const moveLen = Math.hypot(originN[0] - origin0[0],
                           originN[1] - origin0[1],
                           originN[2] - origin0[2]);
assert.ok(moveLen > 0.1,
  `bar2 should have moved across the sweep; moved only ${moveLen}`);

// ---------------------------------------------------------------- cleanup
forge.assembly.clear();
[bar1, bar2, bar3].forEach((id) => forge.removeInstance(id));
forge.release(box);

console.log('[motion] ALL PASS');
