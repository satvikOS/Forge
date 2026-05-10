import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: Hole Wizard → Cost Estimation chained through real ribbons', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  // Hole Wizard creates the foundation body via boolean subtraction
  await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
  await page.locator('.ribbon-tool', { hasText: 'Hole Wizard' }).first().click();
  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });

  const holeBody = await page.evaluate(() => {
    const m = window.__lastFoundationManifold;
    return { volume: m.volume(), surfaceArea: m.surfaceArea() };
  });

  // Cost Estimation reads the foundation body
  await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
  await page.locator('.ribbon-tool', { hasText: 'Cost Estimation' }).first().click();
  await page.waitForFunction(() => !!window.__lastCostEstimate, null, { timeout: 30000 });

  const cost = await page.evaluate(() => window.__lastCostEstimate);

  console.log(`\n=== INTEGRATION: HOLE WIZARD + COST ESTIMATION ===`);
  console.log(`Hole result: V = ${holeBody.volume.toFixed(2)} mm³, A = ${holeBody.surfaceArea.toFixed(2)} mm²`);
  console.log(`Mass: ${cost.massKg.toFixed(4)} kg, CNC time: ${cost.cncTimeHr.toFixed(3)} hr`);
  console.log(`Cost breakdown:`);
  console.log(`  Material: $${cost.materialCost.toFixed(2)}`);
  console.log(`  CNC:      $${cost.cncCost.toFixed(2)}`);
  console.log(`  Setup:    $${cost.setupCost}`);
  console.log(`  Finish:   $${cost.finishCost}`);
  console.log(`  Total:    $${cost.totalCost.toFixed(2)} → Sell $${cost.sellPrice.toFixed(2)} (${cost.marginPct.toFixed(0)}%)`);

  fs.writeFileSync(path.join(ROOT, 'hole-cost-integration.json'), JSON.stringify({ holeBody, cost }, null, 2));

  // Block 50×30×20 = 30,000 mm³, hole π·4²·20 = 1005.31 mm³,
  // so V = 28,994.69 mm³.
  expect(holeBody.volume).toBeGreaterThan(28800);
  expect(holeBody.volume).toBeLessThan(29100);
  expect(cost.massKg).toBeGreaterThan(0.07);   // ~78 g aluminum
  expect(cost.massKg).toBeLessThan(0.09);
  expect(cost.totalCost).toBeGreaterThan(35);   // setup floor
});
