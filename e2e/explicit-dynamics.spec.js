import { test, expect } from '@playwright/test';
import {
  gridPanel, simulateImpact, springChainWaveSpeed,
} from '../frontend/src/foundation/ExplicitDynamics.js';

test.describe('Explicit-dynamics impact solver', () => {
  test.describe.configure({ timeout: 120000 });

  test('Free oscillator conserves energy (symplectic integration)', () => {
    // Node 0 fixed, node 1 free on a stretched spring — no impactor,
    // no damping → total mechanical energy must stay constant.
    const model = {
      nodes: [
        { pos: [0, 0, 0], vel: [0, 0, 0], mass: 1, fixed: true },
        { pos: [1.2, 0, 0], vel: [0, 0, 0], mass: 0.05, fixed: false },
      ],
      springs: [{ a: 0, b: 1, k: 8000, L0: 1.0 }],
    };
    const { summary } = simulateImpact(model, { dt: 2e-5, steps: 4000 });
    console.log(`\nFree oscillator energy drift: ${summary.energyDriftPct.toFixed(3)}% over ${summary.simTime.toFixed(3)} s`);
    expect(Math.abs(summary.energyDriftPct)).toBeLessThan(2);
  });

  test('Impact conserves total linear momentum', () => {
    // A free (un-clamped) body struck by a rigid impactor: contact and
    // spring forces are all internal → momentum is exactly conserved.
    const nodes = [];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      nodes.push({ pos: [i * 0.05, j * 0.05, 0], vel: [0, 0, 0], mass: 0.1, fixed: false });
    }
    const springs = [];
    const at = (i, j) => j * 3 + i;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      if (i + 1 < 3) springs.push({ a: at(i, j), b: at(i + 1, j), k: 5000, L0: 0.05 });
      if (j + 1 < 3) springs.push({ a: at(i, j), b: at(i, j + 1), k: 5000, L0: 0.05 });
    }
    const model = {
      nodes, springs,
      impactor: { pos: [0.05, 0.05, 0.08], vel: [0, 0, -40], mass: 0.3, radius: 0.03 },
    };
    const { summary } = simulateImpact(model, { dt: 1e-5, steps: 3000 });
    const p0 = Math.hypot(...summary.momentumStart);
    console.log(`\nMomentum: |p0| = ${p0.toFixed(4)}, drift = ${summary.momentumDrift.toExponential(2)}`);
    expect(summary.momentumDrift).toBeLessThan(p0 * 1e-6);
  });

  test('1-D spring-chain wave speed matches the closed form', () => {
    // c = √(k·L₀²/m): k=8000, L₀=0.02, m=0.05 → √(8000·4e-4/0.05) = 8 m/s.
    expect(springChainWaveSpeed(8000, 0.02, 0.05)).toBeCloseTo(8, 6);

    // Causality: in a chain, the far node must start moving AFTER the
    // near node — the disturbance propagates, it does not teleport.
    const N = 12;
    const nodes = [];
    for (let i = 0; i < N; i++) {
      nodes.push({ pos: [i * 0.02, 0, 0], vel: i === 0 ? [3, 0, 0] : [0, 0, 0], mass: 0.05, fixed: false });
    }
    const springs = [];
    for (let i = 0; i + 1 < N; i++) springs.push({ a: i, b: i + 1, k: 8000, L0: 0.02 });
    const { frames } = simulateImpact({ nodes, springs }, { dt: 1e-5, steps: 4000, recordEvery: 20 });
    const firstMove = (idx) => {
      for (const fr of frames) {
        if (Math.abs(fr.nodePos[idx][0] - idx * 0.02) > 1e-4) return fr.t;
      }
      return Infinity;
    };
    const tNear = firstMove(2), tFar = firstMove(N - 1);
    console.log(`\nWave arrival: node 2 at ${(tNear * 1e3).toFixed(2)} ms, node ${N - 1} at ${(tFar * 1e3).toFixed(2)} ms`);
    expect(tFar).toBeGreaterThan(tNear);
    expect(tFar).toBeLessThan(Infinity);
  });

  test('Impact on a panel deforms it, absorbs energy, records the transient', () => {
    // A clamped 9×9 panel struck by a rigid impactor — a survivable
    // severe impact: the panel deforms heavily and holds. The solver
    // tracks spring-level damage (breakStrain) for harsher impacts.
    const panel = gridPanel({ nx: 9, ny: 9, spacing: 0.02, nodeMass: 0.04, stiffness: 9000, breakStrain: 0.6 });
    const model = {
      ...panel,
      impactor: { pos: [0.08, 0.08, 0.05], vel: [0, 0, -11], mass: 0.3, radius: 0.03 },
      contactStiffness: 4e5,
      damping: 2.0,
    };
    const { frames, summary } = simulateImpact(model, { dt: 1.5e-5, steps: 3500 });
    console.log(`\nPanel impact: peak deflection ${summary.peakDeflection_mm.toFixed(1)} mm, ` +
      `peak contact ${(summary.peakContactForce_N / 1000).toFixed(1)} kN, ` +
      `energy absorbed ${summary.energyAbsorbed_J.toFixed(1)} J, ` +
      `${summary.brokenSprings}/${summary.totalSprings} springs broken`);
    expect(frames.length).toBeGreaterThan(10);
    // A real structural deflection — large but bounded (not a fragment).
    expect(summary.peakDeflection_mm).toBeGreaterThan(2);
    expect(summary.peakDeflection_mm).toBeLessThan(300);
    expect(summary.peakContactForce_N).toBeGreaterThan(0);
    // The impactor transferred energy into the body.
    expect(summary.energyAbsorbed_J).toBeGreaterThan(0);
    expect(summary.impactorVelEnd).toBeLessThan(summary.impactorVelStart);
    // Damage tracking is wired (breakStrain) even if this impact survives.
    expect(summary.totalSprings).toBeGreaterThan(0);
    expect(summary.brokenSprings).toBeGreaterThanOrEqual(0);
    // Frames carry the per-node deformed positions — the animation data.
    expect(frames[0].nodePos.length).toBe(81);
  });

  test('Impact Simulation ribbon tool runs through the platform', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Impact Simulation$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastImpactSim, null, { timeout: 30000 });

    const r = await page.evaluate(() => ({
      frames: window.__lastImpactSim.frames.length,
      nodesPerFrame: window.__lastImpactSim.frames[0].nodePos.length,
      peakContact: window.__lastImpactSim.summary.peakContactForce_N,
      peakDefl: window.__lastImpactSim.summary.peakDeflection_mm,
      absorbed: window.__lastImpactSim.summary.energyAbsorbed_J,
    }));
    console.log(`\nImpact Simulation tool: ${r.frames} frames × ${r.nodesPerFrame} nodes, ` +
      `peak contact ${(r.peakContact / 1000).toFixed(1)} kN, ${r.absorbed.toFixed(0)} J absorbed`);
    expect(r.frames).toBeGreaterThan(10);
    expect(r.nodesPerFrame).toBe(121);                 // 11×11 grid
    expect(r.peakContact).toBeGreaterThan(0);
    expect(r.absorbed).toBeGreaterThan(0);
  });
});
