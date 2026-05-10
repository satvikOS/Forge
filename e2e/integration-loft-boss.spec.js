import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: Loft Boss in the ribbon runs foundation.loft on 4 circular cross-sections', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const partTab = page.locator('.ribbon-tab', { hasText: 'Part' }).first();
  await expect(partTab).toBeVisible({ timeout: 15000 });
  await partTab.click();

  const loftBtn = page.locator('.ribbon-tool', { hasText: 'Loft Boss' }).first();
  await expect(loftBtn).toBeVisible({ timeout: 10000 });
  await loftBtn.click();

  const result = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 90000) {
      const m = window.__lastFoundationManifold;
      if (m) {
        const bb = m.boundingBox();
        return {
          volume: m.volume(),
          bbox: { min: [bb.min[0], bb.min[1], bb.min[2]], max: [bb.max[0], bb.max[1], bb.max[2]] },
          hasGroup: !!window.__lastFoundationGroup,
        };
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return { error: 'timeout' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'loft-boss-trace.log'), consoleLines.join('\n'));
    throw new Error(`Foundation pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  const fr = (h, r1, r2) => Math.PI * h * (r1 ** 2 + r1 * r2 + r2 ** 2) / 3;
  const Vtheory = fr(10, 5, 4) + fr(10, 4, 2) + fr(10, 2, 1);

  console.log(`\n=== INTEGRATION: LOFT BOSS through real ribbon ===`);
  console.log(`Foundation manifold V = ${result.volume.toFixed(2)} mm³  (analytical Σfrusta = ${Vtheory.toFixed(2)})`);
  console.log(`bbox z span: [${result.bbox.min[2].toFixed(2)}, ${result.bbox.max[2].toFixed(2)}]  (expected 0 to 30)`);

  fs.writeFileSync(path.join(ROOT, 'loft-boss-integration.json'), JSON.stringify(result, null, 2));

  const errPct = (result.volume - Vtheory) / Vtheory * 100;
  expect(Math.abs(errPct)).toBeLessThan(1);
  expect(result.bbox.min[2]).toBeCloseTo(0, 4);
  expect(result.bbox.max[2]).toBeCloseTo(30, 4);
  expect(result.hasGroup).toBe(true);
});
