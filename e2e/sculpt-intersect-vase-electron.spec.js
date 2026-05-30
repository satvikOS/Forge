import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-intersect-vase');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Boolean Intersect + Revolved Vase — OCCT', async () => {
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

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Boolean Intersect'] = { boxSize: 60, sphereR: 40, sphereDx: 0, sphereDy: 0, sphereDz: 0, x: -80, y: 0, z: 0, color: 0xa3826b }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Boolean Intersect"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastIntersectReport, null, { timeout: 8 * 60 * 1000 });
  const i = await win.evaluate(() => window.__lastIntersectReport);
  console.log(`[Intersect] box ${i.boxSize} ∩ sph ${i.sphereR} actual=${i.actualVolume.toFixed(0)} faces=${i.faceCount}`);
  await win.waitForTimeout(2000);

  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Revolved Vase'] = { baseR: 30, neckR: 14, height: 80, baseH: 20, x: 80, y: 0, z: 0, color: 0x6b9aa3 }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Revolved Vase"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastVaseReport, null, { timeout: 60_000 });
  const v = await win.evaluate(() => window.__lastVaseReport);
  console.log(`[Vase] predicted=${v.predictedVolume.toFixed(0)} actual=${v.actualVolume.toFixed(0)} relErr=${(v.relError*100).toFixed(3)}% faces=${v.faceCount}`);

  // Box (60³ = 216 cm³) ∩ Sphere R=40 (vol 268 cm³). For sphere fully
  // covering box's inscribed sphere (R=30) but not corners, intersection
  // ≈ slightly less than box volume, > sphere of R≈30 (113 cm³).
  expect(i.actualVolume).toBeGreaterThan(100_000);
  expect(i.actualVolume).toBeLessThan(216_000);

  // Vase volume matches analytic (cyl base + frustum) exactly.
  expect(v.relError).toBeLessThan(0.005);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
