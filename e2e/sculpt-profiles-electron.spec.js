import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-profiles');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt T-Profile + U-Channel + Hex Block — OCCT structural sections', async () => {
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
    vp.camera.position.set(0.35, 0.45, 0.90);
    vp.orbitControls.target.set(0, 0.04, 0);
    vp.camera.lookAt(0, 0.04, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);

  // T-Profile
  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Sculpt T-Profile'] = { length: 500, bf: 100, d: 80, tw: 6, tf: 8, x: -300, y: 0, z: 0, color: 0x8f9a85 };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt T-Profile"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastTeeReport, null, { timeout: 8 * 60 * 1000 });
  const tee = await win.evaluate(() => window.__lastTeeReport);
  console.log(`[Sculpt T] predicted=${tee.predictedVolume.toFixed(0)} actual=${tee.actualVolume.toFixed(0)} relErr=${(tee.relError*100).toFixed(3)}% faces=${tee.faceCount}`);
  await win.waitForTimeout(2000);
  await win.screenshot({ path: path.join(OUT, '01-tee.png') });

  // U-Channel
  await win.evaluate(() => {
    window.__archdiscPlanParams['Sculpt U-Channel'] = { length: 500, bf: 100, d: 80, tw: 6, tf: 8, x: 0, y: 0, z: 0, color: 0x9a858f };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt U-Channel"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastChannelReport, null, { timeout: 60_000 });
  const u = await win.evaluate(() => window.__lastChannelReport);
  console.log(`[Sculpt U] predicted=${u.predictedVolume.toFixed(0)} actual=${u.actualVolume.toFixed(0)} relErr=${(u.relError*100).toFixed(3)}% faces=${u.faceCount}`);
  await win.waitForTimeout(2000);
  await win.screenshot({ path: path.join(OUT, '02-uchan.png') });

  // Hex Block
  await win.evaluate(() => {
    window.__archdiscPlanParams['Sculpt Hex Block'] = { acrossFlats: 60, height: 30, x: 250, y: 0, z: 0, color: 0x858f9a };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Hex Block"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastHexReport, null, { timeout: 60_000 });
  const hex = await win.evaluate(() => window.__lastHexReport);
  console.log(`[Sculpt Hex] predicted=${hex.predictedVolume.toFixed(0)} actual=${hex.actualVolume.toFixed(0)} relErr=${(hex.relError*100).toFixed(3)}% faces=${hex.faceCount}`);
  await win.waitForTimeout(2000);
  await win.screenshot({ path: path.join(OUT, '03-hex.png') });

  expect(tee.relError).toBeLessThan(0.005);
  expect(u.relError).toBeLessThan(0.005);
  expect(hex.relError).toBeLessThan(0.005);
  expect(tee.faceCount).toBeGreaterThanOrEqual(8);
  expect(u.faceCount).toBeGreaterThanOrEqual(10);
  expect(hex.faceCount).toBe(8);                       // 6 sides + top + bottom

  await win.waitForTimeout(6000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
