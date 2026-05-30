import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/* SP-50 — Sculpt Section Cut. OCCT planar split, three shape × axis combos. */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-section');
fs.mkdirSync(OUT, { recursive: true });

const CONFIGS = [
  { label: '01-box-Z', params: { shape: 'box', size: 60, sizeY: 40, sizeZ: 30, planeAxis: 'Z', planeOffset: 0, separation: 15, x: -150, y: 0, z: 0, colorA: 0xa56b6b, colorB: 0x6b6ba5 } },
  { label: '02-cyl-X', params: { shape: 'cylinder', size: 50, sizeY: 0, sizeZ: 60, planeAxis: 'X', planeOffset: 0, separation: 18, x: 0, y: 0, z: 0, colorA: 0xa5a56b, colorB: 0x6ba5a5 } },
  { label: '03-sph-Y', params: { shape: 'sphere', size: 50, sizeY: 0, sizeZ: 0, planeAxis: 'Y', planeOffset: 0, separation: 20, x: 150, y: 0, z: 0, colorA: 0x8aa56b, colorB: 0xa56b8a } },
];

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Section Cut — OCCT planar split, 3 shape×axis combos', async () => {
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
    vp.camera.position.set(0.10, 0.30, 0.45);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  for (let i = 0; i < CONFIGS.length; i++) {
    const cfg = CONFIGS[i];
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Section Cut'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Section Cut"]').first().dispatchEvent('click');
    const tmax = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction(
      (expected) => { const r = window.__lastSectionReport; return !!r && r.shape === expected.shape && r.planeAxis === expected.axis; },
      { shape: cfg.params.shape, axis: cfg.params.planeAxis }, { timeout: tmax }
    );
    const r = await win.evaluate(() => window.__lastSectionReport);
    reports.push({ ...cfg, report: r });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    console.log(`[Sculpt Section] ${cfg.label}: shape=${r.shape} axis=${r.planeAxis} pieces=${r.pieceCount} A=${r.volumeA.toFixed(0)} B=${r.volumeB.toFixed(0)} total=${r.volumeTotal.toFixed(0)} +bodies=${bodiesNow - bodiesPrev} ms=${r.elapsedMs}`);
    bodiesPrev = bodiesNow;
    await win.waitForTimeout(3000);
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  for (const { report: r } of reports) {
    expect(r.pieceCount).toBeGreaterThanOrEqual(2);
    expect(r.volumeA).toBeGreaterThan(0);
    expect(r.volumeB).toBeGreaterThan(0);
    expect(r.facesA).toBeGreaterThan(0);
    expect(r.facesB).toBeGreaterThan(0);
  }

  await win.waitForTimeout(6000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
