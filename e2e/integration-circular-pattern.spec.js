import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

/**
 * INTEGRATION TEST — Circular Pattern wired into the actual ribbon.
 * Clicks the real button, asserts the resulting manifold body has
 * 6 × seed-volume and is radially symmetric in XY.
 */
test('Integration: Circular Pattern in the ribbon runs foundation.circularPattern around +Z', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const partTab = page.locator('.ribbon-tab', { hasText: 'Part' }).first();
  await expect(partTab).toBeVisible({ timeout: 15000 });
  await partTab.click();

  const circularPatternBtn = page.locator('.ribbon-tool', { hasText: 'Circular Pattern' }).first();
  await expect(circularPatternBtn).toBeVisible({ timeout: 10000 });
  await circularPatternBtn.click();

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
    return { error: 'timeout — foundation manifold never set' };
  });

  if (result?.error) {
    fs.writeFileSync(path.join(ROOT, 'circular-pattern-trace.log'), consoleLines.join('\n'));
    throw new Error(`Foundation pipeline failed: ${result.error}\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  // Seed: 2 × 6 × 10 = 120 mm³.   6 copies, no overlap → 720 mm³.
  console.log(`\n=== INTEGRATION: CIRCULAR PATTERN through real ribbon ===`);
  console.log(`Foundation manifold V = ${result.volume.toFixed(2)} mm³  (expected ~720 mm³ = 6 × 120)`);
  console.log(`bbox: [${result.bbox.min.map(x => x.toFixed(2))}] → [${result.bbox.max.map(x => x.toFixed(2))}]`);

  fs.writeFileSync(path.join(ROOT, 'circular-pattern-integration.json'), JSON.stringify(result, null, 2));

  expect(result.volume).toBeGreaterThan(715);
  expect(result.volume).toBeLessThan(725);
  expect(result.hasGroup).toBe(true);
  // 6-fold symmetry → roughly square XY bbox; Z bbox = [-5, 5]
  expect(result.bbox.min[2]).toBeCloseTo(-5, 1);
  expect(result.bbox.max[2]).toBeCloseTo(5, 1);
  const dx = result.bbox.max[0] - result.bbox.min[0];
  const dy = result.bbox.max[1] - result.bbox.min[1];
  expect(Math.abs(dx - dy)).toBeLessThan(5);
});
