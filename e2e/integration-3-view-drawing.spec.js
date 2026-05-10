import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: Linear Pattern → Standard 3 View through real ribbons (foundation HLR)', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  // Build foundation body via Linear Pattern
  await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
  await page.locator('.ribbon-tool', { hasText: 'Linear Pattern' }).first().click();
  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });

  // Drawing tab → Standard 3 View
  await page.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
  await page.locator('.ribbon-tool', { hasText: 'Standard 3 View' }).first().click();
  await page.waitForFunction(() => !!window.__last3ViewResult, null, { timeout: 60000 });

  const result = await page.evaluate(() => window.__last3ViewResult);

  console.log(`\n=== INTEGRATION: STANDARD 3 VIEW (A3 SHEET) ===`);
  console.log(`SVG size: ${(result.sizeBytes / 1024).toFixed(1)} KB`);
  console.log(`Lines: ${result.numLines},  Polylines: ${result.numPolylines}`);
  console.log(`Has title block: ${result.hasTitleBlock}`);

  fs.writeFileSync(path.join(ROOT, 'three-view-integration.json'), JSON.stringify(result, null, 2));

  expect(result.sizeBytes).toBeGreaterThan(2000);
  expect(result.numLines + result.numPolylines).toBeGreaterThan(20);
});
