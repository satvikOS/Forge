import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-partingline');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Parting Line — OCCT mold silhouette, frustum bottom circle', async () => {
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
    window.__archdiscPlanParams['Sculpt Parting Line'] = {
      r1: 20, r2: 10, h: 30, minDeg: 3,
      x: 0, y: 0, z: 0, color: 0xffd070,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Parting Line"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastPartingLineReport && window.__lastPartingLineReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastPartingLineReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[PartingLine] r1=${r.r1} r2=${r.r2} h=${r.h} pull=[${r.pullDirection.join(',')}] → ${r.edgeCount} edges expectedZ=${r.expectedBottomZ} edges=${JSON.stringify(r.edges)}`);

  // Frustum has exactly 1 parting edge — the bottom circle, where the
  // positive lateral meets the negative bottom cap.
  expect(r.edgeCount).toBe(1);
  const e = r.edges[0];
  // Both endpoints lie on the bottom z plane.
  expect(Math.abs(e.start.z - r.expectedBottomZ)).toBeLessThan(0.01);
  expect(Math.abs(e.end.z - r.expectedBottomZ)).toBeLessThan(0.01);
  // The apparent radius from axis equals r1.
  expect(Math.abs(e.apparentRadius - r.r1)).toBeLessThan(0.01);
  // The two adjacent draft signs must be opposite.
  const sides = [e.leftDraft, e.rightDraft].sort();
  expect(sides).toEqual(['negative', 'positive']);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
