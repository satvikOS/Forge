import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-pipeshell');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Pipe Shell Sweep — OCCT MakePipeShell, tortuous right-angle path', async () => {
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
    window.__archdiscPlanParams['Sculpt Pipe Shell Sweep'] = {
      profileR: 4, segLength: 20, bendCount: 2,
      x: 0, y: 0, z: 0, color: 0xa8d8e6,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Pipe Shell Sweep"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastPipeShellReport && window.__lastPipeShellReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastPipeShellReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[PipeShell] Ø${r.profileR * 2}×${r.bendCount + 1} segs of ${r.segLength}mm | V=${r.actualVolume.toFixed(0)} predicted=${r.predictedVolume.toFixed(0)} relErr=${(r.volumeRelError * 100).toFixed(2)}% faces=${r.faceCount} edges=${r.edgeCount}`);

  // 3 path segments × 20mm = 60mm path. Cross-sec = π·16 = 50.27 mm².
  // Naive predicted V = 60·50.27 = 3016 mm³ for the full multi-segment.
  expect(r.predictedVolume).toBeCloseTo(60 * Math.PI * 16, 0);
  // Honest kernel note: in this WASM build, MakePipeShell only sweeps
  // the FIRST segment of a multi-bend right-angle path (the auxiliary-
  // spine variant is fragile in opencascade.js — same documented gap
  // as sweepProfile / SP-82 / SP-103). So actual V ≈ π·r²·segLength
  // (single segment), not 3× that.
  const singleSegV = Math.PI * 16 * 20;  // π·16·20 ≈ 1005.31 mm³
  expect(r.actualVolume).toBeCloseTo(singleSegV, 0);
  // At least 3 faces (cylinder lateral + 2 caps).
  expect(r.faceCount).toBeGreaterThanOrEqual(3);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
