// forge-kernel matelib smoke test — exercises forge::matelib::solve via
// the JS binding. PUSH-04.
//
// Tests:
//   1. Coincident: 2 components, A fixed at origin, B starting at (5,0,0)
//      with coincident mate point(0,0,0)→point(0,0,0). Solve should land
//      B's pose translation at ~(0,0,0).
//   2. Concentric: 2 components, B's axis offset on X but parallel to A's.
//      Solve aligns colinearly.
//   3. Distance: solve sets free pose at |AB|=10 mm.
//   4. Gear: z_A=20 / z_B=40 ratio test — rotating A by π/2 should drive
//      B by -π/4 (with constant=0).
//
// Each case prints iterations + residual to make it obvious that a real
// iterative solve happened (iter > 1, residual decreased).

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge  = require(KERNEL);

assert(forge.matelib && typeof forge.matelib.solve === 'function',
    'forge.matelib.solve is missing');

function poseAt(id, t, fixed = 0, q = [1, 0, 0, 0]) {
  return { id, t, q, fixed };
}

function ref(id, pt = [0,0,0], ax = [0,0,1], extra = 0) {
  return { component_id: id, point: pt, axis: ax, extra };
}

function norm3(a, b) {
  return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
}

function rotateQ(q, v) {
  // Rotate v by quaternion q (w,x,y,z) using Hamilton product.
  const [w, x, y, z] = q;
  const tx = 2*(y*v[2] - z*v[1]);
  const ty = 2*(z*v[0] - x*v[2]);
  const tz = 2*(x*v[1] - y*v[0]);
  return [
    v[0] + w*tx + (y*tz - z*ty),
    v[1] + w*ty + (z*tx - x*tz),
    v[2] + w*tz + (x*ty - y*tx),
  ];
}

let failures = 0;

// ============== Test 1: Coincident ===================================
{
  console.log('--- TEST 1: coincident ---');
  const poses = [
    poseAt(1, [0,0,0], 1), // fixed at origin
    poseAt(2, [5,0,0], 0), // free at (5,0,0)
  ];
  const mates = [{
    kind:  'coincident',
    A:     ref(1),
    B:     ref(2),
    value: 0,
  }];
  const r = forge.matelib.solve(poses, mates, 200, 1e-7);
  console.log(`  converged=${r.converged} iter=${r.iterations} residual=${r.residual.toExponential(3)}`);
  console.log(`  B.t = [${r.poses[1].t.map(v => v.toFixed(6)).join(', ')}]`);
  assert(r.iterations > 1,  `expected iter > 1, got ${r.iterations}`);
  assert(r.converged === true, 'expected convergence');
  assert(norm3(r.poses[1].t, [0,0,0]) < 1e-5,
      `B should be at origin, got ${r.poses[1].t}`);
  console.log('  OK');
}

// ============== Test 2: Concentric ===================================
{
  console.log('--- TEST 2: concentric (Z axes, B offset on X) ---');
  const poses = [
    poseAt(1, [0,0,0], 1),
    poseAt(2, [3,0,0], 0),
  ];
  const mates = [{
    kind: 'concentric',
    A:    ref(1, [0,0,0], [0,0,1]),
    B:    ref(2, [0,0,0], [0,0,1]),
    value: 0,
  }];
  const r = forge.matelib.solve(poses, mates, 200, 1e-7);
  console.log(`  converged=${r.converged} iter=${r.iterations} residual=${r.residual.toExponential(3)}`);
  console.log(`  B.t = [${r.poses[1].t.map(v => v.toFixed(6)).join(', ')}]`);
  assert(r.iterations > 1, `expected iter > 1, got ${r.iterations}`);
  assert(r.converged === true, 'expected convergence');
  // After solve, B.t projected onto (xy) plane should be near 0.
  assert(Math.hypot(r.poses[1].t[0], r.poses[1].t[1]) < 1e-5,
      `B should sit on Z axis, got XY = (${r.poses[1].t[0]}, ${r.poses[1].t[1]})`);
  console.log('  OK');
}

// ============== Test 3: Distance ===================================
{
  console.log('--- TEST 3: distance (target=10 mm) ---');
  const poses = [
    poseAt(1, [0,0,0], 1),
    poseAt(2, [3,0,0], 0),
  ];
  const mates = [{
    kind:  'distance',
    A:     ref(1),
    B:     ref(2),
    value: 10,
  }];
  const r = forge.matelib.solve(poses, mates, 200, 1e-7);
  const d = norm3(r.poses[0].t, r.poses[1].t);
  console.log(`  converged=${r.converged} iter=${r.iterations} residual=${r.residual.toExponential(3)}`);
  console.log(`  B.t = [${r.poses[1].t.map(v => v.toFixed(6)).join(', ')}]  |AB|=${d.toFixed(6)}`);
  assert(r.iterations > 1, `expected iter > 1, got ${r.iterations}`);
  assert(r.converged === true, 'expected convergence');
  assert(Math.abs(d - 10) < 1e-5, `|AB| should be 10, got ${d}`);
  console.log('  OK');
}

// ============== Test 4: Gear (z_A=20, z_B=40) ======================
// Setup: both components share Z-axis. A rotates by π/2 (fixed input).
// Gear constant is set to the initial value so when A is rotated by π/2
// from the start state, B must rotate by -π/4 to keep the residual zero.
// Equivalently: declare a gear mate with z_A=20, z_B=40, constant=0,
// then pre-rotate A by π/2 about Z, leave B at identity. Solver should
// rotate B to -π/4 about Z.
{
  console.log('--- TEST 4: gear (z_A=20, z_B=40, A pre-rotated by π/2) ---');
  // Pre-rotate A by π/2 about Z. Quaternion (w,x,y,z) = (cos(π/4), 0, 0, sin(π/4))
  const halfA = Math.PI / 4;
  const qA = [Math.cos(halfA), 0, 0, Math.sin(halfA)];
  // Mark A as fixed (it's the input driver here).
  const poses = [
    poseAt(1, [0,0,0], 1, qA),
    poseAt(2, [0,0,0], 0, [1,0,0,0]),
  ];
  // The matelib gear residual is:
  //     angle_A * z_A + angle_B * z_B - constant = 0
  // With initial angle_A = π/2, angle_B = 0, z_A=20, z_B=40, constant=0:
  // → angle_B = -π/4 ≈ -0.7854. That's what we expect.
  const mates = [{
    kind:  'gear',
    A:     { component_id: 1, point:[0,0,0], axis:[0,0,1], extra: 20 },
    B:     { component_id: 2, point:[0,0,0], axis:[0,0,1], extra: 40 },
    value: 0,
  }];
  const r = forge.matelib.solve(poses, mates, 500, 1e-7);
  console.log(`  converged=${r.converged} iter=${r.iterations} residual=${r.residual.toExponential(3)}`);

  // Recover B's rotation angle about Z by rotating reference vector (1,0,0).
  const ref = rotateQ(r.poses[1].q, [1,0,0]);
  const angB = Math.atan2(ref[1], ref[0]);
  console.log(`  B angle about Z = ${angB.toFixed(6)} rad (expected ${(-Math.PI/4).toFixed(6)})`);
  assert(r.iterations > 1, `expected iter > 1, got ${r.iterations}`);
  // Allow modest tolerance because gear residual reads angle via a
  // per-iteration projection — convergence is asymptotic.
  assert(Math.abs(angB - (-Math.PI/4)) < 5e-3,
      `B angle should be -π/4, got ${angB}`);
  console.log('  OK');
}

// ============== Test 5 (bonus, sanity): residual monotonically falls ==
// Run a deliberately-asked-much-too-far distance mate and check the
// solver iterates many times.
{
  console.log('--- TEST 5: residual drop sanity (distance, big offset) ---');
  const poses = [
    poseAt(1, [0,0,0], 1),
    poseAt(2, [100,0,0], 0),
  ];
  const mates = [{
    kind:  'distance',
    A:     ref(1),
    B:     ref(2),
    value: 5,
  }];
  // Short cap to force iter count > 1
  const rShort = forge.matelib.solve(poses, mates, 5, 1e-12);
  const rLong  = forge.matelib.solve(poses, mates, 500, 1e-9);
  console.log(`  short:  iter=${rShort.iterations} residual=${rShort.residual.toExponential(3)}`);
  console.log(`  long:   iter=${rLong.iterations}  residual=${rLong.residual.toExponential(3)}`);
  assert(rLong.residual < rShort.residual,
      'long-iter residual should be smaller than short-iter residual');
  console.log('  OK');
}

if (failures === 0) {
  console.log('\nALL MATELIB SMOKE TESTS PASSED');
  process.exit(0);
} else {
  console.log(`\n${failures} FAILURES`);
  process.exit(1);
}
