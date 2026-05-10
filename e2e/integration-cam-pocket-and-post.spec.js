import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

/**
 * 2.5-Axis Milling (foundation.pocketClear) → G-Code Post (file
 * download). Both ribbon clicks chained together.
 */
test('Integration: 2.5-Axis Milling + G-Code Post chained through Manufacture ribbon', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
  await page.locator('.ribbon-tool', { hasText: '2.5-Axis Milling' }).first().click();
  await page.waitForFunction(() => !!window.__lastPocketGCodeResult, null, { timeout: 30000 });

  const pocket = await page.evaluate(() => window.__lastPocketGCodeResult);

  await page.locator('.ribbon-tool', { hasText: 'G-Code Post' }).first().click();
  await page.waitForFunction(() => !!window.__lastGCodePostResult, null, { timeout: 15000 });
  const post = await page.evaluate(() => window.__lastGCodePostResult);

  console.log(`\n=== INTEGRATION: 2.5-Axis pocket clear + G-Code Post ===`);
  console.log(`Pocket: ${pocket.totalLines} lines, ${pocket.cuttingMoves} cutting moves`);
  console.log(`Post: ${post.totalLines} lines, ${post.cuttingMoves} cutting moves, ${(post.sizeBytes/1024).toFixed(1)} KB`);
  console.log(`First 5 lines: ${post.firstLines.slice(0, 5).join(' | ')}`);

  fs.writeFileSync(path.join(ROOT, 'cam-post-integration.json'), JSON.stringify({ pocket, post }, null, 2));

  expect(pocket.cuttingMoves).toBeGreaterThan(20);
  expect(post.totalLines).toBe(pocket.totalLines);
  expect(post.firstLines.some(l => l.includes('G21'))).toBe(true);
  expect(post.sizeBytes).toBeGreaterThan(500);
});
