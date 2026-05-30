import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-classify');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Classify Point — OCCT BRepClass3d_SolidClassifier', async () => {
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
    window.__archdiscPlanParams['Sculpt Classify Point'] = {
      sphereR: 20, x: 0, y: 0, z: 0,
      colorBody: 0xa8c8e6, colorIn: 0x40ff40, colorOn: 0xffff40, colorOut: 0xff4040,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Classify Point"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastClassifyReport && window.__lastClassifyReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastClassifyReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[Classify] sphere R=${r.sphereR} | results: ${r.results.map((rr) => `(${rr.pt.x},${rr.pt.y},${rr.pt.z})→${rr.actual} (expected ${rr.expected}, match=${rr.match})`).join(' | ')} allMatch=${r.allMatch}`);

  // All 4 classifications must match expected.
  expect(r.allMatch).toBe(true);
  expect(r.results).toHaveLength(4);
  expect(r.results[0].actual).toBe('inside');   // (0,0,0)
  expect(r.results[1].actual).toBe('on');       // (R,0,0)
  expect(r.results[2].actual).toBe('outside');  // (R+10,0,0)
  expect(r.results[3].actual).toBe('inside');   // (R/2,0,0)

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
