import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-whiffle');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Whiffle Ball — OCCT sphere − N drilled cylinders', async () => {
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
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.05, 0.20, 0.30);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Whiffle Ball'] = { R: 30, holeR: 5, rings: 3, perRing: 6, x: 0, y: 0, z: 0, color: 0xc6b87a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Whiffle Ball"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastWhiffleReport, null, { timeout: 10 * 60 * 1000 });
  const r = await win.evaluate(() => window.__lastWhiffleReport);
  console.log(`[Whiffle] R=${r.R} rings=${r.rings}×${r.perRing}=${r.cutCount} cuts sphere=${r.sphereVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} faces=${r.faceCount} ms=${r.elapsedMs}`);

  expect(r.actualVolume).toBeGreaterThan(0);
  expect(r.actualVolume).toBeLessThan(r.sphereVolume);   // holes remove material
  expect(r.cutCount).toBeGreaterThanOrEqual(r.rings * r.perRing - 4);
  expect(r.faceCount).toBeGreaterThanOrEqual(2);
  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
