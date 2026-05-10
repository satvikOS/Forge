import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

async function clickAndWait(page, toolName) {
  await page.evaluate(() => { window.__lastFoundationManifold = null; });
  // Match the button via the inner ribbon-tool-label span — that span
  // contains exactly the tool name (no icon character), so we can do
  // an exact match without the icon glyph getting in the way.
  await page.locator('.ribbon-tool-label', { hasText: new RegExp(`^${toolName}$`) }).first().click();
  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });
  return page.evaluate(async () => {
    const m = window.__lastFoundationManifold;
    const bb = m.boundingBox();
    return {
      volume: m.volume(),
      bbox: { min: [bb.min[0], bb.min[1], bb.min[2]], max: [bb.max[0], bb.max[1], bb.max[2]] },
    };
  });
}

test.describe('Integration: foundation manifold-3d booleans through the Part ribbon', () => {
  test.beforeEach(async ({ page }) => {
    ensure(ROOT);
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
  });

  test('Combine: union of two overlapping 30³ cubes', async ({ page }) => {
    const r = await clickAndWait(page, 'Combine');
    const Vexp = 27000 + 27000 - 9000;
    console.log(`\nCombine: V = ${r.volume.toFixed(0)} mm³ (analytical ${Vexp})`);
    fs.writeFileSync(path.join(ROOT, 'boolean-combine.json'), JSON.stringify(r, null, 2));
    expect(Math.abs(r.volume - Vexp) / Vexp).toBeLessThan(0.01);
  });

  test('Subtract: 30³ cube minus Ø20 sphere at +X face', async ({ page }) => {
    const r = await clickAndWait(page, 'Subtract');
    const Vsphere = (4 / 3) * Math.PI * 1000;
    const Vexp = 27000 - 0.5 * Vsphere;
    console.log(`\nSubtract: V = ${r.volume.toFixed(2)} mm³ (analytical ${Vexp.toFixed(2)})`);
    fs.writeFileSync(path.join(ROOT, 'boolean-subtract.json'), JSON.stringify(r, null, 2));
    expect(Math.abs(r.volume - Vexp) / Vexp).toBeLessThan(0.02);
  });

  test('Intersect: 30³ cube ∩ Ø30 sphere → rounded cube', async ({ page }) => {
    const r = await clickAndWait(page, 'Intersect');
    console.log(`\nIntersect: V = ${r.volume.toFixed(2)} mm³, bbox = [${r.bbox.min}] → [${r.bbox.max}]`);
    fs.writeFileSync(path.join(ROOT, 'boolean-intersect.json'), JSON.stringify(r, null, 2));
    // Sphere volume = 14137.17, cube volume = 27000. Intersection
    // is between the inscribed cube (4242.64 mm³) and the sphere.
    expect(r.volume).toBeGreaterThan(4000);
    expect(r.volume).toBeLessThan(15000);
    // bbox should NOT exceed [-15, 15] (cube clamps the sphere)
    expect(r.bbox.max[0]).toBeLessThanOrEqual(15.5);
    expect(r.bbox.min[0]).toBeGreaterThanOrEqual(-15.5);
  });
});
