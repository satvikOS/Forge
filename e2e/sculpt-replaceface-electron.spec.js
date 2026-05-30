import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-replaceface');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Replace Face — OCCT curved-swap (P4 native, bulged top face)', async () => {
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
    window.__archdiscPlanParams['Sculpt Replace Face'] = {
      boxSize: 40, faceIdx: 6, bulge: 8, x: 0, y: 0, z: 0, color: 0xe6d0a8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Replace Face"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastReplaceFaceReport && window.__lastReplaceFaceReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastReplaceFaceReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[ReplaceFace] ${r.boxSize}³ face #${r.faceIdx} bulge=${r.bulge} | V ${r.volumeBefore.toFixed(0)} → ${r.volumeAfter.toFixed(0)} ΔV=${r.volumeDelta.toFixed(0)} faces ${r.faceCountBefore}→${r.faceCountAfter}`);

  // Volume changes from face swap (bulge adds positive volume above original plane).
  expect(r.volumeBefore).toBeCloseTo(64000, 0);
  expect(r.volumeAfter).toBeGreaterThan(0);
  expect(r.volumeDelta).not.toBe(0);
  // Face count likely preserved (one face replaced 1:1).
  expect(r.faceCountAfter).toBeGreaterThanOrEqual(6);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
