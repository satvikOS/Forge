import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

async function clickFoundationTool(page, toolName) {
  await page.evaluate(() => { window.__lastFoundationManifold = null; });
  await page.locator('.ribbon-tool-label', { hasText: new RegExp(`^${toolName}$`) }).first().click();
  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });
  return page.evaluate(() => {
    const m = window.__lastFoundationManifold;
    const bb = m.boundingBox();
    return { volume: m.volume(), bbox: { min: [...bb.min], max: [...bb.max] } };
  });
}

test('Integration: Extrude Boss + Extrude Cut chained through Part ribbon', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();

  const boss = await clickFoundationTool(page, 'Extrude Boss');
  console.log(`\nExtrude Boss: V = ${boss.volume.toFixed(0)} mm³ (analytical 100000)`);
  expect(boss.volume).toBeCloseTo(100000, 0);
  expect(boss.bbox.min[0]).toBeCloseTo(-40, 4);
  expect(boss.bbox.max[2]).toBeCloseTo(25, 4);

  // Extrude Cut chains off the existing foundation body
  const cut = await clickFoundationTool(page, 'Extrude Cut');
  console.log(`Extrude Cut: V = ${cut.volume.toFixed(0)} mm³ (analytical 100000 - 15*15*25 = 94375)`);
  fs.writeFileSync(path.join(ROOT, 'extrude-integration.json'), JSON.stringify({ boss, cut }, null, 2));
  expect(cut.volume).toBeCloseTo(94375, 0);
});
