import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: Slice Preview in the Manufacture ribbon runs foundation.sliceManifold', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  // First create a foundation manifold via Linear Pattern in the Part
  // tab so the slicer has real geometry to slice.
  const partTab = page.locator('.ribbon-tab', { hasText: 'Part' }).first();
  await expect(partTab).toBeVisible({ timeout: 15000 });
  await partTab.click();
  await page.locator('.ribbon-tool', { hasText: 'Linear Pattern' }).first().click();
  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });

  // Switch to Manufacture and click Slice Preview
  const manuTab = page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first();
  await expect(manuTab).toBeVisible({ timeout: 10000 });
  await manuTab.click();

  const sliceBtn = page.locator('.ribbon-tool', { hasText: 'Slice Preview' }).first();
  await expect(sliceBtn).toBeVisible({ timeout: 10000 });
  await sliceBtn.click();

  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 90000) {
      const r = window.__lastSliceResult;
      if (r) return r;
      await new Promise(r => setTimeout(r, 200));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'slice-trace.log'), consoleLines.join('\n'));
    throw new Error(`Slice pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: SLICE PREVIEW through Manufacture ribbon ===`);
  console.log(`Layers: ${result.layerCount} @ ${result.layerHeight} mm`);
  console.log(`Total perimeter: ${result.totalPerimeterMm.toFixed(0)} mm  (${result.totalSegments} segments)`);
  console.log(`Z-range: [${result.zMin.toFixed(2)}, ${result.zMax.toFixed(2)}] mm`);
  console.log(`Demo geometry used: ${result.demoUsed}`);

  fs.writeFileSync(path.join(ROOT, 'slice-integration.json'), JSON.stringify(result, null, 2));

  // 4 cylinders Ø6 × 15 mm tall → ~75 layers @ 0.2 mm each, ≈4 perimeters per layer
  expect(result.layerCount).toBeGreaterThan(50);
  expect(result.layerCount).toBeLessThan(100);
  expect(result.totalPerimeterMm).toBeGreaterThan(2000);
  expect(result.demoUsed).toBe(false);   // Linear Pattern provided real geometry
});
