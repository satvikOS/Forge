import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-grid');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Grid Hole Plate — OCCT M×N pattern', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Grid Hole Plate'] = { plateW: 120, plateH: 80, plateT: 6, cols: 4, rows: 3, holeR: 4, margin: 12, x: 0, y: 0, z: 0, color: 0x8a7aa5 }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Grid Hole Plate"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastGridPlateReport, null, { timeout: 8 * 60 * 1000 });
  const r = await win.evaluate(() => window.__lastGridPlateReport);
  console.log(`[GridPlate] ${r.cols}×${r.rows}=${r.N} holes Ø${r.holeR * 2} predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount}`);

  expect(r.relError).toBeLessThan(0.005);
  expect(r.faceCount).toBeGreaterThanOrEqual(6 + r.N);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
