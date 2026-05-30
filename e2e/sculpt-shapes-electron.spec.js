import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-shapes');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Trapezoid + Cross + Star prisms — OCCT extrudeProfile', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Trapezoid Prism'] = { bottom: 80, top: 50, height: 30, depth: 200, x: -150, y: 0, z: 0, color: 0x9a82a3 }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Trapezoid Prism"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastTrapezoidReport, null, { timeout: 8 * 60 * 1000 });
  const tr = await win.evaluate(() => window.__lastTrapezoidReport);
  console.log(`[Trapezoid] predicted=${tr.predictedVolume.toFixed(0)} actual=${tr.actualVolume.toFixed(0)} relErr=${(tr.relError*100).toFixed(3)}% faces=${tr.faceCount}`);
  await win.waitForTimeout(1500);

  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Cross Prism'] = { armLength: 50, armWidth: 18, depth: 80, x: 0, y: 0, z: 0, color: 0xa3829a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Cross Prism"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastCrossReport, null, { timeout: 60_000 });
  const cr = await win.evaluate(() => window.__lastCrossReport);
  console.log(`[Cross] predicted=${cr.predictedVolume.toFixed(0)} actual=${cr.actualVolume.toFixed(0)} relErr=${(cr.relError*100).toFixed(3)}% faces=${cr.faceCount}`);
  await win.waitForTimeout(1500);

  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Star Prism'] = { points: 5, outerR: 30, innerR: 14, depth: 15, x: 150, y: 0, z: 0, color: 0xc6824a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Star Prism"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastStarReport, null, { timeout: 60_000 });
  const st = await win.evaluate(() => window.__lastStarReport);
  console.log(`[Star] points=${st.points} oR=${st.outerR} iR=${st.innerR} actual=${st.actualVolume.toFixed(0)} faces=${st.faceCount}`);

  expect(tr.relError).toBeLessThan(0.005);
  expect(cr.relError).toBeLessThan(0.005);
  expect(st.actualVolume).toBeGreaterThan(0);
  expect(st.actualVolume).toBeLessThan(st.outerDiscArea * st.depth);
  expect(st.faceCount).toBe(12);       // 10 star sides (2N) + 2 caps

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
