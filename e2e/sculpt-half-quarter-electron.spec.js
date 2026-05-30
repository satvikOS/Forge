import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-half-quarter');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Half-Cylinder + Quarter-Sphere — OCCT cut', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Half-Cylinder'] = { R: 20, height: 60, x: -60, y: 0, z: 0, color: 0x6ba38a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Half-Cylinder"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastHalfCylReport, null, { timeout: 8 * 60 * 1000 });
  const h = await win.evaluate(() => window.__lastHalfCylReport);
  console.log(`[Half-Cyl] R=${h.R} predicted=${h.predictedVolume.toFixed(0)} actual=${h.actualVolume.toFixed(0)} relErr=${(h.relError*100).toFixed(3)}% faces=${h.faceCount}`);
  await win.waitForTimeout(1500);

  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Quarter-Sphere'] = { R: 30, x: 60, y: 0, z: 0, color: 0x8a6ba3 }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Quarter-Sphere"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastQuarterSphereReport, null, { timeout: 60_000 });
  const q = await win.evaluate(() => window.__lastQuarterSphereReport);
  console.log(`[Quarter-Sph] R=${q.R} predicted=${q.predictedVolume.toFixed(0)} actual=${q.actualVolume.toFixed(0)} relErr=${(q.relError*100).toFixed(3)}% faces=${q.faceCount}`);

  expect(h.relError).toBeLessThan(0.005);
  expect(q.relError).toBeLessThan(0.005);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
