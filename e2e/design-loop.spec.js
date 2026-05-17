import { test, expect } from '@playwright/test';
import { runDesignLoop, sizeRotatingDisc, annularDiscMesh }
  from '../frontend/src/foundation/DesignLoop.js';

/*
 * The closing design loop — a part is "done" only when a real analysis
 * on its own mesh meets the criteria. Pure-math foundation; no browser.
 */

test.describe('DesignLoop — build → analyse → redesign until it passes', () => {
  test('annularDiscMesh tiles a valid annular disc', () => {
    const m = annularDiscMesh(0.12, 0.35, 0.03, 0.02, 6, 24, 3);
    expect(m.vertices.length).toBe(7 * 24 * 4);
    expect(m.tets.length).toBe(6 * 24 * 3 * 6);
    expect(m.boreNodes.length).toBe(24 * 4);
    for (const t of m.tets) for (const i of t) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(m.vertices.length);
    }
  });

  test('runDesignLoop converges a trivial fixed-point problem', () => {
    // Drive x so that x² ≈ 50 — proves the general loop closes.
    const r = runDesignLoop({
      params: { x: 1 },
      build: ({ x }) => x,
      analyse: (x) => ({ value: x * x }),
      judge: (a) => ({ pass: Math.abs(a.value - 50) < 0.5, ratio: a.value / 50, message: `x²=${a.value.toFixed(2)}` }),
      redesign: ({ x }, j) => ({ x: x * Math.sqrt(50 / (j.ratio * 50)) }),
    });
    expect(r.converged).toBe(true);
    expect(r.params.x * r.params.x).toBeCloseTo(50, 0);
  });

  test('rotating disc — loop starts over-stressed and sizes itself to pass', () => {
    const r = sizeRotatingDisc({
      material: 'INCONEL_718', rpm: 13000,
      rBore_m: 0.12, rRim_m: 0.35, operatingTempC: 550, safetyFactor: 1.5,
      tHub0_m: 0.015,                       // deliberately thin → fails first
    });
    console.log(`\n  DISC (${r.material}, ${r.inputs.rpm} rpm) — allowable ${r.allowableMPa} MPa`);
    for (const h of r.history) {
      console.log(`   iter ${h.iteration}: hub ${h.hubThickness_mm} mm → `
        + `${h.stressRatioPct}% of allowable ${h.pass ? '✓ accepted' : ''}`);
    }
    console.log(`  → ${r.verdict}`);
    console.log(`  final: hub ${r.finalHubThickness_mm.toFixed(1)} mm, `
      + `peak ${r.peakStressMPa} MPa, mass ${r.massKg} kg, ${r.iterations} iterations`);

    // The first analysed design must be genuinely over-stressed — proof
    // the loop is solving a real problem, not rubber-stamping.
    expect(r.history[0].stressRatioPct).toBeGreaterThan(100);
    // The loop must have actually changed the design.
    expect(r.history.length).toBeGreaterThan(1);
    expect(r.finalHubThickness_mm).not.toBeCloseTo(15, 1);
    // And it must end inside the material allowable.
    expect(r.converged).toBe(true);
    expect(r.peakStressMPa).toBeLessThanOrEqual(r.allowableMPa);
  });

  test('loop responds to physics — a faster disc converges to a thicker hub', () => {
    const slow = sizeRotatingDisc({ rpm: 8000, tHub0_m: 0.015 });
    const fast = sizeRotatingDisc({ rpm: 13000, tHub0_m: 0.015 });
    console.log(`\n  8000 rpm → hub ${slow.finalHubThickness_mm.toFixed(1)} mm`);
    console.log(`  13000 rpm → hub ${fast.finalHubThickness_mm.toFixed(1)} mm`);
    expect(slow.converged).toBe(true);
    expect(fast.converged).toBe(true);
    // Higher centrifugal load ⇒ the loop genuinely sizes a heavier hub.
    expect(fast.finalHubThickness_mm).toBeGreaterThan(slow.finalHubThickness_mm);
  });
});
