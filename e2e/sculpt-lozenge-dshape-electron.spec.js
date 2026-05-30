import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-lozenge-dshape');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Lozenge + D-Shape — OCCT', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Lozenge Prism'] = { length: 80, radius: 15, depth: 20, x: -80, y: 0, z: 0, color: 0x82a3c6 }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Lozenge Prism"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastLozengeReport, null, { timeout: 8 * 60 * 1000 });
  const l = await win.evaluate(() => window.__lastLozengeReport);
  console.log(`[Lozenge] predicted=${l.predictedVolume.toFixed(0)} actual=${l.actualVolume.toFixed(0)} relErr=${(l.relError*100).toFixed(3)}% faces=${l.faceCount}`);
  await win.waitForTimeout(1500);

  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt D-Shape Prism'] = { R: 25, flat: 18, depth: 30, x: 80, y: 0, z: 0, color: 0xa3c682 }; });
  await win.locator('[data-ribbon-tool-name="Sculpt D-Shape Prism"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastDShapeReport, null, { timeout: 60_000 });
  const d = await win.evaluate(() => window.__lastDShapeReport);
  console.log(`[D-Shape] predicted=${d.predictedVolume.toFixed(0)} actual=${d.actualVolume.toFixed(0)} relErr=${(d.relError*100).toFixed(3)}% faces=${d.faceCount}`);

  expect(l.relError).toBeLessThan(0.005);
  expect(d.relError).toBeLessThan(0.005);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
