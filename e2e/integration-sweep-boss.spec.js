import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'integration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Integration: Sweep Boss in the ribbon runs foundation.sweep on a NURBS quarter-arc path', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  const partTab = page.locator('.ribbon-tab', { hasText: 'Part' }).first();
  await expect(partTab).toBeVisible({ timeout: 15000 });
  await partTab.click();

  const sweepBtn = page.locator('.ribbon-tool', { hasText: 'Sweep Boss' }).first();
  await expect(sweepBtn).toBeVisible({ timeout: 10000 });
  await sweepBtn.click();

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
    fs.writeFileSync(path.join(ROOT, 'sweep-boss-trace.log'), consoleLines.join('\n'));
    throw new Error(`Foundation pipeline failed.\nConsole:\n${consoleLines.slice(-40).join('\n')}`);
  }

  const Vtheory = Math.PI * Math.PI * 10 * 1 * 1 / 2;   // π²Rr²/2 ≈ 49.35
  console.log(`\n=== INTEGRATION: SWEEP BOSS through real ribbon ===`);
  console.log(`Foundation manifold V = ${result.volume.toFixed(4)} mm³  (analytical π²Rr²/2 = ${Vtheory.toFixed(4)} mm³)`);
  console.log(`bbox: [${result.bbox.min.map(x => x.toFixed(2))}] → [${result.bbox.max.map(x => x.toFixed(2))}]`);

  fs.writeFileSync(path.join(ROOT, 'sweep-boss-integration.json'), JSON.stringify(result, null, 2));

  const err = (result.volume - Vtheory) / Vtheory * 100;
  expect(Math.abs(err)).toBeLessThan(3);
  expect(result.hasGroup).toBe(true);
});
