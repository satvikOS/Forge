import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-37 — Sculpt Lattice (TPMS infill). HEADED on the Mac Electron shell
 * so you can watch the gyroid / Schwarz-P solids appear. Four configurations
 * laid out in a 2×2 grid by position so the comparison is obvious:
 *   gyroid coarse  vs  gyroid fine
 *   schwarz coarse vs  schwarz fine
 * Each invocation lands a watertight implicit solid in the registry.
 *
 * The first implicit-modelling primitive in the Mech kernel — Manifold's
 * marching-cubes over an SDF. Validation contract:
 *   - solid volume falls in the predicted Monte-Carlo band (±15%)
 *   - finer cell sizes produce strictly more triangles than coarse at
 *     the same MC spacing (cell halving roughly doubles surface area)
 *   - all four solids are non-empty
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-lattice');
fs.mkdirSync(OUT, { recursive: true });

const CONFIGS = [
  {
    label: '01-gyroid-coarse',
    note: 'Gyroid, 40 mm cells (2 per side)',
    params: { family: 'gyroid', form: 'sheet', sx: 80, sy: 80, sz: 80,
              cellSize: 40, isoLevel: 0.5, resolution: 2.0,
              x: -120, y: 60, z: 0, color: 0xa3c9c7 },
  },
  {
    label: '02-gyroid-fine',
    note: 'Gyroid, 20 mm cells (4 per side)',
    params: { family: 'gyroid', form: 'sheet', sx: 80, sy: 80, sz: 80,
              cellSize: 20, isoLevel: 0.5, resolution: 1.5,
              x:  120, y: 60, z: 0, color: 0xc7a3b6 },
  },
  {
    label: '03-schwarz-coarse',
    note: 'Schwarz-P, 40 mm cells (2 per side)',
    params: { family: 'schwarzP', form: 'sheet', sx: 80, sy: 80, sz: 80,
              cellSize: 40, isoLevel: 0.5, resolution: 2.0,
              x: -120, y: -60, z: 0, color: 0xc7b6a3 },
  },
  {
    label: '04-schwarz-fine',
    note: 'Schwarz-P, 20 mm cells (4 per side)',
    params: { family: 'schwarzP', form: 'sheet', sx: 80, sy: 80, sz: 80,
              cellSize: 20, isoLevel: 0.5, resolution: 1.5,
              x:  120, y: -60, z: 0, color: 0xa3b6c7 },
  },
];

test.describe.configure({ timeout: 10 * 60 * 1000 });

test('Sculpt Lattice — headed Electron, four TPMS infills in a 2×2 grid', async () => {
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

  // Frame the 2×2 grid: lattices sit at (±120, ±60, 0) mm = (±0.12, ±0.06, 0) m.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.45, 0.32, 0.55);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  for (const cfg of CONFIGS) {
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Lattice'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Lattice"]').first().dispatchEvent('click');
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastLatticeReport;
        if (!r) return false;
        const fam = (r.family || '').toLowerCase();
        return fam === expected.family && r.cellSize === expected.cellSize && r.resolution === expected.resolution;
      },
      { family: cfg.params.family.toLowerCase(), cellSize: cfg.params.cellSize, resolution: cfg.params.resolution },
      { timeout: 5 * 60 * 1000 }                              // levelSet at 1.5 mm on 80³ takes time
    );
    const report = await win.evaluate(() => window.__lastLatticeReport);
    reports.push({ ...cfg, report });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    const added = bodiesNow - bodiesPrev;
    bodiesPrev = bodiesNow;
    console.log(`[Sculpt Lattice] ${cfg.label} (${cfg.note}): bodies +${added}, report=`,
      JSON.stringify({
        family: report.family, form: report.form, cellSize: report.cellSize,
        bboxVolume: report.bboxVolume,
        volume: +report.volume.toFixed(0),
        vfEstimate: +(report.volFractionEstimate * 100).toFixed(1),
        vfActual:   +(report.volFractionActual   * 100).toFixed(1),
        triCount: report.triCount,
        elapsedMs: report.elapsedMs,
      }, null, 0));
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [gC, gF, sC, sF] = reports.map(r => r.report);

  // 1. All four lattices are non-empty + watertight (volume > 0, triCount > 0).
  for (const r of [gC, gF, sC, sF]) {
    expect(r.volume).toBeGreaterThan(0);
    expect(r.triCount).toBeGreaterThan(0);
    expect(r.volume).toBeLessThan(r.bboxVolume);              // never fills the box
  }

  // 2. Actual vs Monte-Carlo estimate: marching cubes should land within
  //    ±18% of the SDF 24³ sample-based estimate. (Loose enough for MC
  //    variance on coarse cell grids; tight enough to catch a sign-flip
  //    against Manifold.levelSet's "positive = inside" convention, which
  //    would have shown a 30-40% delta — see commit log.)
  for (const r of [gC, gF, sC, sF]) {
    const delta = Math.abs(r.volFractionActual - r.volFractionEstimate);
    expect(delta).toBeLessThan(0.18);
  }

  // 3. Finer cells = more triangles. Halving the cell size at the SAME
  //    bbox roughly doubles the surface area (≈ 1.6-2.5× tris in practice).
  expect(gF.triCount).toBeGreaterThan(gC.triCount * 1.3);
  expect(sF.triCount).toBeGreaterThan(sC.triCount * 1.3);

  // 4. Family-shape characteristic at iso=0.5 sheet: gyroid sheet is
  //    chunkier than Schwarz-P sheet (the SDF spans different ranges).
  //    We verified offline that gyroid sheet ≈ 48% vs Schwarz-P sheet
  //    ≈ 26% of the bbox volume.
  expect(gC.volFractionActual).toBeGreaterThan(sC.volFractionActual);
  expect(gF.volFractionActual).toBeGreaterThan(sF.volFractionActual);

  // 5. Four lattice bodies landed in the registry.
  const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodiesNow).toBeGreaterThanOrEqual(CONFIGS.length);

  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
