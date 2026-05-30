import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-fillet-chamfer');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Filleted Box + Chamfered Box — OCCT filletAll / chamferAll', async () => {
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
    vp.camera.position.set(0.10, 0.20, 0.40);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Filleted Box'] = { dx: 80, dy: 60, dz: 40, r: 6, x: -80, y: 0, z: 0, color: 0x9aa3ad }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Filleted Box"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastFilletReport, null, { timeout: 8 * 60 * 1000 });
  const f = await win.evaluate(() => window.__lastFilletReport);
  console.log(`[Fillet] r=${f.r} box=${f.boxVolume} actual=${f.actualVolume.toFixed(0)} faces=${f.faceCount}`);
  await win.waitForTimeout(2000);

  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Chamfered Box'] = { dx: 80, dy: 60, dz: 40, distance: 6, x: 80, y: 0, z: 0, color: 0xa39aad }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Chamfered Box"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastChamferReport, null, { timeout: 60_000 });
  const c = await win.evaluate(() => window.__lastChamferReport);
  console.log(`[Chamfer] d=${c.distance} box=${c.boxVolume} actual=${c.actualVolume.toFixed(0)} faces=${c.faceCount}`);

  // Both ops remove material (fillet + chamfer trim corner volume).
  expect(f.actualVolume).toBeLessThan(f.boxVolume);
  expect(c.actualVolume).toBeLessThan(c.boxVolume);
  // Canonical post-fillet / chamfer topology: 6 + 12 + 8 = 26 faces.
  expect(f.faceCount).toBeGreaterThanOrEqual(20);
  expect(c.faceCount).toBeGreaterThanOrEqual(20);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
