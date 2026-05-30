import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-stitch');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Stitch Faces — OCCT BRepBuilderAPI_Sewing of 2 panels', async () => {
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
    window.__archdiscPlanParams['Sculpt Stitch Faces'] = {
      panelW: 20, panelH: 20, gap: 0.05, tolerance: 0.1,
      x: 0, y: 0, z: 0, color: 0xd8b8e6,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Stitch Faces"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastStitchReport && window.__lastStitchReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastStitchReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Stitch] ${r.panelW}×${r.panelH} + ${r.panelW}×${r.panelH} gap=${r.gap} tol=${r.tolerance} | faces=${r.faceCount} edges=${r.edgeCount}`);

  // Stitching produces 2 panel faces (welded at the seam).
  expect(r.faceCount).toBe(2);
  // 7 edges expected: 4 outer + 1 (or 2) at the seam.
  expect(r.edgeCount).toBeGreaterThanOrEqual(7);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
