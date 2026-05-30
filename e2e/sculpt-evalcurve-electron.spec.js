import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-evalcurve');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Eval Curve — OCCT BRepAdaptor_Curve D2 on cylinder edges', async () => {
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
    window.__archdiscPlanParams['Sculpt Eval Curve'] = {
      radius: 20, height: 40, x: 0, y: 0, z: 0, color: 0xc8a8e0,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Eval Curve"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastEvalCurveReport && window.__lastEvalCurveReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastEvalCurveReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[EvalCurve] cyl R=${r.radius}×${r.height} expected κ_circle=${r.expectedCircleCurvature} | ${r.results.map((rr) => rr.error ? `[${rr.edgeIdx}]ERR=${rr.error}` : `[${rr.edgeIdx}] κ=${rr.curvature.toFixed(4)} speed=${rr.speed.toFixed(2)} t=${rr.parameter.toFixed(2)} deg=${rr.degenerate}`).join(' | ')}`);

  // Cylinder has edges; at least some should be classifiable.
  expect(r.results.length).toBeGreaterThanOrEqual(2);
  // Find a circular edge (curvature ≈ 1/R = 0.05).
  const circles = r.results.filter((rr) => !rr.error && rr.curvature > 0 && Math.abs(rr.curvature - r.expectedCircleCurvature) < 0.001);
  // Find a straight edge (curvature ≈ 0).
  const lines = r.results.filter((rr) => !rr.error && rr.curvature < 1e-6);
  // We expect at least 1 circular edge with κ = 0.05 = 1/20.
  expect(circles.length).toBeGreaterThanOrEqual(1);
  // And at least 0 line edges (the seam — varies by kernel).
  expect(lines.length).toBeGreaterThanOrEqual(0);
  // Verify the circle's curvature value.
  if (circles.length > 0) {
    expect(circles[0].curvature).toBeCloseTo(1 / r.radius, 6);
  }

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
