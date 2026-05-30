import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-44 — Sculpt Pocket Toolpath. HEADED on the Mac Electron shell.
 * Three pocket configurations of escalating size laid in a row so the
 * viewer sees the concentric clearing pattern at multiple scales:
 *
 *   small   60 × 40 × 4 mm, Ø6 tool
 *   medium 100 × 70 × 6 mm, Ø8 tool
 *   large  150 ×100 × 8 mm, Ø10 tool
 *
 * Each toolpath swept as a thin orange tube so the inset-rectangle
 * pattern reads clearly in the viewport. Viewer-friendly pauses
 * (3 s between, 6 s final) for remote viewing.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-pocket');
fs.mkdirSync(OUT, { recursive: true });

const POCKETS = [
  {
    label: '01-small',
    note: 'Small pocket 60×40×4 mm, Ø6 tool',
    params: { pocketW: 60, pocketH: 40, pocketDepth: 4, toolDiaMm: 6,
              stepoverMm: 3, depthPerPassMm: 2, feedMmPerMin: 800,
              tubeR: 0.5, x: -180, y: 0, z: 0, color: 0xff6b3d },
  },
  {
    label: '02-medium',
    note: 'Medium pocket 100×70×6 mm, Ø8 tool',
    params: { pocketW: 100, pocketH: 70, pocketDepth: 6, toolDiaMm: 8,
              stepoverMm: 4, depthPerPassMm: 2, feedMmPerMin: 1000,
              tubeR: 0.6, x: 0, y: 0, z: 0, color: 0xff9c3d },
  },
  {
    label: '03-large',
    note: 'Large pocket 150×100×8 mm, Ø10 tool',
    params: { pocketW: 150, pocketH: 100, pocketDepth: 8, toolDiaMm: 10,
              stepoverMm: 5, depthPerPassMm: 2, feedMmPerMin: 1200,
              tubeR: 0.7, x: 200, y: 0, z: 0, color: 0xffd13d },
  },
];

test.describe.configure({ timeout: 10 * 60 * 1000 });

test('Sculpt Pocket Toolpath — headed Electron, 3 pocket sizes', async () => {
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

  // Frame the row of three pockets at (-180, 0, +200) mm. Look top-down
  // so the concentric-rectangle pattern is most visible.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.05, 0.55, 0.50);
    vp.orbitControls.target.set(0.05, 0, 0);
    vp.camera.lookAt(0.05, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  for (const cfg of POCKETS) {
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Pocket Toolpath'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Pocket Toolpath"]').first().dispatchEvent('click');
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastPocketReport;
        return !!r && r.pocketW === expected.W && r.toolDiaMm === expected.toolDiaMm;
      },
      { W: cfg.params.pocketW, toolDiaMm: cfg.params.toolDiaMm },
      { timeout: 2 * 60 * 1000 }
    );
    const report = await win.evaluate(() => window.__lastPocketReport);
    reports.push({ ...cfg, report });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    const added = bodiesNow - bodiesPrev;
    bodiesPrev = bodiesNow;
    console.log(`[Sculpt Pocket] ${cfg.label} (${cfg.note}): bodies +${added}, report=`,
      JSON.stringify({
        pocketW: report.pocketW, pocketH: report.pocketH, pocketDepth: report.pocketDepth,
        toolDiaMm: report.toolDiaMm, stepoverMm: report.stepoverMm,
        ringCount: report.ringCount, zPasses: report.zPasses,
        waypointCount: report.waypointCount,
        pathLengthMm: +report.pathLengthMm.toFixed(1),
        cycleMinutes: +report.cycleMinutes.toFixed(2),
        triCount: report.triCount,
      }, null, 0));
    await win.waitForTimeout(3000);                                  // viewer pause
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [small, medium, large] = reports.map(r => r.report);

  // 1. Every toolpath is a non-empty swept body.
  for (const r of [small, medium, large]) {
    expect(r.waypointCount).toBeGreaterThan(0);
    expect(r.pathLengthMm).toBeGreaterThan(0);
    expect(r.triCount).toBeGreaterThan(0);
  }

  // 2. The path length grows with pocket area + depth: small < medium < large.
  expect(medium.pathLengthMm).toBeGreaterThan(small.pathLengthMm);
  expect(large.pathLengthMm).toBeGreaterThan(medium.pathLengthMm);

  // 3. Ring count grows with the SMALLEST dimension / stepover. For
  //    these configs:
  //      small:  40 mm / 3 mm stepover  → ~6 rings
  //      medium: 70 mm / 4 mm stepover  → ~9 rings
  //      large:  100 mm / 5 mm stepover → ~10 rings
  expect(small.ringCount).toBeGreaterThanOrEqual(4);
  expect(medium.ringCount).toBeGreaterThan(small.ringCount);
  expect(large.ringCount).toBeGreaterThanOrEqual(medium.ringCount);

  // 4. Z-pass count = ceil(depth / depthPerPass).
  expect(small.zPasses).toBe(Math.ceil(small.pocketDepth / small.depthPerPassMm));
  expect(medium.zPasses).toBe(Math.ceil(medium.pocketDepth / medium.depthPerPassMm));
  expect(large.zPasses).toBe(Math.ceil(large.pocketDepth / large.depthPerPassMm));

  // 5. Cycle-time estimate is positive and finite (path length / feedrate).
  for (const r of [small, medium, large]) {
    expect(r.cycleMinutes).toBeGreaterThan(0);
    expect(Number.isFinite(r.cycleMinutes)).toBe(true);
  }

  // 6. Three bodies landed.
  const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodiesNow).toBeGreaterThanOrEqual(POCKETS.length);

  await win.waitForTimeout(6000);                                    // final viewer pause
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
