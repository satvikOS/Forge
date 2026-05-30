import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-flange');
fs.mkdirSync(OUT, { recursive: true });

const FLANGES = [
  { label: '01-4h',  params: { outerR: 35, thickness: 8,  holeR: 3,   holeCount: 4,  boltCircleR: 25, x: -120, y: 0, z: 0, color: 0x8a9a6b } },
  { label: '02-6h',  params: { outerR: 45, thickness: 10, holeR: 3.5, holeCount: 6,  boltCircleR: 32, x:    0, y: 0, z: 0, color: 0x9a6b8a } },
  { label: '03-12h', params: { outerR: 55, thickness: 10, holeR: 3,   holeCount: 12, boltCircleR: 42, x:  120, y: 0, z: 0, color: 0x6b8a9a } },
];

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Drilled Flange — OCCT bolt-circle pattern', async () => {
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
    vp.camera.position.set(0.05, 0.35, 0.30);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  for (let i = 0; i < FLANGES.length; i++) {
    const cfg = FLANGES[i];
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Drilled Flange'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Drilled Flange"]').first().dispatchEvent('click');
    const tmax = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction(
      (expected) => { const r = window.__lastFlangeReport; return !!r && r.holeCount === expected.holeCount && r.outerR === expected.outerR; },
      { holeCount: cfg.params.holeCount, outerR: cfg.params.outerR }, { timeout: tmax }
    );
    const r = await win.evaluate(() => window.__lastFlangeReport);
    reports.push({ ...cfg, report: r });
    console.log(`[Sculpt Flange] ${cfg.label}: R=${r.outerR} t=${r.thickness} N=${r.holeCount} BC=${r.boltCircleR} predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount} ms=${r.elapsedMs}`);
    await win.waitForTimeout(2500);
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  for (const { report: r } of reports) {
    expect(r.actualVolume).toBeGreaterThan(0);
    expect(r.relError).toBeLessThan(0.005);
    // Outer cyl (2 caps + lateral) + N hole sides = 3 + N faces minimum.
    expect(r.faceCount).toBeGreaterThanOrEqual(3 + r.holeCount);
  }
  // More holes ⇒ less material at fixed dimensions, but the test grows
  // the outer radius so we just check each volume is reasonable.

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
