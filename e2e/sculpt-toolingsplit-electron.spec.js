import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-toolingsplit');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Tooling Split — OCCT mold core/cavity, frustum', async () => {
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
    window.__archdiscPlanParams['Sculpt Tooling Split'] = {
      r1: 20, r2: 10, h: 30, x: 0, y: 0, z: 0,
      colorCore: 0xf2b5b5, colorCavity: 0xb5d6f2,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Tooling Split"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastToolingSplitReport && window.__lastToolingSplitReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastToolingSplitReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[ToolingSplit] r1=${r.r1} r2=${r.r2} h=${r.h} pieces=${r.pieceCount} core=${r.coreVolume?.toFixed(0)} cavity=${r.cavityVolume?.toFixed(0)} ΣV=${r.sumVolume.toFixed(0)} predicted=${r.predictedVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% plane=${JSON.stringify(r.partingPlane)}`);

  expect(r.pieceCount).toBe(2);
  expect(r.coreVolume).toBeGreaterThan(0);
  expect(r.cavityVolume).toBeGreaterThan(0);
  // Volume conservation across core + cavity = frustum.
  expect(r.relError).toBeLessThan(0.001);
  // Parting plane normal is +Z (pull direction).
  expect(Math.abs(r.partingPlane.normal[2] - 1)).toBeLessThan(0.001);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
