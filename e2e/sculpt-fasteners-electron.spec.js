import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-fasteners');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Spool + Hex Nut + Washer — OCCT fastener primitives', async () => {
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
    vp.camera.position.set(0.05, 0.20, 0.35);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);

  await win.evaluate(() => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Spool'] = { flangeR: 25, flangeT: 5, shaftR: 12, shaftL: 30, x: -100, y: 0, z: 0, color: 0x6b9aa5 }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Spool"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastSpoolReport, null, { timeout: 8 * 60 * 1000 });
  const s = await win.evaluate(() => window.__lastSpoolReport);
  console.log(`[Spool] predicted=${s.predictedVolume.toFixed(0)} actual=${s.actualVolume.toFixed(0)} relErr=${(s.relError*100).toFixed(3)}% faces=${s.faceCount}`);
  await win.waitForTimeout(2000);

  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Hex Nut'] = { acrossFlats: 24, height: 16, boreR: 8, x: 0, y: 0, z: 0, color: 0x8a7a6a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Hex Nut"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastNutReport, null, { timeout: 60_000 });
  const n = await win.evaluate(() => window.__lastNutReport);
  console.log(`[Nut] predicted=${n.predictedVolume.toFixed(0)} actual=${n.actualVolume.toFixed(0)} relErr=${(n.relError*100).toFixed(3)}% faces=${n.faceCount}`);
  await win.waitForTimeout(2000);

  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Washer'] = { outerR: 15, boreR: 8.5, thickness: 2.5, x: 100, y: 0, z: 0, color: 0x9a9a9a }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Washer"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastWasherReport, null, { timeout: 60_000 });
  const w = await win.evaluate(() => window.__lastWasherReport);
  console.log(`[Washer] predicted=${w.predictedVolume.toFixed(0)} actual=${w.actualVolume.toFixed(0)} relErr=${(w.relError*100).toFixed(3)}% faces=${w.faceCount}`);

  expect(s.relError).toBeLessThan(0.005);
  expect(n.relError).toBeLessThan(0.005);
  expect(w.relError).toBeLessThan(0.005);
  expect(n.faceCount).toBe(9);                    // 6 hex sides + 2 caps + 1 bore cyl
  expect(w.faceCount).toBe(4);                    // top + bottom + outer + bore

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
