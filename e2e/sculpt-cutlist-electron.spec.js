import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-cutlist');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Cut List — OCCT Weldments BOM aggregation, 3 members', async () => {
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
    window.__archdiscPlanParams['Sculpt Cut List'] = {
      rounding: 1, x: 0, y: 0, z: 0,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Cut List"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastCutListReport && window.__lastCutListReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastCutListReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[CutList] rounding=${r.rounding} | totalLines=${r.totalLines} totalLength=${r.totalLengthMm.toFixed(1)}mm | groups=${JSON.stringify(r.groups)}`);

  // 2 BOM lines expected: 2× 50x50x4 @ 1000 mm + 1× 80x80x5 @ 500 mm.
  expect(r.totalLines).toBe(2);
  // Total length 1000 + 1000 + 500 = 2500 mm.
  expect(r.totalLengthMm).toBeCloseTo(2500, 0);
  // Quantity grouping: one line should have qty=2, the other qty=1.
  const qtyValues = r.groups.map((g) => g.quantity).sort();
  expect(qtyValues).toEqual([1, 2]);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
