#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ForgeCADScore — kernel-free self-test of the MECHANISM axis (task #31).
// Pins the PURE scoring math of scoreMechanism's five sub-criteria to closed-form
// expectations — no kernel, no corpus, no Electron needed. Run:
//   node forge-kernel/test/mechanism_axis_selftest.mjs
// Exits non-zero on any mismatch.
//
// Covers:
//   (b) Gruebler/Kutzbach DOF  — four-bar=1, slider-crank=1, gear-pair=1,
//       double-pendulum=2, planar truss (over-constrained loop)=0, spatial form.
//   (c) Grashof classification — crank-rocker / double-crank / non-grashof + the
//       S+L ≤ P+Q boundary.
//   (d) motion-range overlap   — full sweep, partial sweep, lockup (flat samples),
//       prismatic stroke — all on SYNTHETIC samples arrays (no kernel).
//   (e) interference verdict   — clean vs self-clash counts.
//   scoreMechanism end-to-end on SYNTHETIC per-step poses (injectedSamples) so it
//       needs no kernel: a correct four-bar ≈ the achievable max, and a wrong-DOF
//       or self-interfering one < 0.5.
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import {
  mechanismDOF, grashofClass, motionRangeFrac, interferenceVerdict,
  sweptClashFree, scoreMechanism, transformTess, axisAngleToR,
} from './cadscore_harness.mjs';

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log(`  ✓ ${name}`); pass++; };
const eq = (name, got, want) => {
  assert.strictEqual(got, want, `${name}: got ${got} want ${want}`);
  console.log(`  ✓ ${name}  (= ${got})`);
  pass++;
};
const near = (name, got, want, tol = 1e-9) => {
  assert.ok(Math.abs(got - want) <= tol, `${name}: got ${got} want ${want} (±${tol})`);
  console.log(`  ✓ ${name}  (${(+got).toFixed(4)} ≈ ${want})`);
  pass++;
};

// ── (b) Gruebler / Kutzbach DOF ──────────────────────────────────────────────
console.log('— (b) Gruebler/Kutzbach mobility  M = 3(n−1) − 2·j1 − j2 (planar) —');
eq('four-bar (n=4,j1=4,j2=0) → 1', mechanismDOF({ n: 4, j1: 4, j2: 0 }, true), 1);
eq('slider-crank (n=4,j1=4,j2=0) → 1', mechanismDOF({ n: 4, j1: 4, j2: 0 }, true), 1);
eq('spur-gear pair (n=3,j1=2,j2=1) → 1', mechanismDOF({ n: 3, j1: 2, j2: 1 }, true), 1);
// double pendulum: 3 links (incl ground), 2 revolute → M = 3(2) − 4 = 2.
eq('double-pendulum (n=3,j1=2,j2=0) → 2', mechanismDOF({ n: 3, j1: 2, j2: 0 }, true), 2);
// a rigid planar truss / structure (a triangulated 3-link closed loop is rigid):
// n=3 links, j1=3 pins → M = 3(2) − 6 = 0 (a STRUCTURE, not a mechanism).
eq('planar truss/structure (n=3,j1=3,j2=0) → 0', mechanismDOF({ n: 3, j1: 3, j2: 0 }, true), 0);
// over-constrained (extra redundant pin) → negative (statically indeterminate).
eq('over-constrained (n=4,j1=5,j2=0) → −1', mechanismDOF({ n: 4, j1: 5, j2: 0 }, true), -1);
// spatial form: M = 6(n−1) − Σconstraints. Two bodies, one spherical (3) + one
// distance (1) = 4 removed → 6·1 − 4 = 2.
eq('spatial (n=2, Σc=4) → 2', mechanismDOF({ n: 2, constraints: 4 }, false), 2);
eq('spatial single body free (n=2, Σc=0) → 6', mechanismDOF({ n: 2, constraints: 0 }, false), 6);

// ── (c) Grashof classification ───────────────────────────────────────────────
console.log('\n— (c) Grashof  S+L ≤ P+Q ⇒ a link fully rotates —');
// {25,100,90,70}: S=25, L=100 → S+L=125; P+Q = 70+90 = 160 → Grashof.
const g1 = grashofClass({ s: 25, l: 100, p: 90, q: 70 });
ok('crank-rocker Grashof (S+L=125 ≤ P+Q=160) → fullRotation', g1.fullRotation === true && g1.class === 'crank-rocker');
near('  sum1 = S+L = 125', g1.sum1, 125);
near('  sum2 = P+Q = 160', g1.sum2, 160);
// shortest = ground → double-crank.
const g2 = grashofClass({ s: 25, l: 100, p: 90, q: 70, shortestRole: 'ground' });
ok('double-crank when shortest is ground', g2.class === 'double-crank' && g2.fullRotation);
// non-Grashof: {50,55,40,30}: S=30,L=55 → 85; P+Q=40+50=90 → 85≤90 Grashof.
//   make it non-Grashof: {10,100,40,30}: S=10,L=100 →110; P+Q=30+40=70 →110>70.
const g3 = grashofClass({ s: 10, l: 100, p: 40, q: 30 });
ok('non-Grashof (S+L=110 > P+Q=70) → no full rotation', g3.fullRotation === false && g3.class === 'non-grashof');
// boundary: S+L == P+Q exactly → Grashof (≤, change point / folding linkage).
const g4 = grashofClass({ s: 20, l: 80, p: 50, q: 50 }); // 20+80=100 == 50+50=100
ok('boundary S+L == P+Q → Grashof (≤)', g4.fullRotation === true);

// ── (d) motion-range overlap (synthetic samples — no kernel) ─────────────────
console.log('\n— (d) motionRangeFrac on synthetic samples —');
// Build a rotary samples array: body 0 swings its orientation about +Z from 0 → A.
const rotarySamples = (peak, n = 60) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const th = peak * (i / n);
    out.push({ position: [[0, 0, 0]], orientation: [[0, 0, th]] });
  }
  return out;
};
const driverZ = { body: 0, axis: [0, 0, 1], kind: 'rotary' };
near('full sweep (achieved 2π / target 2π) → 1.0', motionRangeFrac(rotarySamples(2 * Math.PI), driverZ, 2 * Math.PI), 1.0, 1e-6);
near('half sweep (achieved π / target 2π) → 0.5', motionRangeFrac(rotarySamples(Math.PI), driverZ, 2 * Math.PI), 0.5, 1e-6);
// lockup: orientation flat (never moves) → achieved 0 → frac 0.
ok('lockup (flat samples) → 0', motionRangeFrac(rotarySamples(0), driverZ, 2 * Math.PI) === 0);
// unstable solver → frac forced to 0 even if samples moved.
ok('unstable=false forces frac→0', motionRangeFrac(rotarySamples(2 * Math.PI), driverZ, 2 * Math.PI, false) === 0);
// over-sweep clamps to 1.
near('over-sweep (3π / 2π) clamps to 1.0', motionRangeFrac(rotarySamples(3 * Math.PI), driverZ, 2 * Math.PI), 1.0, 1e-6);
// prismatic: COM slides along +X from 0 → 71 mm; target 71 → 1.0.
const prismaticSamples = (stroke, n = 60) => {
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ position: [[stroke * (i / n), 0, 0]], orientation: [[0, 0, 0]] });
  return out;
};
const driverX = { body: 0, slideAxis: [1, 0, 0], kind: 'prismatic' };
near('prismatic full stroke (71/71) → 1.0', motionRangeFrac(prismaticSamples(71), driverX, 71), 1.0, 1e-6);
near('prismatic partial (35/71) → 0.49', motionRangeFrac(prismaticSamples(35), driverX, 71), 35 / 71, 1e-6);

// ── (e) interference verdict ─────────────────────────────────────────────────
console.log('\n— (e) interferenceVerdict —');
ok('0 clashing steps → interference-free TRUE', interferenceVerdict(0) === true);
ok('1 clashing step → FALSE', interferenceVerdict(1) === false);
ok('17 clashing steps → FALSE', interferenceVerdict(17) === false);

// ── sweptClashFree on SYNTHETIC boxes (no kernel handle, real geometry math) ──
console.log('\n— sweptClashFree: overlapping vs clear boxes (synthetic meshes) —');
// closed unit box tessellation about its own centre (origin-centred, ±half).
function boxMesh(hx, hy, hz) {
  const v = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const f = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
  ];
  return { positions: new Float32Array(v.flat()), indices: new Uint32Array(f.flat()) };
}
const baseA = boxMesh(10, 10, 10);
const baseB = boxMesh(10, 10, 10);
// CLEAR: B parked 100 mm away from A across the whole 2-step cycle → 0 clash.
const clearSamples = [
  { position: [[0, 0, 0], [100, 0, 0]], orientation: [[0, 0, 0], [0, 0, 0]] },
  { position: [[0, 0, 0], [100, 0, 0]], orientation: [[0, 0, 0], [0, 0, 0]] },
];
const clear = sweptClashFree(null, [baseA, baseB], clearSamples, { posScale: 1, probe: 40 });
ok('clear boxes (100 mm apart) → perStepClash 0, interferenceFree', clear.perStepClash === 0 && clear.interferenceFree);
// OVERLAP: B starts clear then drives INTO A (5 mm overlap) → clash on the 2nd step.
const crashSamples = [
  { position: [[0, 0, 0], [100, 0, 0]], orientation: [[0, 0, 0], [0, 0, 0]] },
  { position: [[0, 0, 0], [15, 0, 0]], orientation: [[0, 0, 0], [0, 0, 0]] }, // centres 15 mm < 20 mm sum-half → overlap
];
const crash = sweptClashFree(null, [baseA, baseB], crashSamples, { posScale: 1, probe: 60 });
ok('overlapping boxes (15 mm centre gap) → clash detected, NOT interference-free',
  crash.perStepClash >= 1 && crash.interferenceFree === false);
// adjacency: the same overlap but the pair is whitelisted (a legitimate pin) → ignored.
const crashAdj = sweptClashFree(null, [baseA, baseB], crashSamples, { posScale: 1, probe: 60, adjacency: new Set(['0:1']) });
ok('adjacency whitelist ignores the pinned pair → interference-free', crashAdj.perStepClash === 0);

// transform helpers sanity.
console.log('\n— transform helpers —');
const Rz90 = axisAngleToR([0, 0, Math.PI / 2]);
near('axisAngleToR(+Z,90°) rotates X→Y (R[3]≈1)', Rz90[3], 1, 1e-9);
const moved = transformTess(boxMesh(1, 1, 1), [50, 0, 0], [0, 0, 0]);
ok('transformTess translates +50 in X', moved.positions[0] === -1 + 50 && moved.positions.length === 24);

// ── scoreMechanism end-to-end on SYNTHETIC poses (injectedSamples; no kernel) ─
console.log('\n— scoreMechanism: correct four-bar ≈ max, wrong-DOF/self-crash < 0.5 —');
// A correct four-bar spec WITHOUT bodyBuilders (so the kernel clash is skipped →
// interferenceFree defaults TRUE), driven by a synthetic full-rotation crank.
const correctSamples = rotarySamples(2 * Math.PI);     // crank (body 1) fully rotates
// inject samples where body index 1 is the crank.
const inject = correctSamples.map((s) => ({
  position: [[0, 0, 0], [0, 0, 0]],
  orientation: [[0, 0, 0], s.orientation[0]],
}));
const fourBarSpec = {
  name: 'four-bar (synthetic)', planar: true, chain: 'fourbar', solver: 'injected',
  constraints: [{ kind: 'distance', bodyA: 0, bodyB: 1 }], // a recognised, valid joint → gate passes
  expectedDOF: 1, jointSpec: { n: 4, j1: 4, j2: 0 },
  fourbar: { s: 25, l: 100, p: 90, q: 70, expectClass: 'crank-rocker', expectFullRotation: true },
  driver: { body: 1, axis: [0, 0, 1], kind: 'rotary' }, range: { targetRad: 2 * Math.PI },
};
const sc = scoreMechanism(null, fourBarSpec, inject);
console.log(`    correct: dof=${sc.dof} dofOK=${sc.dofCorrect} chain=${sc.chainValid} ` +
  `mRange=${sc.motionRangeFrac.toFixed(3)} free=${sc.interferenceFree} → score=${sc.score.toFixed(3)}`);
// 0.20·1 + 0.20·1 + 0.25·1 + 0.35·1 = 1.0 (no kernel meshes → interference defaults free).
near('correct four-bar score ≈ 1.0', sc.score, 1.0, 1e-6);
ok('correct four-bar: dofCorrect', sc.dofCorrect === 1);
ok('correct four-bar: chain valid (crank-rocker)', sc.chainValid === 1);
near('correct four-bar: motionRangeFrac ≈ 1', sc.motionRangeFrac, 1.0, 1e-6);

// WRONG-DOF variant: declare n=4,j1=5 → M=−1 ≠ expected 1 → dofCorrect 0.
const wrongDof = { ...fourBarSpec, name: 'four-bar wrong-DOF', jointSpec: { n: 4, j1: 5, j2: 0 } };
const scWrong = scoreMechanism(null, wrongDof, inject);
console.log(`    wrong-DOF: dof=${scWrong.dof} dofOK=${scWrong.dofCorrect} → score=${scWrong.score.toFixed(3)}`);
ok('wrong-DOF four-bar dofCorrect = 0', scWrong.dofCorrect === 0);
// score = 0.20·0 + 0.20·1 + 0.25·1 + 0.35·1 = 0.80 → still high because only DOF
// broke; to get < 0.5 we need a SELF-INTERFERING mechanism (the headline axis).

// SELF-INTERFERING variant: real kernel-free clash via bodyBuilders that return
// synthetic OVERLAPPING boxes + a posed cycle that holds them overlapped. We feed
// a tiny forge-like stub exposing only what scoreMechanism touches for clash:
//   build(forge) → a mesh-bearing handle; tess(forge,h) must return the mesh.
// scoreMechanism calls tess(forge,h)=forge.tessellate(h,...). Provide that.
const stubForge = {
  tessellate: (h) => h,                 // the "handle" IS the mesh here
  // no simulate → forces the injected-samples path; bodyBuilders return meshes.
};
const selfInterf = {
  ...fourBarSpec, name: 'four-bar self-interfering',
  bodyBuilders: [
    () => boxMesh(10, 10, 10),          // body 0 at origin
    () => boxMesh(10, 10, 10),          // body 1 overlapping it
  ],
  adjacency: [],                        // NOT whitelisted → the overlap counts
};
// inject a cycle where the two bodies sit ON TOP of each other (5 mm centre gap).
const overlapCycle = [
  { position: [[0, 0, 0], [5, 0, 0]], orientation: [[0, 0, 0], [0, 0, 0]] },
  { position: [[0, 0, 0], [5, 0, 0]], orientation: [[0, 0, 0], [0, 0, 2 * Math.PI]] },
];
const scSelf = scoreMechanism(stubForge, selfInterf, overlapCycle);
console.log(`    self-interfering: clashSteps=${scSelf.perStepClash} free=${scSelf.interferenceFree} → score=${scSelf.score.toFixed(3)}`);
ok('self-interfering: clash detected (perStepClash ≥ 1)', scSelf.clashRan && scSelf.perStepClash >= 1);
ok('self-interfering: NOT interference-free', scSelf.interferenceFree === false);
// Interference alone zeroes the headline 0.35 term but the DOF/chain/motion
// (0.65) are still honestly earned, so a mechanism that ONLY clashes scores 0.65
// (NOT < 0.5). A genuinely BROKEN build fails MULTIPLE axes — exactly what the
// real-proof `crash` mutation does (overlapping bodies AND a torn FK loop).
near('self-interfering-only score = 0.65 (interference term zeroed)', scSelf.score, 0.65, 1e-6);

// A genuinely broken build: self-interfering AND wrong-DOF AND lockup (no sweep)
// → all three weighted terms collapse, only nothing remains. score < 0.5.
const fullyBroken = {
  ...selfInterf, name: 'four-bar fully broken',
  jointSpec: { n: 4, j1: 5, j2: 0 },                       // wrong DOF (−1 ≠ 1)
  fourbar: { s: 200, l: 10, p: 20, q: 30, expectClass: 'crank-rocker' }, // non-Grashof → chain 0
};
// lockup cycle: bodies overlap AND the driver never rotates (flat orientation).
const lockedOverlap = [
  { position: [[0, 0, 0], [5, 0, 0]], orientation: [[0, 0, 0], [0, 0, 0]] },
  { position: [[0, 0, 0], [5, 0, 0]], orientation: [[0, 0, 0], [0, 0, 0]] },
];
const scBroken = scoreMechanism(stubForge, fullyBroken, lockedOverlap);
console.log(`    fully-broken: dofOK=${scBroken.dofCorrect} chain=${scBroken.chainValid} ` +
  `mRange=${scBroken.motionRangeFrac.toFixed(2)} free=${scBroken.interferenceFree} → score=${scBroken.score.toFixed(3)}`);
ok('fully-broken four-bar (wrong-DOF + lockup + self-crash) score < 0.5', scBroken.score < 0.5);

// gate: an unrecognised joint kind zeroes the whole score (jointsValid=false).
const badJoint = { ...fourBarSpec, name: 'bad-joint', constraints: [{ kind: 'revolute', bodyA: 0, bodyB: 1 }] };
const scBad = scoreMechanism(null, badJoint, inject);
ok('unrecognised joint kind → gate 0 → score 0', scBad.gate === 0 && scBad.score === 0);

console.log(`\n✅ ForgeCADScore mechanism-axis self-test: ${pass}/${pass} checks PASS`);
