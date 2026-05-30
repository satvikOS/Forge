import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-hiddenline');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Hidden Line — OCCT HLR projection, filleted cube', async () => {
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
    window.__archdiscPlanParams['Sculpt Hidden Line'] = {
      boxSize: 40, filletR: 6, viewX: 1, viewY: 1, viewZ: 1,
      x: 0, y: 0, z: 0,
      colorBody: 0xcccccc, colorVisible: 0x000000, colorHidden: 0x888888,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Hidden Line"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastHiddenLineReport && window.__lastHiddenLineReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastHiddenLineReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[HiddenLine] ${r.boxSize}³ fillet R=${r.filletR} view=[${r.viewDir.join(',')}] | visible sharp=${r.visibleSharpCount} outline=${r.visibleOutlineCount}, hidden sharp=${r.hiddenSharpCount} outline=${r.hiddenOutlineCount}, total=${r.totalEdgeCount} method=${r.method}`);

  // HLR returns at least one polyline.
  expect(r.totalEdgeCount).toBeGreaterThan(0);
  // A convex filleted cube viewed from outside has NO hidden edges
  // (correct HLR output) — we only assert the visible buckets exist.
  expect(r.visibleSharpCount + r.visibleOutlineCount).toBeGreaterThan(0);
  // For the filleted cube, the silhouette outline edges should be 12
  // (one per box edge — the rounded silhouette of each fillet band).
  expect(r.visibleOutlineCount).toBe(12);
  // No sharp edges on a filleted cube (everything is rounded).
  expect(r.visibleSharpCount).toBe(0);
  // Method tag.
  expect(r.method).toBe('occt-hlr');

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
