import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-flatpattern');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Flat Pattern — OCCT sheet metal unroll, L-bracket', async () => {
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
    window.__archdiscPlanParams['Sculpt Flat Pattern'] = {
      plateX: 100, plateY: 60, thickness: 2, flangeLength: 30, angleDeg: 90, edgeIdx: 4,
      x: 0, y: 0, z: 0,
      colorBent: 0xd1d6e8, colorFlat: 0xe6e6a8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Flat Pattern"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastFlatPatternReport && window.__lastFlatPatternReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastFlatPatternReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[FlatPattern] ${r.plateX}×${r.plateY}×${r.thickness} L-bracket | bent V=${r.bentVolume.toFixed(0)} faces=${r.bentFaceCount} bends=${r.bentBendCount} BA-sum=${r.bentBendAllowanceSum.toFixed(3)} last=${r.lastBendAllowance?.toFixed(3)} | flat V=${r.flatVolume.toFixed(0)} faces=${r.flatFaceCount} isFlat=${r.flatIsFlat}`);

  // Bent body: 1 bend recorded with bendAllowance ≈ 4.71 mm.
  expect(r.bentBendCount).toBe(1);
  expect(r.lastBendAllowance).toBeCloseTo(4.712, 2);
  // Flat pattern body must be tagged isFlat=true.
  expect(r.flatIsFlat).toBe(true);
  // Bent and flat volumes are both > 0; the flat may differ from the bent
  // due to the kernel's bounding-rect flat reconstruction (documented
  // approximation in SP-82). We require both > 0 and within an order
  // of magnitude.
  expect(r.bentVolume).toBeGreaterThan(0);
  expect(r.flatVolume).toBeGreaterThan(0);
  expect(r.flatVolume / r.bentVolume).toBeGreaterThan(0.1);
  expect(r.flatVolume / r.bentVolume).toBeLessThan(10);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
