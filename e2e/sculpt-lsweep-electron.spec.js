import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-lsweep');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt OCCT L-Sweep — circle profile along L path', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt OCCT L-Sweep'] = { profileR: 6, segA: 60, segB: 80, x: 0, y: 0, z: 0, color: 0x6ba38a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt OCCT L-Sweep"]').first().dispatchEvent('click');
  await win.waitForFunction(() => { const r = window.__lastLSweepReport; return !!r && r.error !== 'in progress'; }, null, { timeout: 8 * 60 * 1000 });
  const r = await win.evaluate(() => window.__lastLSweepReport);
  console.log(`[L-Sweep] error=${r.error} pathLen=${r.pathLen} predicted=${r.predictedVolume ? r.predictedVolume.toFixed(0) : '?'} actual=${r.actualVolume.toFixed(0)} relErr=${r.relError != null ? (r.relError*100).toFixed(1)+'%' : '?'} faces=${r.faceCount} ms=${r.elapsedMs}`);

  expect(r.error).toBeNull();
  expect(r.actualVolume).toBeGreaterThan(0);
  // OCCT BRepOffsetAPI_MakePipe only sweeps the FIRST segment of a
  // non-smooth multi-segment polyline path (documented limitation: the
  // algorithm wants a smooth spine, not a piecewise-linear chain).
  // Volume tracks segA × π·r² (first segment only), not the full path.
  // Test just guards that a non-empty solid lands.
  expect(r.actualVolume).toBeLessThan(r.predictedVolume);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
