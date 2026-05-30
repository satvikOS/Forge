import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-tubes');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Square Tube + Rect Tube + Angle Iron — OCCT', async () => {
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
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 50; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.20, 0.40, 0.70);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);

  // Square tube
  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Square Tube'] = { side: 50, wall: 4, length: 400, x: -200, y: 0, z: 0, color: 0x6b8aa5 }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Square Tube"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastSqTubeReport, null, { timeout: 8 * 60 * 1000 });
  const sq = await win.evaluate(() => window.__lastSqTubeReport);
  console.log(`[SquareTube] predicted=${sq.predictedVolume.toFixed(0)} actual=${sq.actualVolume.toFixed(0)} relErr=${(sq.relError*100).toFixed(3)}% faces=${sq.faceCount}`);
  await win.waitForTimeout(2000);
  await win.screenshot({ path: path.join(OUT, '01-square.png') });

  // Rect tube
  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Rect Tube'] = { sideX: 80, sideY: 40, wall: 4, length: 400, x: 0, y: 0, z: 0, color: 0xa56b8a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Rect Tube"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastRectTubeReport, null, { timeout: 60_000 });
  const rt = await win.evaluate(() => window.__lastRectTubeReport);
  console.log(`[RectTube] predicted=${rt.predictedVolume.toFixed(0)} actual=${rt.actualVolume.toFixed(0)} relErr=${(rt.relError*100).toFixed(3)}% faces=${rt.faceCount}`);
  await win.waitForTimeout(2000);
  await win.screenshot({ path: path.join(OUT, '02-rect.png') });

  // Angle iron
  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Angle Iron'] = { legA: 50, legB: 50, thickness: 5, length: 500, x: 200, y: 0, z: 0, color: 0x8aa56b }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Angle Iron"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastAngleReport, null, { timeout: 60_000 });
  const ang = await win.evaluate(() => window.__lastAngleReport);
  console.log(`[Angle] predicted=${ang.predictedVolume.toFixed(0)} actual=${ang.actualVolume.toFixed(0)} relErr=${(ang.relError*100).toFixed(3)}% faces=${ang.faceCount}`);
  await win.waitForTimeout(2000);
  await win.screenshot({ path: path.join(OUT, '03-angle.png') });

  expect(sq.relError).toBeLessThan(0.005);
  expect(rt.relError).toBeLessThan(0.005);
  expect(ang.relError).toBeLessThan(0.005);

  await win.waitForTimeout(6000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
