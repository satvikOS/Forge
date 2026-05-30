import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-project');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Project Points — OCCT GeomAPI_ProjectPointOnSurf, 100 pts', async () => {
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
    window.__archdiscPlanParams['Sculpt Project Points'] = {
      sphereR: 20, cloudR: 22, pointCount: 100,
      x: 0, y: 0, z: 0,
      colorBody: 0xa8c8e6, colorPts: 0xff8040,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Project Points"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastProjectReport && window.__lastProjectReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastProjectReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Project] sphere R=${r.sphereR} cloud R=${r.cloudR} N=${r.pointCount} | max dev = ${r.maxDeviation.toExponential(3)} mm, avg = ${r.avgDeviation.toExponential(3)} mm`);

  // Every projected point must lie on the sphere surface (distance from
  // centre ≈ sR) within tight tolerance (< 0.001 mm).
  expect(r.maxDeviation).toBeLessThan(0.001);
  expect(r.avgDeviation).toBeLessThan(0.0001);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
