import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'edge-fillet');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('M52 — Edge fillet on axis-aligned bodies (CSG)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Rounded cube 30³, r=3: V matches closed-form decomposition', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { roundedCube, roundedBoxVolume } = await import('/src/foundation/EdgeFillet.js');
      const r = await roundedCube(30, 3, 64);
      const V = r.volume();
      const Vexact = roundedBoxVolume([30, 30, 30], 3);
      const bb = r.boundingBox();
      return { V, Vexact, bbox: { min: [...bb.min], max: [...bb.max] } };
    });

    const errPct = (result.V - result.Vexact) / result.Vexact * 100;
    console.log(`\n=== ROUNDED CUBE (a=30, r=3) ===`);
    console.log(`V_FEM    = ${result.V.toFixed(2)} mm³`);
    console.log(`V_exact  = ${result.Vexact.toFixed(2)} mm³  (err ${errPct.toFixed(3)} %)`);
    console.log(`bbox: [${result.bbox.min.map(x => x.toFixed(2))}] → [${result.bbox.max.map(x => x.toFixed(2))}]`);
    fs.writeFileSync(path.join(ROOT, 'rounded-cube.json'), JSON.stringify(result, null, 2));

    // Polygonal sphere/cylinder approximation under-reports by ~0.2 %
    expect(Math.abs(errPct)).toBeLessThan(0.5);
    // bbox extent should be exactly [-15, 15] in all 3 axes
    expect(result.bbox.min[0]).toBeCloseTo(-15, 4);
    expect(result.bbox.max[0]).toBeCloseTo(15, 4);
    expect(result.bbox.min[2]).toBeCloseTo(-15, 4);
    expect(result.bbox.max[2]).toBeCloseTo(15, 4);
  });

  test('Closed-form V check: r=0 → cube V; r=a/2 → sphere V', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { roundedBoxVolume } = await import('/src/foundation/EdgeFillet.js');
      return {
        sharp: roundedBoxVolume([20, 20, 20], 0),       // expect 8000
        full:  roundedBoxVolume([20, 20, 20], 10),      // expect (4/3)π·1000 = 4188.79
      };
    });

    console.log(`\n=== CLOSED-FORM EDGE-CASES ===`);
    console.log(`r=0  V = ${result.sharp.toFixed(2)}  (expect 8000)`);
    console.log(`r=a/2 V = ${result.full.toFixed(2)}  (expect ${((4/3) * Math.PI * 1000).toFixed(2)} = sphere)`);
    expect(result.sharp).toBeCloseTo(8000, 6);
    expect(result.full).toBeCloseTo((4 / 3) * Math.PI * 1000, 6);
  });

  test('Rounded box (50 × 30 × 20), r=5', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { roundedBox, roundedBoxVolume } = await import('/src/foundation/EdgeFillet.js');
      const m = await roundedBox([50, 30, 20], 5, 48);
      return { V: m.volume(), Vexact: roundedBoxVolume([50, 30, 20], 5) };
    });

    const errPct = (result.V - result.Vexact) / result.Vexact * 100;
    console.log(`\n=== ROUNDED BOX (50×30×20, r=5) ===`);
    console.log(`V_FEM    = ${result.V.toFixed(2)} mm³`);
    console.log(`V_exact  = ${result.Vexact.toFixed(2)} mm³  (err ${errPct.toFixed(3)} %)`);
    fs.writeFileSync(path.join(ROOT, 'rounded-box.json'), JSON.stringify(result, null, 2));
    expect(Math.abs(errPct)).toBeLessThan(0.5);
  });
});
