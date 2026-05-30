import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-dumbbell');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Dumbbell — OCCT sphere + cyl + sphere fused', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });
  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');
  await win.waitForTimeout(2000);

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Dumbbell'] = { barR: 6, barL: 80, weightR: 20, x: 0, y: 0, z: 0, color: 0x6a7a8a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Dumbbell"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastDumbbellReport, null, { timeout: 8 * 60 * 1000 });
  const r = await win.evaluate(() => window.__lastDumbbellReport);
  console.log(`[Dumbbell] barØ${r.barR * 2}×${r.barL} weights Ø${r.weightR * 2} actual=${r.actualVolume.toFixed(0)} faces=${r.faceCount}`);

  expect(r.actualVolume).toBeGreaterThan(0);
  // V_bar  = π·36·80 ≈ 9048
  // V_each_weight = (4/3)π·8000 ≈ 33510
  // Total (no overlap) = 9048 + 67021 ≈ 76069
  // Overlap (bar inside sphere) is small since barR << weightR.
  expect(r.actualVolume).toBeGreaterThan(40_000);
  expect(r.actualVolume).toBeLessThan(80_000);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
