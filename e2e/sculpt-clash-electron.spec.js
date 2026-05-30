import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-clash');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Clash Detection — OCCT interference + clash zone, 2 boxes', async () => {
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

  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Sculpt Clash Detection'] = {
      boxSize: 40, shiftX: 20, shiftY: 20, shiftZ: 0,
      x: 0, y: 0, z: 0,
      colorA: 0x80a8d0, colorB: 0xd0a890, colorZone: 0xff5060,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Clash Detection"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastClashReport && window.__lastClashReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastClashReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Clash] ${r.boxSize}³ shift(${r.shiftX},${r.shiftY},${r.shiftZ}) | clash=${r.clash} interference V=${r.interferenceVolume.toFixed(0)} predicted=${r.predictedInterference.toFixed(0)} relErr=${(r.relError * 100).toFixed(4)}% minDist=${r.minDistance.toFixed(3)} zones=${r.zoneCount} zonePresent=${r.zonePresent}`);

  // 2 boxes shifted by (20,20,0) → clash exists.
  expect(r.clash).toBe(true);
  // Overlap region = (40-20)×(40-20)×(40-0) = 20·20·40 = 16,000 mm³.
  expect(r.predictedInterference).toBe(16000);
  expect(r.relError).toBeLessThan(0.001);
  // Touching/overlapping → minDistance == 0.
  expect(r.minDistance).toBeCloseTo(0, 5);
  // Exactly 1 disjoint overlap zone.
  expect(r.zoneCount).toBe(1);
  expect(r.zonePresent).toBe(true);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
