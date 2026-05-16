import { test, expect } from '@playwright/test';
import { PlanarMechanism, SpatialChain } from '../frontend/src/foundation/KinematicsCore.js';
import { runMotionStudy, runSpatialMotion } from '../frontend/src/foundation/MotionStudy.js';

function sliderCrank(r, l) {
  return new PlanarMechanism({
    links: [{ name: 'ground' }, { name: 'crank' }, { name: 'conrod' }, { name: 'slider' }],
    joints: [
      { type: 'revolute', linkA: 0, linkB: 1, pA: [0, 0], pB: [0, 0] },
      { type: 'revolute', linkA: 1, linkB: 2, pA: [r, 0], pB: [0, 0] },
      { type: 'revolute', linkA: 2, linkB: 3, pA: [l, 0], pB: [0, 0] },
      { type: 'prismatic', linkA: 0, linkB: 3, pA: [0, 0], pB: [0, 0], axisAngle: 0, perpOffset: 0 },
    ],
    drivers: [{ jointIndex: 0, fn: () => 0 }],
  });
}

function fourBar(Lc, Lco, Lr, Lg) {
  return new PlanarMechanism({
    links: [{ name: 'ground' }, { name: 'crank' }, { name: 'coupler' }, { name: 'rocker' }],
    joints: [
      { type: 'revolute', linkA: 0, linkB: 1, pA: [0, 0], pB: [0, 0] },
      { type: 'revolute', linkA: 1, linkB: 2, pA: [Lc, 0], pB: [0, 0] },
      { type: 'revolute', linkA: 2, linkB: 3, pA: [Lco, 0], pB: [Lr, 0] },
      { type: 'revolute', linkA: 3, linkB: 0, pA: [0, 0], pB: [Lg, 0] },
    ],
    drivers: [{ jointIndex: 0, fn: () => 0 }],
  });
}

test.describe('Motion study', () => {
  test.describe.configure({ timeout: 120000 });

  test('Slider-crank velocity matches the analytic piston-speed relation', () => {
    const r = 40, l = 120, omega = 2 * Math.PI;   // one rev over t ∈ [0,1]
    const theta0 = 0.2;
    const mech = sliderCrank(r, l);
    mech.drivers[0].fn = (t) => theta0 + omega * t;

    // Seed the first configuration so NR locks the right branch.
    const x0 = r * Math.cos(theta0) + Math.sqrt(l * l - r * r * Math.sin(theta0) ** 2);
    mech._q = [
      0, 0, theta0,
      r * Math.cos(theta0), r * Math.sin(theta0),
      Math.atan2(-r * Math.sin(theta0), x0 - r * Math.cos(theta0)),
      x0, 0, 0,
    ];

    const { frames, summary } = runMotionStudy(mech, { t0: 0, t1: 1, frames: 73 });
    expect(summary.allConverged).toBe(true);

    // Analytic piston speed dx/dt = (dx/dθ)·ω.
    const dxdt = (th) => {
      const root = Math.sqrt(l * l - r * r * Math.sin(th) ** 2);
      return (-r * Math.sin(th) - (r * r * Math.sin(th) * Math.cos(th)) / root) * omega;
    };
    let maxRelErr = 0;
    for (let f = 10; f < 63; f++) {            // interior frames (central diff)
      const th = theta0 + omega * frames[f].t;
      const analytic = dxdt(th);
      if (Math.abs(analytic) < 5) continue;    // skip near-zero (TDC/BDC)
      const measured = frames[f].linkVel[3].x;
      maxRelErr = Math.max(maxRelErr, Math.abs(measured - analytic) / Math.abs(analytic));
      // Slider never rotates.
      expect(Math.abs(frames[f].linkVel[3].theta)).toBeLessThan(1e-6);
    }
    console.log(`\nSlider-crank piston speed: max relative error vs analytic = ${(maxRelErr * 100).toFixed(3)}%`);
    expect(maxRelErr).toBeLessThan(0.02);
  });

  test('Per-frame interference detection flags an obstacle in the swept path', () => {
    const [Lc, Lco, Lr, Lg] = [30, 80, 60, 90];
    const segs = [
      [],                                  // ground
      [[[0, 0], [Lc, 0]]],                 // crank body
      [[[0, 0], [Lco, 0]]],                // coupler body
      [[[0, 0], [Lr, 0]]],                 // rocker body
    ];
    const seedAndRun = (obstacles) => {
      const mech = fourBar(Lc, Lco, Lr, Lg);
      mech.drivers[0].fn = (t) => 2 * Math.PI * t;
      // Seed at θ=0: crank along +X, solve the rest from a rough guess.
      mech._q = [0, 0, 0, Lc, 0, 0.4, Lg, 0, 2.2];
      return runMotionStudy(mech, {
        t0: 0, t1: 1, frames: 40, linkSegments: segs, obstacles,
      });
    };

    // Obstacle right on the crank circle → the crank sweeps through it.
    const hit = seedAndRun([{ cx: Lc, cy: 0, r: 8 }]);
    expect(hit.summary.allConverged).toBe(true);
    expect(hit.summary.collisionFrames).toBeGreaterThan(0);
    expect(hit.summary.collisionFreeFrames).toBeGreaterThan(0);   // not ALL frames

    // Obstacle far away → no interference at any frame.
    const clear = seedAndRun([{ cx: 500, cy: 500, r: 8 }]);
    expect(clear.summary.collisionFreeFrames).toBe(clear.summary.frameCount);
  });

  test('Spatial motion study: a driven joint traces the expected tip path', () => {
    const L1 = 100, L2 = 70;
    const arm = new SpatialChain({
      joints: [
        { type: 'revolute', axis: [0, 0, 1], origin: [0, 0, 0] },
        { type: 'revolute', axis: [0, 0, 1], origin: [L1, 0, 0] },
      ],
    });
    // Joint 1 sweeps a full turn, joint 2 held straight → tip circles
    // at radius L1+L2.
    const { frames, summary } = runSpatialMotion(
      arm,
      [(t) => 2 * Math.PI * t, () => 0],
      { t0: 0, t1: 1, frames: 96, tipLocal: [L2, 0, 0] },
    );
    expect(frames.length).toBe(96);
    for (const fr of frames) {
      expect(Math.hypot(fr.tip[0], fr.tip[1])).toBeCloseTo(L1 + L2, 6);
    }
    console.log(`\nSpatial arm tip path length = ${summary.tipPathLength.toFixed(1)} (expected ${(2 * Math.PI * (L1 + L2)).toFixed(1)})`);
    expect(summary.tipPathLength).toBeGreaterThan(2 * Math.PI * (L1 + L2) * 0.985);
    expect(summary.tipPathLength).toBeLessThanOrEqual(2 * Math.PI * (L1 + L2) + 1e-6);
    expect(summary.maxTipSpeed).toBeGreaterThan(0);
  });
});
