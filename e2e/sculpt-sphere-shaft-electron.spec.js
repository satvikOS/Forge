import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-sphere-shaft');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Sphere + Stepped Shaft — OCCT primitives', async () => {
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
    vp.camera.position.set(0.05, 0.20, 0.40);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);

  // Spheres
  for (let i = 0; i < 3; i++) {
    const R = [15, 22, 30][i];
    await win.evaluate((c) => { window.__archdiscPlanParams = window.__archdiscPlanParams || {}; window.__archdiscPlanParams['Sculpt Sphere Primitive'] = c; }, { R, x: -120 + i * 80, y: 0, z: 0, color: [0xb89a82, 0x82b89a, 0x9a82b8][i] });
    await win.locator('[data-ribbon-tool-name="Sculpt Sphere Primitive"]').first().dispatchEvent('click');
    const tmax = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction((expected) => { const r = window.__lastSphereReport; return !!r && r.R === expected.R; }, { R }, { timeout: tmax });
    const r = await win.evaluate(() => window.__lastSphereReport);
    console.log(`[Sphere] R=${r.R} predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount}`);
    expect(r.relError).toBeLessThan(0.005);
    await win.waitForTimeout(1500);
  }

  // Stepped shaft
  await win.evaluate(() => { window.__archdiscPlanParams['Sculpt Stepped Shaft'] = { r1: 8, h1: 30, r2: 15, h2: 40, r3: 12, h3: 30, r4: 6, h4: 20, x: 150, y: 0, z: 0, color: 0x9a8a72 }; });
  await win.locator('[data-ribbon-tool-name="Sculpt Stepped Shaft"]').first().dispatchEvent('click');
  await win.waitForFunction(() => !!window.__lastShaftReport, null, { timeout: 60_000 });
  const sh = await win.evaluate(() => window.__lastShaftReport);
  console.log(`[Shaft] segments=${sh.segments.length} L=${sh.totalLength} predicted=${sh.predictedVolume.toFixed(0)} actual=${sh.actualVolume.toFixed(0)} relErr=${(sh.relError*100).toFixed(3)}% faces=${sh.faceCount}`);
  expect(sh.relError).toBeLessThan(0.005);
  await win.waitForTimeout(2500);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
