import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-sketchedbend');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Sketched Bend — OCCT sheet metal arbitrary bend on edge', async () => {
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
    window.__archdiscPlanParams['Sculpt Sketched Bend'] = {
      plateX: 100, plateY: 60, thickness: 2, angleDeg: 45, flangeLength: 30, edgeIdx: 4,
      x: 0, y: 0, z: 0, color: 0xb8c8da,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Sketched Bend"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastSketchedBendReport && window.__lastSketchedBendReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastSketchedBendReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[SketchedBend] ${r.plateX}×${r.plateY}×${r.thickness} + ${r.angleDeg}°×${r.flangeLength} edge=${r.edgeIdx} | base V=${r.baseVolume.toFixed(0)} bent V=${r.bentVolume.toFixed(0)} faces ${r.baseFaceCount}→${r.bentFaceCount} bends=${r.bendCount} lastBend=${JSON.stringify(r.lastBend)}`);

  // Base 100·60·2 = 12000 mm³.
  expect(Math.abs(r.baseVolume - 12000)).toBeLessThan(1);
  // Bent body = base + flange material.
  expect(r.bentVolume).toBeGreaterThan(r.baseVolume);
  // Sketched bend records type='sketchedBend'.
  expect(r.lastBend).toBeTruthy();
  expect(r.lastBend.type).toBe('sketchedBend');
  expect(r.lastBend.angleDeg).toBe(45);
  expect(r.lastBend.flangeLength).toBe(30);
  // bendAllowance for 45° bend: π·(r+k·t)·(45/180) = π·3·0.25 ≈ 2.356 mm.
  expect(r.lastBend.bendAllowance).toBeGreaterThan(2);
  expect(r.lastBend.bendAllowance).toBeLessThan(3);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
