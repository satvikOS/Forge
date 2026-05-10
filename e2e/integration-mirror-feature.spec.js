import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: Mirror Feature in the ribbon runs foundation.mirrorAndUnion across XZ', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const partTab = page.locator('.ribbon-tab', { hasText: 'Part' }).first();
  await expect(partTab).toBeVisible({ timeout: 15000 });
  await partTab.click();

  const mirrorBtn = page.locator('.ribbon-tool', { hasText: 'Mirror Feature' }).first();
  await expect(mirrorBtn).toBeVisible({ timeout: 10000 });
  await mirrorBtn.click();

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
    fs.writeFileSync(path.join(ROOT, 'mirror-feature-trace.log'), consoleLines.join('\n'));
    throw new Error(`Foundation pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  console.log(`\n=== INTEGRATION: MIRROR FEATURE through real ribbon ===`);
  console.log(`Foundation manifold V = ${result.volume.toFixed(2)} mm³  (expected 4000 mm³ = 2 × 2000)`);
  console.log(`bbox Y span: [${result.bbox.min[1].toFixed(2)}, ${result.bbox.max[1].toFixed(2)}]  (expected symmetric ±10)`);

  fs.writeFileSync(path.join(ROOT, 'mirror-feature-integration.json'), JSON.stringify(result, null, 2));

  expect(result.volume).toBeCloseTo(4000, 0);
  expect(result.hasGroup).toBe(true);
  expect(result.bbox.min[1]).toBeCloseTo(-10, 4);
  expect(result.bbox.max[1]).toBeCloseTo(10, 4);
});
