import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-nurbsrefine');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt NURBS Refine — OCCT h + p refinement chain, shape preserved', async () => {
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
    window.__archdiscPlanParams['Sculpt NURBS Refine'] = {
      size: 40, crown: 8, x: 0, y: 0, z: 0, color: 0xc0d0e0,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt NURBS Refine"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastNurbsRefineReport && window.__lastNurbsRefineReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastNurbsRefineReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[NurbsRefine] ${r.size}×${r.size} crown=${r.crown} | base ${r.base?.nUPoles}×${r.base?.nVPoles} d=${r.base?.uDegree}×${r.base?.vDegree} → refined ${r.refined?.nUPoles}×${r.refined?.nVPoles} d=${r.refined?.uDegree}×${r.refined?.vDegree} → elevated ${r.elevated?.nUPoles}×${r.elevated?.nVPoles} d=${r.elevated?.uDegree}×${r.elevated?.vDegree} | G base=${r.baseGaussian.toExponential(3)} elevated=${r.elevatedGaussian.toExponential(3)} shape-relErr=${(r.gaussianShapeRelError * 100).toFixed(4)}%`);

  // Base: 4×4 poles, degree 3×3.
  expect(r.base.nUPoles).toBe(4);
  expect(r.base.nVPoles).toBe(4);
  expect(r.base.uDegree).toBe(3);
  expect(r.base.vDegree).toBe(3);
  // After h-refinement (insert 3 knots in each direction): poles grow.
  expect(r.refined.nUPoles).toBeGreaterThan(r.base.nUPoles);
  expect(r.refined.nVPoles).toBeGreaterThan(r.base.nVPoles);
  // Degree unchanged after h-refinement.
  expect(r.refined.uDegree).toBe(r.base.uDegree);
  expect(r.refined.vDegree).toBe(r.base.vDegree);
  // After p-refinement (degree elevation): degree grows.
  expect(r.elevated.uDegree).toBeGreaterThan(r.refined.uDegree);
  expect(r.elevated.vDegree).toBeGreaterThan(r.refined.vDegree);
  // Shape preservation: Gaussian curvature at centre matches within 0.1 %.
  expect(r.gaussianShapeRelError).toBeLessThan(0.001);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
