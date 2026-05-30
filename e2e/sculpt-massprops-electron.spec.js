import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-massprops');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Mass Properties — OCCT GProp inertia + principal axes', async () => {
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
    window.__archdiscPlanParams['Sculpt Mass Properties'] = {
      boxSize: 40, filletR: 4, density: 7850,
      x: 0, y: 0, z: 0, color: 0xb8c2cc,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Mass Properties"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastMassPropsReport && window.__lastMassPropsReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastMassPropsReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[MassProps] ${r.boxSize}³ fillet R=${r.filletR} ρ=${r.density} | V=${r.volume.toFixed(0)} mm³ m=${r.mass.toFixed(4)} kg A=${r.surfaceArea.toFixed(0)} mm² centroid=(${r.centroid.x.toFixed(2)},${r.centroid.y.toFixed(2)},${r.centroid.z.toFixed(2)}) pm=[${r.principalMoments.map(p=>p.toExponential(3)).join(',')}] pmJs=[${r.principalMomentsJs.map(p=>p.toExponential(3)).join(',')}] pmStdDev/mean=${(r.pmStdDev/r.pmMean*100).toFixed(2)}%`);

  // V = 40³ minus the corner-fillet reductions ≈ 62,438 mm³.
  expect(r.volume).toBeGreaterThan(60000);
  expect(r.volume).toBeLessThan(64000);
  // Mass = V[m³] · ρ for steel (7850 kg/m³): ~62.4 g.
  expect(r.mass).toBeCloseTo(r.volume * 1e-9 * r.density, 4);
  // Centroid should be near (0, 0, 0) (the body is centred by translate).
  expect(Math.abs(r.centroid.x)).toBeLessThan(0.1);
  expect(Math.abs(r.centroid.y)).toBeLessThan(0.1);
  expect(Math.abs(r.centroid.z)).toBeLessThan(0.1);
  // Surface area should be near 6·40² = 9,600 mm² minus fillet edge reduction.
  expect(r.surfaceArea).toBeGreaterThan(8000);
  expect(r.surfaceArea).toBeLessThan(10000);
  // For a near-cubic body, the 3 principal moments should be approximately
  // equal (within < 1 % spread).
  expect(r.pmStdDev / r.pmMean).toBeLessThan(0.01);
  // OCCT engine + JS Jacobi should agree on principal moments within ~1 %.
  for (let i = 0; i < 3; i++) {
    if (r.principalMoments[i] > 0 && r.principalMomentsJs[i] > 0) {
      expect(Math.abs(r.principalMoments[i] - r.principalMomentsJs[i]) / r.principalMoments[i]).toBeLessThan(0.01);
    }
  }

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
