import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-boundaryboss');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Boundary Boss — OCCT multi-section loft, circle → square', async () => {
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
    window.__archdiscPlanParams['Sculpt Boundary Boss'] = {
      circleR: 30, squareS: 40, height: 60, circleSegs: 32,
      x: 0, y: 0, z: 0, color: 0xb5e3c1,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Boundary Boss"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastBoundaryBossReport && window.__lastBoundaryBossReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastBoundaryBossReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[BoundaryBoss] Ø${r.circleR * 2}→□${r.squareS}×H${r.H} circleArea=${r.circleArea.toFixed(0)} squareArea=${r.squareArea} V=${r.actualVolume.toFixed(0)} bounded[${r.minBound.toFixed(0)},${r.maxBound.toFixed(0)}] faces=${r.faceCount} edges=${r.edgeCount}`);

  // Cross-section areas — analytic sanity.
  expect(Math.abs(r.circleArea - Math.PI * 30 * 30)).toBeLessThan(1);
  expect(r.squareArea).toBe(1600);
  // Lofted volume must lie between min-area·H and max-area·H.
  expect(r.actualVolume).toBeGreaterThan(r.minBound);
  expect(r.actualVolume).toBeLessThan(r.maxBound);
  // The loft has caps + lateral faces — at least 2 caps + 4 lateral.
  expect(r.faceCount).toBeGreaterThanOrEqual(6);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
