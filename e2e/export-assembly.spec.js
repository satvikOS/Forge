import { test, expect } from '@playwright/test';
import fs from 'fs';

test.describe('Export Assembly — multi-body export', () => {
  test.describe.configure({ timeout: 120000 });

  test('Composes every scene body into one downloadable assembly', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    // Build three separate bodies at three stations — a mini "assembly".
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(400);
    for (const x of [0, 200, 400]) {
      await page.evaluate((tx) => {
        window.__archdiscPlanParams = { 'Extrude Boss': { width: 40, depth: 40, height: 40, translate: [tx, 0, 0] } };
      }, x);
      await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
      await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
      await page.waitForTimeout(300);
    }

    // Drawing tab → Export Assembly, capturing the file download.
    await page.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
    await page.waitForTimeout(400);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('.ribbon-tool-label', { hasText: /^Export Assembly$/ }).first().click(),
    ]);
    await page.waitForFunction(() => !!window.__lastAssemblyExport, null, { timeout: 20000 });

    const r = await page.evaluate(() => window.__lastAssemblyExport);
    console.log(`\nExport Assembly: ${r.bodyCount} bodies → ${r.triangles} triangles, ${r.bytes} bytes`);
    expect(r.bodyCount).toBe(3);                    // all three bodies composed
    expect(r.triangles).toBeGreaterThanOrEqual(36); // ≥ 3 × 12-tri boxes

    // The download is a real, non-trivial binary STL.
    const path = await download.path();
    const stl = fs.readFileSync(path);
    expect(stl.length).toBe(84 + r.triangles * 50);  // exact binary-STL size
    expect(stl.readUInt32LE(80)).toBe(r.triangles);  // header triangle count
    console.log(`Downloaded STL: ${stl.length} bytes, header says ${stl.readUInt32LE(80)} triangles`);
  });
});
