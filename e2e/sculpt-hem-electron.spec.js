import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-hem');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Sheet Metal Hem — OCCT open hem on base flange edge', async () => {
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
    window.__archdiscPlanParams['Sculpt Sheet Metal Hem'] = {
      plateX: 100, plateY: 60, thickness: 2, hemType: 'open', hemLength: 8, edgeIdx: 4,
      x: 0, y: 0, z: 0, color: 0xc8dab8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Sheet Metal Hem"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastHemReport && window.__lastHemReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastHemReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Hem] ${r.plateX}×${r.plateY}×${r.thickness} + ${r.hemType} hem L=${r.hemLength} edge=${r.edgeIdx} | base V=${r.baseVolume.toFixed(0)} hemmed V=${r.hemmedVolume.toFixed(0)} faces ${r.baseFaceCount}→${r.hemmedFaceCount} bends=${r.bendCount} lastBend=${JSON.stringify(r.lastBend)}`);

  // Base 100·60·2 = 12000 mm³.
  expect(Math.abs(r.baseVolume - 12000)).toBeLessThan(1);
  // Hem adds material: ~ 100·8·2 = 1600 mm³ (open hem at 165° angle).
  expect(r.hemmedVolume).toBeGreaterThan(13000);
  expect(r.hemmedVolume).toBeLessThan(14500);
  // Bend metadata: 1 hem bend with hemType='open' and nominal angle 165°.
  expect(r.bendCount).toBeGreaterThanOrEqual(1);
  expect(r.lastBend).toBeTruthy();
  expect(r.lastBend.type).toBe('hem');
  expect(r.lastBend.hemType).toBe('open');
  expect(r.lastBend.hemAngleDeg).toBe(165);
  expect(r.lastBend.hemLength).toBe(8);
  // bendAllowance per ISO sheet-metal: π·(r+k·t)·(165/180) = π·3·(165/180) ≈ 8.64 mm.
  expect(r.lastBend.bendAllowance).toBeGreaterThan(8);
  expect(r.lastBend.bendAllowance).toBeLessThan(9);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
