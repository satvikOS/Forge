import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-planarsection');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Planar Section — OCCT plane cross-cut, sphere split', async () => {
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
    window.__archdiscPlanParams['Sculpt Planar Section'] = {
      sphereR: 20, planeZ: 5, x: 0, y: 0, z: 0,
      colorA: 0xe6a8a8, colorB: 0xa8a8e6,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Planar Section"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastSectionReport && window.__lastSectionReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastSectionReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Section] sphere R=${r.sphereR} z=${r.planeZ} | sphere V=${r.sphereVolume.toFixed(0)} pieces=${r.pieceCount} pieceVols=[${r.pieceVolumes.map(v=>v.toFixed(0)).join(',')}] sumV=${r.sumVolume.toFixed(0)} relErr=${(r.relError * 100).toFixed(4)}%`);

  // 2 pieces (top + bottom).
  expect(r.pieceCount).toBe(2);
  // Volume conservation across pieces.
  expect(r.relError).toBeLessThan(0.001);
  // Both pieces > 0.
  for (const v of r.pieceVolumes) expect(v).toBeGreaterThan(0);
  // Total = sphere volume 4/3·π·R³.
  expect(r.sumVolume).toBeCloseTo(r.sphereVolume, 0);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
