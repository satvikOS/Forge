import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-partition');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Partition Box — OCCT volumetric split, multi-cell', async () => {
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
    window.__archdiscPlanParams['Sculpt Partition Box'] = {
      boxX: 100, boxY: 100, boxZ: 40, slabT: 1,
      x: 0, y: 0, z: 0, color: 0xb89aff,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Partition Box"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastPartitionReport && window.__lastPartitionReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastPartitionReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Partition] box ${r.boxX}×${r.boxY}×${r.boxZ} + ${r.slabT}mm slab → ${r.pieceCount} cells, ΣV=${r.actualSumVolume.toFixed(0)} predicted=${r.predictedVolume.toFixed(0)} relErr=${(r.relError * 100).toFixed(3)}% perPiece=[${r.perPieceVolumes.map((v) => v.toFixed(0)).join(', ')}]`);

  // Multi-cell partition: at least 2 pieces.
  expect(r.pieceCount).toBeGreaterThanOrEqual(2);
  // Volume conservation across pieces.
  expect(r.relError).toBeLessThan(0.001);
  // Per-piece volumes all positive.
  for (const v of r.perPieceVolumes) expect(v).toBeGreaterThan(0);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
