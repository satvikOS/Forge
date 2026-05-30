import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-classa');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Class-A Analyze — OCCT Gaussian curvature heatmap, filleted cube', async () => {
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
    window.__archdiscPlanParams['Sculpt Class-A Analyze'] = {
      boxSize: 40, filletR: 8, deflection: 0.5,
      x: 0, y: 0, z: 0,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Class-A Analyze"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastClassAReport && window.__lastClassAReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastClassAReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[ClassA] ${r.boxSize}³ fillet R=${r.filletR} defl=${r.deflection} | tris=${r.triangleCount} verts=${r.samples} K∈[${r.gaussianRange[0].toExponential(2)},${r.gaussianRange[1].toExponential(2)}] meanH∈[${r.meanRange[0].toExponential(2)},${r.meanRange[1].toExponential(2)}] expectedFilletK=${r.expectedFilletK.toExponential(2)} robustRange=${r.robustRange.toExponential(2)} degenTris=${r.degenerateTriangles}`);

  // Tessellation produced a substantial mesh.
  expect(r.triangleCount).toBeGreaterThan(200);
  expect(r.samples).toBeGreaterThan(100);
  // Gaussian range must span the fillet's analytic K = 1/r² = 1/64 ≈ 0.0156.
  expect(r.expectedFilletK).toBeCloseTo(1 / 64, 4);
  // The max Gaussian curvature on the mesh must be at least near the fillet K.
  // Discrete K from tessellation tends to be smaller than analytic, so allow a
  // generous bound — within an order of magnitude.
  expect(r.gaussianRange[1]).toBeGreaterThan(r.expectedFilletK * 0.1);
  // robustRange (the symmetric ± range the colour ramp used) > 0.
  expect(r.robustRange).toBeGreaterThan(0);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
