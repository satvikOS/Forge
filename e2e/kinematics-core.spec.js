import { test, expect } from '@playwright/test';
import {
  grublerDOF, kutzbachDOF, solveLinear,
  PlanarMechanism, SpatialChain, mat4Apply,
} from '../frontend/src/foundation/KinematicsCore.js';
import { FourBarLinkage } from '../frontend/src/foundation/FourBarLinkage.js';

// Build a 4-bar as a PlanarMechanism (links: ground, crank, coupler, rocker).
function fourBarMechanism(Lc, Lco, Lr, Lg) {
  return new PlanarMechanism({
    links: [{ name: 'ground' }, { name: 'crank' }, { name: 'coupler' }, { name: 'rocker' }],
    joints: [
      { type: 'revolute', linkA: 0, linkB: 1, pA: [0, 0], pB: [0, 0] },        // A
      { type: 'revolute', linkA: 1, linkB: 2, pA: [Lc, 0], pB: [0, 0] },       // B
      { type: 'revolute', linkA: 2, linkB: 3, pA: [Lco, 0], pB: [Lr, 0] },     // C
      { type: 'revolute', linkA: 3, linkB: 0, pA: [0, 0], pB: [Lg, 0] },       // D
    ],
    drivers: [{ jointIndex: 0, fn: () => 0 }],
  });
}

// Slider-crank: ground, crank, conrod, slider (piston on the x-axis).
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

test.describe('General mechanism kinematics', () => {
  test.describe.configure({ timeout: 120000 });

  test('Mobility: Grübler / Kutzbach match textbook values', () => {
    // 4-bar: 4 links, 4 revolutes → 3·3 − 4·2 = 1.
    expect(grublerDOF(4, Array(4).fill({ type: 'revolute' }))).toBe(1);
    // Slider-crank: 4 links, 3 revolute + 1 prismatic → 1.
    expect(grublerDOF(4, [
      { type: 'revolute' }, { type: 'revolute' }, { type: 'revolute' }, { type: 'prismatic' },
    ])).toBe(1);
    // Geared five-bar: 5 links, 5 revolutes + 1 gear → 3·4 − 5·2 − 1 = 1.
    expect(grublerDOF(5, [
      ...Array(5).fill({ type: 'revolute' }), { type: 'gear' },
    ])).toBe(1);
    // Spatial 6R arm: 7 links, 6 revolutes → 6·6 − 6·5 = 6.
    expect(kutzbachDOF(7, Array(6).fill({ type: 'revolute' }))).toBe(6);
  });

  test('solveLinear solves a dense system', () => {
    // 3x3 with known solution x = [1, -2, 3].
    const A = [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]];
    const b = [2 * 1 + 1 * -2 - 1 * 3, -3 * 1 - 1 * -2 + 2 * 3, -2 * 1 + 1 * -2 + 2 * 3];
    const x = solveLinear(A, b);
    expect(x[0]).toBeCloseTo(1, 9);
    expect(x[1]).toBeCloseTo(-2, 9);
    expect(x[2]).toBeCloseTo(3, 9);
    // Singular system → null.
    expect(solveLinear([[1, 2], [2, 4]], [1, 2])).toBeNull();
  });

  test('PlanarMechanism solves a 4-bar — matches the closed-form FourBarLinkage', () => {
    const [Lc, Lco, Lr, Lg] = [30, 80, 60, 90];
    const linkage = new FourBarLinkage({ crank: Lc, coupler: Lco, rocker: Lr, ground: Lg, branch: 'upper' });
    expect(linkage.grashofType()).toBe('crank-rocker');   // crank fully rotates
    const mech = fourBarMechanism(Lc, Lco, Lr, Lg);
    expect(mech.dof()).toBe(1);

    // Seed the solver from the closed-form pose at the first angle
    // (this only selects the assembly branch).
    const theta0 = 0.3;
    const p0 = linkage.pose(theta0);
    mech._q = [
      0, 0, theta0,                                                          // crank
      p0.B[0], p0.B[1], Math.atan2(p0.C[1] - p0.B[1], p0.C[0] - p0.B[0]),     // coupler
      Lg, 0, Math.atan2(p0.C[1], p0.C[0] - Lg),                              // rocker
    ];

    let maxErr = 0;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const theta = theta0 + (i / N) * 2 * Math.PI;
      mech.drivers[0].fn = () => theta;
      const sol = mech.solveAt(theta);
      expect(sol.converged).toBe(true);
      expect(sol.residualNorm).toBeLessThan(1e-6);
      const ref = linkage.pose(theta);
      // joints[1] = B (crank pin), joints[2] = C (coupler/rocker pin).
      maxErr = Math.max(maxErr,
        Math.hypot(sol.joints[1].world[0] - ref.B[0], sol.joints[1].world[1] - ref.B[1]),
        Math.hypot(sol.joints[2].world[0] - ref.C[0], sol.joints[2].world[1] - ref.C[1]));
    }
    console.log(`\n4-bar NR solver vs closed form: max joint error over ${N} angles = ${maxErr.toExponential(2)} mm`);
    expect(maxErr).toBeLessThan(1e-6);
  });

  test('PlanarMechanism solves a slider-crank — matches the analytic piston relation', () => {
    const r = 40, l = 120;
    const mech = sliderCrank(r, l);
    expect(mech.dof()).toBe(1);

    // Analytic piston displacement: x(θ) = r·cosθ + √(l² − r²sin²θ).
    const piston = (th) => r * Math.cos(th) + Math.sqrt(l * l - r * r * Math.sin(th) * Math.sin(th));

    const theta0 = 0.2;
    const x0 = piston(theta0);
    mech._q = [
      0, 0, theta0,                                                          // crank
      r * Math.cos(theta0), r * Math.sin(theta0),
      Math.atan2(-r * Math.sin(theta0), x0 - r * Math.cos(theta0)),           // conrod
      x0, 0, 0,                                                              // slider
    ];

    let maxErr = 0;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const theta = theta0 + (i / N) * 2 * Math.PI;
      mech.drivers[0].fn = () => theta;
      const sol = mech.solveAt(theta);
      expect(sol.converged).toBe(true);
      // links[3] is the slider; its x is the piston displacement.
      maxErr = Math.max(maxErr, Math.abs(sol.links[3].x - piston(theta)));
      // The slider never rotates and never leaves the axis.
      expect(Math.abs(sol.links[3].theta)).toBeLessThan(1e-6);
      expect(Math.abs(sol.links[3].y)).toBeLessThan(1e-6);
    }
    console.log(`Slider-crank vs analytic piston: max error over ${N} angles = ${maxErr.toExponential(2)} mm`);
    expect(maxErr).toBeLessThan(1e-6);
  });

  test('SpatialChain forward kinematics — 2R arm matches closed form', () => {
    const L1 = 100, L2 = 70;
    const arm = new SpatialChain({
      joints: [
        { type: 'revolute', axis: [0, 0, 1], origin: [0, 0, 0] },
        { type: 'revolute', axis: [0, 0, 1], origin: [L1, 0, 0] },
      ],
    });
    expect(arm.dof()).toBe(2);

    for (const [t1, t2] of [[0, 0], [0.5, -0.3], [1.2, 0.9], [-0.7, 2.1]]) {
      const { tip } = arm.fkAt([t1, t2], [L2, 0, 0]);
      const ex = L1 * Math.cos(t1) + L2 * Math.cos(t1 + t2);
      const ey = L1 * Math.sin(t1) + L2 * Math.sin(t1 + t2);
      expect(tip[0]).toBeCloseTo(ex, 9);
      expect(tip[1]).toBeCloseTo(ey, 9);
      expect(tip[2]).toBeCloseTo(0, 9);
    }
  });

  test('SpatialChain handles a prismatic joint', () => {
    // Revolute about Z, then a prismatic slide along the rotated X axis.
    const chain = new SpatialChain({
      joints: [
        { type: 'revolute', axis: [0, 0, 1], origin: [0, 0, 0] },
        { type: 'prismatic', axis: [1, 0, 0], origin: [0, 0, 0] },
      ],
    });
    const { tip } = chain.fkAt([Math.PI / 2, 50], [0, 0, 0]);
    // Rotate +90° then slide 50 along local X → world +Y by 50.
    expect(tip[0]).toBeCloseTo(0, 9);
    expect(tip[1]).toBeCloseTo(50, 9);
  });
});
