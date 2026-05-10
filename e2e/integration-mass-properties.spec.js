import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: Linear Pattern → Mass Properties through Assembly ribbon', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
  await page.locator('.ribbon-tool', { hasText: 'Linear Pattern' }).first().click();
  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });

  await page.locator('.ribbon-tab', { hasText: 'Assembly' }).first().click();
  await page.locator('.ribbon-tool', { hasText: 'Mass Properties' }).first().click();
  await page.waitForFunction(() => !!window.__lastMassProps, null, { timeout: 30000 });

  const result = await page.evaluate(() => window.__lastMassProps);

  console.log(`\n=== INTEGRATION: MASS PROPERTIES (Al 6061-T6) ===`);
  console.log(`Volume: ${result.volume_mm3.toFixed(2)} mm³`);
  console.log(`Surface area: ${result.surface_area_mm2.toFixed(2)} mm²`);
  console.log(`Mass: ${result.mass_kg.toFixed(5)} kg`);
  console.log(`Centroid (Mirtich): (${result.centroid_mm.map(v => v.toFixed(3)).join(', ')}) mm`);
  if (result.principalMoments) {
    console.log(`Principal moments (kg·mm²): ${result.principalMoments.map(v => v.toFixed(3)).join(', ')}`);
  }

  fs.writeFileSync(path.join(ROOT, 'mass-props-integration.json'), JSON.stringify(result, null, 2));

  // After Linear Pattern (4 cylinders Ø6 × 15 mm), V ≈ 1693 mm³,
  // mass ≈ 1693e-9 × 2700 = 4.57e-3 kg = 4.57 g.
  expect(result.volume_mm3).toBeGreaterThan(1600);
  expect(result.volume_mm3).toBeLessThan(1750);
  expect(result.mass_kg).toBeGreaterThan(0.004);
  expect(result.mass_kg).toBeLessThan(0.005);
  expect(result.surface_area_mm2).toBeGreaterThan(500);
});
