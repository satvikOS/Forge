import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-cross');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt 3-Axis Cross — OCCT rotate × 3 + fuse', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt 3-Axis Cross'] = { R: 6, length: 100, x: 0, y: 0, z: 0, color: 0xa3826b }; });
  await win.locator('[data-ribbon-tool-name="Sculpt 3-Axis Cross"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastCrossAxisReport, null, { timeout: 8 * 60 * 1000 });
  const r = await win.evaluate(() => window.__lastCrossAxisReport);
  console.log(`[Cross] R=${r.R} L=${r.length} actual=${r.actualVolume.toFixed(0)} faces=${r.faceCount}`);

  expect(r.actualVolume).toBeGreaterThan(0);
  // Three cylinders of V = π·R²·L = π·36·100 = 11310 each, total before
  // overlap = 33929. Overlap region is small near origin, so the fused
  // volume is between 1 cylinder and 3 cylinders.
  expect(r.actualVolume).toBeGreaterThan(15000);
  expect(r.actualVolume).toBeLessThan(34000);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
