import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-evalsurf');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Eval Surface — OCCT BRepAdaptor_Surface, sphere K=1/R²', async () => {
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
    window.__archdiscPlanParams['Sculpt Eval Surface'] = {
      sphereR: 20, x: 0, y: 0, z: 0, color: 0xb8d2e6,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Eval Surface"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastEvalSurfReport && window.__lastEvalSurfReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastEvalSurfReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[EvalSurf] sphere R=${r.sphereR} expected K=${r.expectedK.toExponential(3)} | ${r.results.map((rr) => `${rr.label}@(${rr.u},${rr.v}) dist=${rr.distFromCentre.toFixed(3)} G=${(rr.gaussian || 0).toExponential(3)} type=${rr.surfaceType}`).join(' | ')}`);

  // 3 sample points.
  expect(r.results).toHaveLength(3);
  // Each sampled point should lie on the sphere surface (dist ≈ R within tolerance).
  for (const s of r.results) {
    expect(s.distFromCentre).toBeCloseTo(r.sphereR, 2);
    // Surface type detected as sphere.
    expect(s.surfaceType).toBe('sphere');
    // Sphere Gaussian curvature K = 1/R² uniform across the surface.
    if (s.gaussian != null) {
      expect(Math.abs(Math.abs(s.gaussian) - r.expectedK) / r.expectedK).toBeLessThan(0.01);
    }
  }

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
