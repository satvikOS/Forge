import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-nurbscurv');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt NURBS Curvature — OCCT analytic principal κ on sail patch', async () => {
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
    window.__archdiscPlanParams['Sculpt NURBS Curvature'] = {
      size: 40, crown: 8,
      x: 0, y: 0, z: 0, color: 0xc0e0c0,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt NURBS Curvature"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastNurbsCurvReport && window.__lastNurbsCurvReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastNurbsCurvReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[NurbsCurv] ${r.size}×${r.size} crown=${r.crown} | ${r.results.map((rr) => `${rr.label}@(${rr.u},${rr.v}) G=${rr.gaussian.toExponential(3)} H=${rr.mean.toExponential(3)} κmin=${rr.kMin.toExponential(3)} κmax=${rr.kMax.toExponential(3)} euler=${rr.eulerCheck.toExponential(2)} gauss=${rr.gaussianCheck.toExponential(2)}`).join(' | ')}`);

  // 3 sample points.
  expect(r.results).toHaveLength(3);
  // Euler's relation: kMin + kMax = 2·mean.
  for (const s of r.results) {
    expect(s.eulerCheck).toBeLessThan(1e-6);
    // Gaussian = kMin · kMax (differential geometry identity).
    expect(s.gaussianCheck).toBeLessThan(1e-6);
    // kMin <= kMax always.
    expect(s.kMin).toBeLessThanOrEqual(s.kMax);
  }
  // Centre of a domed surface (crown > 0) → both principal curvatures
  // negative (the surface is convex upward at the centre — concave from
  // above). The kernel's normal convention may flip the sign; either
  // way both kMin and kMax have the SAME sign → gaussian > 0.
  expect(r.results[0].gaussian).toBeGreaterThan(0);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
