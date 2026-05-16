import { test, expect } from '@playwright/test';
import {
  qRotate, SpatialMechanism, buildStewartPlatform, stewartLegLengths,
} from '../frontend/src/foundation/SpatialMechanism.js';

// Unit quaternion from axis + angle.
function quat(axis, angle) {
  const n = Math.hypot(...axis) || 1;
  const s = Math.sin(angle / 2);
  return [axis[0] / n * s, axis[1] / n * s, axis[2] / n * s, Math.cos(angle / 2)];
}

// Standard semi-regular Stewart anchors: 3 pairs of anchors, the pairs
// 120° apart, each pair split by ±`spreadDeg`. This isolates the
// assembly modes (a regular hexagon is near-degenerate).
function stewartAnchors(R, z, baseDeg, spreadDeg) {
  const out = [];
  for (let g = 0; g < 3; g++) {
    const c = (baseDeg + g * 120) * Math.PI / 180;
    const s = spreadDeg * Math.PI / 180;
    out.push([R * Math.cos(c - s), R * Math.sin(c - s), z]);
    out.push([R * Math.cos(c + s), R * Math.sin(c + s), z]);
  }
  return out;
}

test.describe('Spatial closed-loop mechanism solver', () => {
  test.describe.configure({ timeout: 120000 });

  test('qRotate applies quaternion rotations correctly', () => {
    // 90° about Z: x̂ → ŷ.
    const r1 = qRotate(quat([0, 0, 1], Math.PI / 2), [1, 0, 0]);
    expect(r1[0]).toBeCloseTo(0, 9);
    expect(r1[1]).toBeCloseTo(1, 9);
    // 180° about X: ŷ → −ŷ.
    const r2 = qRotate(quat([1, 0, 0], Math.PI), [0, 1, 0]);
    expect(r2[1]).toBeCloseTo(-1, 9);
    // Identity leaves a vector unchanged.
    const r3 = qRotate([0, 0, 0, 1], [3, -4, 5]);
    expect(r3).toEqual([3, -4, 5]);
  });

  test('Stewart platform: forward solve finds a valid leg-length configuration', () => {
    // Stewart-platform forward kinematics is genuinely multi-solution
    // (up to 40 assembly modes). From a neutral seed the solver must
    // converge to SOME configuration that satisfies all six leg lengths
    // — i.e. drive the residual to zero — not necessarily the same
    // assembly mode the inverse kinematics started from.
    const base = stewartAnchors(120, 0, 0, 14);
    const platform = stewartAnchors(90, 0, 60, 11);
    const target = { p: [12, -9, 135], q: quat([0.3, 0.5, 0.8], 7 * Math.PI / 180) };
    const legLengths = stewartLegLengths(target, base, platform);

    const mech = buildStewartPlatform({
      baseAnchors: base, platformAnchors: platform, legLengths,
      initialPose: { p: [0, 0, 135], q: [0, 0, 0, 1] },
    });
    const sol = mech.solveAt(0);
    console.log(`\nStewart FK (neutral seed): converged=${sol.converged}, ` +
      `residual=${sol.residualNorm.toExponential(2)}, iters=${sol.iterations}`);
    expect(sol.converged).toBe(true);
    expect(sol.residualNorm).toBeLessThan(1e-7);
    // Verify independently: every leg length of the recovered pose
    // matches the prescribed value.
    const got = sol.links[1];
    const recovered = stewartLegLengths(got, base, platform);
    for (let i = 0; i < 6; i++) expect(recovered[i]).toBeCloseTo(legLengths[i], 4);
  });

  test('Stewart platform: seeded near a pose, FK recovers it to machine precision', () => {
    // Seeded inside the target assembly mode's basin (as a real Stewart
    // controller warm-starts from the last pose), the forward solver
    // recovers the exact pose.
    const base = stewartAnchors(120, 0, 0, 14);
    const platform = stewartAnchors(90, 0, 60, 11);
    const target = { p: [12, -9, 135], q: quat([0.3, 0.5, 0.8], 7 * Math.PI / 180) };
    const legLengths = stewartLegLengths(target, base, platform);

    const mech = buildStewartPlatform({
      baseAnchors: base, platformAnchors: platform, legLengths,
      initialPose: { p: [9, -6, 133], q: quat([0.3, 0.5, 0.8], 5 * Math.PI / 180) },
    });
    const sol = mech.solveAt(0);
    console.log(`Stewart FK (warm seed): residual=${sol.residualNorm.toExponential(2)}, ` +
      `pose=[${sol.links[1].p.map((v) => v.toFixed(3))}]`);
    expect(sol.converged).toBe(true);
    expect(sol.residualNorm).toBeLessThan(1e-7);
    for (let k = 0; k < 3; k++) expect(sol.links[1].p[k]).toBeCloseTo(target.p[k], 3);
    // Orientation: every platform anchor lands where the IK pose put it.
    let maxAnchorErr = 0;
    for (let i = 0; i < 6; i++) {
      const got = sol.links[1];
      const r = qRotate(got.q, platform[i]);
      const rt = qRotate(target.q, platform[i]);
      maxAnchorErr = Math.max(maxAnchorErr, Math.hypot(
        got.p[0] + r[0] - target.p[0] - rt[0],
        got.p[1] + r[1] - target.p[1] - rt[1],
        got.p[2] + r[2] - target.p[2] - rt[2]));
    }
    console.log(`Stewart anchor recovery error: ${maxAnchorErr.toExponential(2)} mm`);
    expect(maxAnchorErr).toBeLessThan(1e-3);
  });

  test('Stewart platform: driven legs move the platform, every frame solved', () => {
    const base = stewartAnchors(120, 0, 0, 14);
    const platform = stewartAnchors(90, 0, 60, 11);
    const home = { p: [0, 0, 135], q: [0, 0, 0, 1] };
    const L0 = stewartLegLengths(home, base, platform);

    const mech = buildStewartPlatform({
      baseAnchors: base, platformAnchors: platform, legLengths: L0, initialPose: home,
    });
    // Extend all six legs uniformly over t ∈ [0,1] → platform rises.
    mech.drivers = L0.map((L, i) => ({ jointIndex: i, fn: (t) => L + 15 * t }));

    let z0 = null, zEnd = null, allConverged = true;
    const N = 12;
    for (let f = 0; f < N; f++) {
      const sol = mech.solveAt(f / (N - 1));
      if (!sol.converged) allConverged = false;
      if (f === 0) z0 = sol.links[1].p[2];
      if (f === N - 1) zEnd = sol.links[1].p[2];
    }
    console.log(`\nStewart driven sweep: z ${z0.toFixed(1)} → ${zEnd.toFixed(1)} mm, all converged=${allConverged}`);
    expect(allConverged).toBe(true);
    expect(zEnd).toBeGreaterThan(z0);          // longer legs → higher platform
  });

  test('Spherical joint: a ball joint + 3 tie-rods solves to a unique pose', () => {
    // Body pinned at its origin to world (0,0,50) by a spherical joint,
    // held by three tie-rods (distance joints) to ground anchors.
    const bodyPts = [[40, 0, 0], [-20, 35, 0], [-20, -35, 0]];
    const groundPts = [[60, 0, 50], [-30, 50, 60], [-30, -50, 40]];
    const target = { p: [0, 0, 50], q: quat([0.2, 0.1, 0.9], 0.35) };
    const rodLen = bodyPts.map((bp, i) => {
      const r = qRotate(target.q, bp);
      return Math.hypot(target.p[0] + r[0] - groundPts[i][0],
        target.p[1] + r[1] - groundPts[i][1], target.p[2] + r[2] - groundPts[i][2]);
    });

    const mech = new SpatialMechanism({
      links: [{ name: 'ground' }, { name: 'body', pose: { p: [0, 0, 50], q: [0, 0, 0, 1] } }],
      joints: [
        { type: 'spherical', linkA: 1, pA: [0, 0, 0], linkB: 0, pB: [0, 0, 50] },
        { type: 'distance', linkA: 1, pA: bodyPts[0], linkB: 0, pB: groundPts[0], dist: rodLen[0] },
        { type: 'distance', linkA: 1, pA: bodyPts[1], linkB: 0, pB: groundPts[1], dist: rodLen[1] },
        { type: 'distance', linkA: 1, pA: bodyPts[2], linkB: 0, pB: groundPts[2], dist: rodLen[2] },
      ],
    });
    const sol = mech.solveAt(0);
    expect(sol.converged).toBe(true);
    expect(sol.residualNorm).toBeLessThan(1e-7);
    // The spherical joint pins the body origin exactly.
    expect(sol.links[1].p[0]).toBeCloseTo(0, 4);
    expect(sol.links[1].p[1]).toBeCloseTo(0, 4);
    expect(sol.links[1].p[2]).toBeCloseTo(50, 4);
  });

  test('Revolute joint: a hinged link keeps its axis aligned', () => {
    // Link 1 hinged to ground about world Z at (0,0,30); one tie-rod
    // (distance joint) pins its angle.
    const phi = 0.6;
    const rodLen = 25 * Math.sqrt(2 - 2 * Math.cos(phi));   // see derivation in test
    const mech = new SpatialMechanism({
      links: [{ name: 'ground' }, { name: 'arm', pose: { p: [0, 0, 30], q: [0, 0, 0, 1] } }],
      joints: [
        {
          type: 'revolute', linkA: 1, linkB: 0, pA: [0, 0, 0], pB: [0, 0, 30],
          axisA: [0, 0, 1], perpA1: [1, 0, 0], perpA2: [0, 1, 0], axisB: [0, 0, 1],
        },
        { type: 'distance', linkA: 1, pA: [25, 0, 0], linkB: 0, pB: [25, 0, 30], dist: rodLen },
      ],
    });
    const sol = mech.solveAt(0);
    expect(sol.converged).toBe(true);
    expect(sol.residualNorm).toBeLessThan(1e-7);
    // The hinge axis stays parallel to world Z.
    const axis = qRotate(sol.links[1].q, [0, 0, 1]);
    expect(axis[0]).toBeCloseTo(0, 5);
    expect(axis[1]).toBeCloseTo(0, 5);
    expect(axis[2]).toBeCloseTo(1, 5);
    // The hinge point is pinned.
    expect(sol.links[1].p[2]).toBeCloseTo(30, 5);
  });

  test('A non-well-posed mechanism is rejected with a clear error', () => {
    // One free link, one spherical joint → 3+1 = 4 equations, 7 unknowns.
    const mech = new SpatialMechanism({
      links: [{ name: 'ground' }, { name: 'free' }],
      joints: [{ type: 'spherical', linkA: 1, pA: [0, 0, 0], linkB: 0, pB: [0, 0, 0] }],
    });
    expect(() => mech.solveAt(0)).toThrow(/well-posed/);
  });
});
