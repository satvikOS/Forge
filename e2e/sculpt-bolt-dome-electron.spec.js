import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-bolt-dome');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Hex Bolt + Half-Sphere Dome — OCCT', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Hex Bolt'] = { acrossFlats: 24, headHeight: 10, shankR: 8, shankLen: 60, x: -80, y: 0, z: 0, color: 0x7a6a5a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Hex Bolt"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastBoltReport, null, { timeout: 8 * 60 * 1000 });
  const b = await win.evaluate(() => window.__lastBoltReport);
  console.log(`[Bolt] predicted=${b.predictedVolume.toFixed(0)} actual=${b.actualVolume.toFixed(0)} relErr=${(b.relError*100).toFixed(3)}% faces=${b.faceCount}`);
  await win.waitForTimeout(2000);

  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Half-Sphere Dome'] = { R: 30, x: 80, y: 0, z: 0, color: 0x82a39a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Half-Sphere Dome"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastDomeReport, null, { timeout: 60_000 });
  const d = await win.evaluate(() => window.__lastDomeReport);
  console.log(`[Dome] R=${d.R} predicted=${d.predictedVolume.toFixed(0)} actual=${d.actualVolume.toFixed(0)} relErr=${(d.relError*100).toFixed(3)}% faces=${d.faceCount}`);

  expect(b.relError).toBeLessThan(0.005);
  expect(d.relError).toBeLessThan(0.005);
  expect(b.faceCount).toBeGreaterThanOrEqual(9);   // 6 hex + top + bottom + shank
  expect(d.faceCount).toBe(2);                     // hemisphere + flat circle

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
