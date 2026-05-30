import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-lofttan');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Loft Tangent — OCCT ThruSections with G1 smoothing, 3 sections', async () => {
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
    window.__archdiscPlanParams['Sculpt Loft Tangent'] = {
      s0: 40, s1: 20, s2: 30, z0: 0, z1: 20, z2: 40,
      x: 0, y: 0, z: 0, color: 0xe6c8b8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Loft Tangent"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastLoftReport && window.__lastLoftReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastLoftReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Loft] sections ${r.s0}/${r.s1}/${r.s2} z=${r.z0}/${r.z1}/${r.z2} | V=${r.actualVolume.toFixed(0)} avg-cs estimate=${r.predictedVolume.toFixed(0)} faces=${r.faceCount} edges=${r.edgeCount}`);

  // Volume non-zero, in reasonable range.
  expect(r.actualVolume).toBeGreaterThan(0);
  // Bound: should be > smallest section × height (smallest = 20² × 40 = 16000).
  expect(r.actualVolume).toBeGreaterThan(15000);
  // Bound: should be < largest section × height (largest = 40² × 40 = 64000).
  expect(r.actualVolume).toBeLessThan(70000);
  // Loft has at least caps + lateral faces (3 sections → typically 6 faces).
  expect(r.faceCount).toBeGreaterThanOrEqual(4);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
