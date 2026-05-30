import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-miterflange');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Miter Flange — OCCT sheet metal multi-edge with miter records', async () => {
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
    window.__archdiscPlanParams['Sculpt Miter Flange'] = {
      plateX: 100, plateY: 60, thickness: 2, flangeLength: 25, angleDeg: 90,
      x: 0, y: 0, z: 0, color: 0xc0d8b8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Miter Flange"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastMiterFlangeReport && window.__lastMiterFlangeReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastMiterFlangeReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[MiterFlange] ${r.plateX}×${r.plateY}×${r.thickness} + flange ${r.flangeLength}×${r.angleDeg}° | base V=${r.baseVolume.toFixed(0)} V=${r.miteredVolume.toFixed(0)} faces ${r.baseFaceCount}→${r.miteredFaceCount} bends=${r.bendCount} miterPartners=${r.miterPartners}`);

  // Base 12000 mm³.
  expect(r.baseVolume).toBeCloseTo(12000, 0);
  // Mitered body adds 2 flanges' material.
  expect(r.miteredVolume).toBeGreaterThan(r.baseVolume);
  // 2 bends recorded (one per edge).
  expect(r.bendCount).toBe(2);
  // Adjacent pair = 2 bends miter-paired.
  expect(r.miterPartners).toBe(2);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
