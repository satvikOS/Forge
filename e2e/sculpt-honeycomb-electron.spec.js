import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-38 — Sculpt Honeycomb Panel. HEADED on the Mac Electron shell, with
 * DELIBERATE multi-second pauses between each panel so a viewer watching
 * the Mac Studio remotely (Windows → macOS RDP / Screen Sharing) has time
 * to see each cell pattern render. Four panels laid in a 2×2 grid:
 *   coarse cells / thick wall   |   coarse cells / thin wall
 *   fine cells   / thick wall   |   fine cells   / thin wall
 * Every invocation lands a watertight honeycomb body in the registry.
 *
 * Each operation pauses 3 s after the build for the renderer to settle,
 * and the spec finishes with a 6 s pause before app.close() so all four
 * panels are visible side-by-side in the remote-viewer's final frame.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-honeycomb');
fs.mkdirSync(OUT, { recursive: true });

// Two grids × two wall thicknesses → 4 panels arranged at (±150, ±100, 0) mm.
const PANELS = [
  {
    label: '01-coarse-thick',
    note: 'Coarse cells (s=18 mm), thick walls (2.5 mm)',
    params: { W: 200, H: 150, T: 18, hexSide: 18, wallT: 2.5,
              x: -150, y:  100, z: 0, color: 0xd0b67a },
  },
  {
    label: '02-coarse-thin',
    note: 'Coarse cells (s=18 mm), thin walls (1.0 mm)',
    params: { W: 200, H: 150, T: 18, hexSide: 18, wallT: 1.0,
              x:  150, y:  100, z: 0, color: 0xc4936b },
  },
  {
    label: '03-fine-thick',
    note: 'Fine cells (s=10 mm), thick walls (1.6 mm)',
    params: { W: 200, H: 150, T: 18, hexSide: 10, wallT: 1.6,
              x: -150, y: -100, z: 0, color: 0x7ab6a3 },
  },
  {
    label: '04-fine-thin',
    note: 'Fine cells (s=10 mm), thin walls (0.8 mm)',
    params: { W: 200, H: 150, T: 18, hexSide: 10, wallT: 0.8,
              x:  150, y: -100, z: 0, color: 0x6b8fc4 },
  },
];

test.describe.configure({ timeout: 10 * 60 * 1000 });

test('Sculpt Honeycomb Panel — headed Electron, 4-panel comparison with viewer-friendly pauses', async () => {
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
  // Bring the Electron window to the front so the remote viewer sees it,
  // not whatever was on the Mac's desktop before.
  await win.evaluate(() => {
    try { if (window.focus) window.focus(); } catch { /* best-effort */ }
  });
  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');
  await win.waitForTimeout(2000);                            // viewer-settle: 2 s

  // Frame the 2×2 grid. Panels sit at (±150, ±100, 0) mm = (±0.15, ±0.10, 0) m.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.55, 0.55, 0.70);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  for (const cfg of PANELS) {
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Honeycomb Panel'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Honeycomb Panel"]').first().dispatchEvent('click');
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastHoneycombReport;
        return !!r && r.hexSide === expected.hexSide && r.wallT === expected.wallT;
      },
      { hexSide: cfg.params.hexSide, wallT: cfg.params.wallT },
      { timeout: 5 * 60 * 1000 }
    );
    const report = await win.evaluate(() => window.__lastHoneycombReport);
    reports.push({ ...cfg, report });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    const added = bodiesNow - bodiesPrev;
    bodiesPrev = bodiesNow;
    console.log(`[Sculpt Honeycomb] ${cfg.label} (${cfg.note}): bodies +${added}, report=`,
      JSON.stringify({
        W: report.W, H: report.H, T: report.T,
        hexSide: report.hexSide, wallT: report.wallT,
        cellCount: report.cellCount,
        wallVolumeActual:    +report.wallVolumeActual.toFixed(0),
        wallVolumePredicted: +report.wallVolumePredicted.toFixed(0),
        wallFractionActual:    +(report.wallFractionActual * 100).toFixed(1),
        wallFractionPredicted: +(report.wallFractionPredicted * 100).toFixed(1),
        triCount: report.triCount,
      }, null, 0));
    // Viewer-settle pause: 3 s between each panel so the remote viewer
    // sees the new geometry appear before the next one starts building.
    await win.waitForTimeout(3000);
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [ct, cT, fT2, ft] = reports.map(r => r.report);
  // (ct = coarse-thick, cT = coarse-thin, fT2 = fine-thick, ft = fine-thin)

  // 1. Every panel produced a non-empty watertight solid + triangle count.
  for (const r of [ct, cT, fT2, ft]) {
    expect(r.wallVolumeActual).toBeGreaterThan(0);
    expect(r.triCount).toBeGreaterThan(0);
    expect(r.wallVolumeActual).toBeLessThan(r.slabVolume);
  }

  // 2. Actual wall volume matches the closed-form prediction to ≤ 15 %
  //    relative error (boundary cells clipped at the panel rim cost a
  //    small predictable bit of material vs the interior-only formula).
  for (const r of [ct, cT, fT2, ft]) {
    const rel = Math.abs(r.wallVolumeActual - r.wallVolumePredicted) / r.wallVolumePredicted;
    expect(rel).toBeLessThan(0.15);
  }

  // 3. Wall ordering: thicker wall → more material at the same cell size.
  expect(ct.wallVolumeActual).toBeGreaterThan(cT.wallVolumeActual);
  expect(fT2.wallVolumeActual).toBeGreaterThan(ft.wallVolumeActual);

  // 4. Finer cells → more cells AND more triangles.
  expect(fT2.cellCount).toBeGreaterThan(ct.cellCount);
  expect(fT2.triCount).toBeGreaterThan(ct.triCount);

  // 5. The 4 panels actually landed in the registry.
  const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodiesNow).toBeGreaterThanOrEqual(PANELS.length);

  // Final viewer pause: 6 s so the remote viewer sees the finished 2×2
  // grid stable on screen before the test exits and the window closes.
  await win.waitForTimeout(6000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
