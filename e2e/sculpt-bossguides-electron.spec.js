import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-bossguides');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Boundary Boss Guides — OCCT multi-section + 2 guide rails', async () => {
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
    window.__archdiscPlanParams['Sculpt Boundary Boss Guides'] = {
      circleR: 30, squareS: 40, height: 60, circleSegs: 32,
      x: 0, y: 0, z: 0, color: 0xd0c0e0,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Boundary Boss Guides"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastBoundaryBossGuidesReport && window.__lastBoundaryBossGuidesReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastBoundaryBossGuidesReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[BossGuides] Ø${r.circleR * 2} → □${r.squareS}×H${r.height} | faces=${r.faceCount} edges=${r.edgeCount} V=${r.volume.toFixed(0)} mode=${r.mode} fallback=${r.guideFallback}`);

  // Loft produces a body with at least caps + lateral faces.
  expect(r.faceCount).toBeGreaterThanOrEqual(4);
  expect(r.volume).toBeGreaterThan(0);
  // Result is bounded between smallest and largest cross-section × H.
  const cArea = Math.PI * r.circleR * r.circleR;
  const sArea = r.squareS * r.squareS;
  const minBound = Math.min(cArea, sArea) * r.height;
  const maxBound = Math.max(cArea, sArea) * r.height;
  expect(r.volume).toBeGreaterThan(minBound * 0.9);
  expect(r.volume).toBeLessThan(maxBound * 1.5);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
