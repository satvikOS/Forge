import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-lens-conebore');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Biconvex Lens + Cone-with-Bore — OCCT', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Biconvex Lens'] = { R: 40, separation: 60, x: -60, y: 0, z: 0, color: 0x9ac6c6 }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Biconvex Lens"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastLensReport, null, { timeout: 8 * 60 * 1000 });
  const l = await win.evaluate(() => window.__lastLensReport);
  console.log(`[Lens] predicted=${l.predictedVolume.toFixed(0)} actual=${l.actualVolume.toFixed(0)} relErr=${(l.relError*100).toFixed(3)}% faces=${l.faceCount}`);
  await win.waitForTimeout(2000);

  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Cone with Bore'] = { r1: 25, r2: 12, height: 40, boreR: 6, x: 60, y: 0, z: 0, color: 0xc6a39a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Cone with Bore"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastConeBoreReport, null, { timeout: 60_000 });
  const c = await win.evaluate(() => window.__lastConeBoreReport);
  console.log(`[ConeBore] predicted=${c.predictedVolume.toFixed(0)} actual=${c.actualVolume.toFixed(0)} relErr=${(c.relError*100).toFixed(3)}% faces=${c.faceCount}`);

  expect(l.relError).toBeLessThan(0.005);
  expect(c.relError).toBeLessThan(0.005);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
