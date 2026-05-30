import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-helix');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Helix Curve — OCCT wire + THREE.Line, Ø20 pitch 5 × 8 turns', async () => {
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
    window.__archdiscPlanParams['Sculpt Helix Curve'] = {
      diameter: 20, pitch: 5, revolutions: 8, segsPerRev: 64,
      x: 0, y: 0, z: 0, color: 0x60d3a8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Helix Curve"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastHelixReport && window.__lastHelixReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastHelixReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Helix] Ø${r.diameter} pitch=${r.pitch} revs=${r.revolutions} segs/rev=${r.segsPerRev} pts=${r.pointCount} measured=${r.measuredLength.toFixed(2)}mm predicted=${r.expectedLength.toFixed(2)}mm relErr=${(r.relError * 100).toFixed(3)}%`);

  // L = revs · √(pitch² + (π·D)²) = 8 · √(25 + 400·π²) ≈ 504.24 mm.
  expect(Math.abs(r.expectedLength - 504.24)).toBeLessThan(0.5);
  // Sampled-polyline length within 0.1 % of analytic (high seg/rev).
  expect(r.relError).toBeLessThan(0.001);
  // 8 revs × 64 segs/rev → 513 points (+1 for endpoint).
  expect(r.pointCount).toBeGreaterThan(8 * 64);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
