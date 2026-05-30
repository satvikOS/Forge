import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-sweepflange');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Sweep Flange — OCCT sheet metal swept lip', async () => {
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
    window.__archdiscPlanParams['Sculpt Sweep Flange'] = {
      plateX: 100, plateY: 60, thickness: 2, profileWidth: 15, pathLength: 80,
      x: 0, y: 0, z: 0, color: 0xb8e6d8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Sweep Flange"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastSweepFlangeReport && window.__lastSweepFlangeReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastSweepFlangeReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[SweepFlange] ${r.plateX}×${r.plateY}×${r.thickness} + profile=${r.profileWidth} path=${r.pathLength} | base V=${r.baseVolume.toFixed(0)} swept V=${r.sweptVolume.toFixed(0)} faces ${r.baseFaceCount}→${r.sweptFaceCount} bends=${r.bendCount} type=${r.lastBendType}`);

  // Base 100·60·2 = 12000 mm³.
  expect(Math.abs(r.baseVolume - 12000)).toBeLessThan(1);
  // Swept body should add lip material.
  expect(r.sweptVolume).toBeGreaterThan(r.baseVolume);
  // Bend record present and tagged as sweepFlange.
  expect(r.bendCount).toBeGreaterThanOrEqual(1);
  expect(r.lastBendType).toBe('sweepFlange');

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
