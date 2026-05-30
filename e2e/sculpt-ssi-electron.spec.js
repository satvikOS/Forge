import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-ssi');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Intersect Surfaces — OCCT NURBS SSI, sphere + plane', async () => {
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
    window.__archdiscPlanParams['Sculpt Intersect Surfaces'] = {
      sphereR: 20, centerD: 15, samples: 64,
      x: 0, y: 0, z: 0,
      colorA: 0xa8c1e6, colorB: 0xc1e6a8, colorCurve: 0xff8030,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Intersect Surfaces"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastSSIReport && window.__lastSSIReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastSSIReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[SSI] sphere R=${r.sphereR} ∩ sphere R=${r.sphereR} d=${r.centerD} samples=${r.samples} | nbLines=${r.nbLines} pts=${r.totalPoints} L=${r.totalLength.toFixed(2)} expectedRChord=${r.expectedRChord.toFixed(2)} expectedL=${r.expectedCircleLen.toFixed(2)} relErr=${(r.lengthRelError * 100).toFixed(3)}%`);

  // For 2 spheres R=20 distance d=15: r_int = √(400 − 56.25) = √343.75 ≈ 18.54 mm.
  expect(Math.abs(r.expectedRChord - Math.sqrt(343.75))).toBeLessThan(0.001);
  // Expected circumference 2π·18.54 ≈ 116.49 mm.
  expect(Math.abs(r.expectedCircleLen - 2 * Math.PI * Math.sqrt(343.75))).toBeLessThan(0.01);
  // SSI returns at least one curve.
  expect(r.nbLines).toBeGreaterThanOrEqual(1);
  // Sampled length matches analytic within 1 % (polyline approximation).
  expect(r.lengthRelError).toBeLessThan(0.01);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
