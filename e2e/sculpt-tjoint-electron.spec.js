import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-tjoint');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt T-Joint Cylinder — OCCT rotate + fuse', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt T-Joint Cylinder'] = { priR: 15, priLen: 100, secR: 10, secLen: 120, x: 0, y: 0, z: 0, color: 0x6ba39a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt T-Joint Cylinder"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastTeeJointReport, null, { timeout: 8 * 60 * 1000 });
  const r = await win.evaluate(() => window.__lastTeeJointReport);
  console.log(`[T-Joint] pri Ø${r.priR * 2}×${r.priLen} sec Ø${r.secR * 2}×${r.secLen} actual=${r.actualVolume.toFixed(0)} faces=${r.faceCount}`);

  expect(r.actualVolume).toBeGreaterThan(0);
  // Primary V = π·15²·100 ≈ 70686; Secondary V = π·10²·120 ≈ 37699;
  // Fused volume ≈ pri + sec − intersection (small overlap region).
  // Bound checks that it lands between the larger single cylinder and
  // their sum, with non-trivial separation between them (catches a
  // regression where one of the two cylinders is missing).
  expect(r.actualVolume).toBeGreaterThan(70686);                 // > primary alone
  expect(r.actualVolume).toBeLessThan(70686 + 37699);            // < pri + sec (overlap subtracted)

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
