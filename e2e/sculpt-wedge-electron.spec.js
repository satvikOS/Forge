import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-wedge');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Wedge Block — OCCT triangle extrude', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Wedge Block'] = { base: 80, rise: 40, depth: 60, x: 0, y: 0, z: 0, color: 0xb8a36b }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Wedge Block"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastWedgeReport, null, { timeout: 8 * 60 * 1000 });
  const r = await win.evaluate(() => window.__lastWedgeReport);
  console.log(`[Wedge] ${r.base}×${r.rise}×${r.depth} predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount}`);

  expect(r.relError).toBeLessThan(0.005);
  expect(r.faceCount).toBe(5);  // 3 lateral + 2 triangle caps

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
