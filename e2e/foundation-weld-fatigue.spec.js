import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'weld-fatigue');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(60000);

test.describe('M56 — Weld fatigue (IIW FAT classes + structural HSS)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('FAT 80 butt weld, ΔS = 80 MPa → exactly 2×10⁶ cycles (anchor)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { FAT_CLASSES, fatCyclesToFailure, strengthRatio } = await import('/src/foundation/WeldFatigue.js');
      const cls = FAT_CLASSES.FAT80_butt_aswelded;
      const Nat = fatCyclesToFailure(80, cls);    // = anchor 2e6
      const N100 = fatCyclesToFailure(100, cls);  // higher → fewer cycles
      const N50 = fatCyclesToFailure(50, cls);    // lower → more
      const R = strengthRatio(80, cls);
      return { Nat, N100, N50, R };
    });
    console.log(`\n=== FAT 80 BUTT WELD ===`);
    console.log(`ΔS=80  → N = ${result.Nat.toExponential(3)}  (expect 2e6 anchor)`);
    console.log(`ΔS=100 → N = ${result.N100.toExponential(3)}`);
    console.log(`ΔS=50  → N = ${result.N50 === Infinity ? '∞' : result.N50.toExponential(3)}`);
    console.log(`Strength ratio at ΔS=80: ${result.R.toFixed(3)}`);
    fs.writeFileSync(path.join(ROOT, 'fat80-anchor.json'), JSON.stringify(result, null, 2));

    expect(result.Nat).toBeCloseTo(2e6, -3);
    expect(result.N100).toBeLessThan(result.Nat);
    expect(result.N50).toBeGreaterThan(result.Nat);
    expect(result.R).toBeCloseTo(1.0, 3);
  });

  test('Structural hot-spot stress (linear extrapolation)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { structuralHotSpotStress } = await import('/src/foundation/WeldFatigue.js');
      // FE shows σ at 0.4t = 250 MPa, σ at 1.0t = 200 MPa
      // → σ_HSS = 1.67·250 − 0.67·200 = 417.5 − 134 = 283.5 MPa
      return {
        hss_283: structuralHotSpotStress({ sigma_at_0p4t: 250, sigma_at_1p0t: 200 }),
        // Edge case: uniform stress (no gradient) → HSS = σ
        hss_uniform: structuralHotSpotStress({ sigma_at_0p4t: 100, sigma_at_1p0t: 100 }),
      };
    });
    console.log(`\nLinear HSS extrapolation:`);
    console.log(`  σ(0.4t)=250, σ(1.0t)=200 → σ_HSS = ${result.hss_283.toFixed(2)} MPa  (expect 283.5)`);
    console.log(`  Uniform 100 MPa  →  σ_HSS = ${result.hss_uniform.toFixed(2)}  (expect 100)`);
    expect(result.hss_283).toBeCloseTo(283.5, 1);
    expect(result.hss_uniform).toBeCloseTo(100, 6);
  });

  test('Engine mount T-joint (FAT 71): 60 MPa range, t=15mm — life check', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { assessWeld } = await import('/src/foundation/WeldFatigue.js');
      // Aerospace bracket fillet weld, transverse loading
      const r1 = assessWeld({
        detail: 'FAT71_T_toe', stressRange: 60, thickness: 15, targetCycles: 1e7,
      });
      // Same joint but 80 mm thick (size correction kicks in)
      const r2 = assessWeld({
        detail: 'FAT71_T_toe', stressRange: 60, thickness: 80, targetCycles: 1e7,
      });
      return { thin: r1, thick: r2 };
    });
    console.log(`\n=== ENGINE MOUNT T-JOINT (FAT 71) ===`);
    console.log(`Thin (t=15 mm):  size factor ${result.thin.sizeFactor.toFixed(3)}, FAT_eff = ${result.thin.fatEffective.toFixed(1)} MPa`);
    console.log(`  N = ${result.thin.cyclesToFailure.toExponential(3)} cycles, R = ${result.thin.strengthRatio.toFixed(3)}, status: ${result.thin.status}`);
    console.log(`Thick (t=80 mm): size factor ${result.thick.sizeFactor.toFixed(3)}, FAT_eff = ${result.thick.fatEffective.toFixed(1)} MPa`);
    console.log(`  N = ${result.thick.cyclesToFailure.toExponential(3)} cycles, R = ${result.thick.strengthRatio.toFixed(3)}, status: ${result.thick.status}`);
    fs.writeFileSync(path.join(ROOT, 't-joint-life.json'), JSON.stringify(result, null, 2));

    // Thin section: no size correction
    expect(result.thin.sizeFactor).toBe(1.0);
    expect(result.thin.fatEffective).toBe(71);
    // Thick section: size factor < 1
    expect(result.thick.sizeFactor).toBeLessThan(1.0);
    expect(result.thick.fatEffective).toBeLessThan(71);
    // Cycles: thin > thick at same stress range
    expect(result.thin.cyclesToFailure).toBeGreaterThan(result.thick.cyclesToFailure);
  });

  test('S-N slope: doubling stress range cuts life by 8 (m=3)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { fatCyclesToFailure } = await import('/src/foundation/WeldFatigue.js');
      const cls = { fat: 80, slope_m: 3 };
      return {
        N_at_100: fatCyclesToFailure(100, cls),
        N_at_200: fatCyclesToFailure(200, cls),
      };
    });
    const ratio = result.N_at_100 / result.N_at_200;
    console.log(`\n=== S-N SLOPE CHECK ===`);
    console.log(`ΔS=100 → N = ${result.N_at_100.toExponential(3)}`);
    console.log(`ΔS=200 → N = ${result.N_at_200.toExponential(3)}`);
    console.log(`Ratio N(ΔS=100) / N(ΔS=200) = ${ratio.toFixed(3)}  (expect 8 for m=3)`);
    // For m=3: ratio = 2^3 = 8
    expect(ratio).toBeCloseTo(8, 3);
  });
});
