import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-g2blend');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt G2 Blend — OCCT NURBS surface fit between 2 box edges', async () => {
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
    window.__archdiscPlanParams['Sculpt G2 Blend'] = {
      boxSize: 40, edgeA: 0, edgeB: 2, uSegments: 32, vSegments: 16,
      x: 0, y: 0, z: 0, color: 0xe6a8c1,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt G2 Blend"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastG2BlendReport && window.__lastG2BlendReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastG2BlendReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[G2Blend] ${r.boxSize}³ edges(${r.edgeA},${r.edgeB}) ${r.uSegments}×${r.vSegments} segs | faces=${r.faceCount} edges=${r.edgeCount} V=${r.volume.toFixed(0)} spineFaces=${r.spineFaceCount} analytic=${r.analyticFaceCount} hasSurf=${r.hasAnalyticSurface} degree=${r.analyticDegreeU}×${r.analyticDegreeV}`);

  // The blend produced a non-trivial body.
  expect(r.faceCount).toBeGreaterThanOrEqual(1);
  expect(r.edgeCount).toBeGreaterThanOrEqual(1);
  // Analytic NURBS surface attached.
  expect(r.hasAnalyticSurface).toBe(true);
  // Degree-3-in-u / degree-5-in-v (G2 needs degree-5 to match 2nd derivative).
  expect(r.analyticDegreeU).toBe(3);
  expect(r.analyticDegreeV).toBe(5);
  // At least one analytic spine face from the blend.
  expect(r.analyticFaceCount).toBeGreaterThanOrEqual(1);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
