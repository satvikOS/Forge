/**
 * retopo-surface-electron.spec.js
 *
 * Sub-project D e2e gate — real-world artifact retopology.
 *
 * Artifact: rounded bracket plate (Box → Fillet, r=2 mm).
 * Op: Part tab → Retopo Surface (targetEdgeLength=0 auto, iterations=5).
 *
 * Assertions:
 *   - retopoTris > 0, retopoVerts > 0 (mesh produced)
 *   - Bounding box of retopo'd mesh ≈ input fillet bbox (within ~5 mm per axis)
 *   - captureAllAngles blanks empty, pageErrors empty
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, selectBodies, injectToolParams,
} from './helpers/uiWorkflow.js';

test.setTimeout(600000);

async function launch() {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });
  return { app, win, pageErrors };
}

// ─── Main gate test ──────────────────────────────────────────────────────────

test('Retopo Surface: clicking ribbon retopologises a real-world artifact (rounded plate)', async () => {
  // Artifact: rounded bracket plate — Box(40³) → Fillet(r=2) → isotropic retopo.
  const { app, win, pageErrors } = await launch();
  try {
    // ── Step 1: Build Box (40×40×40 mm³ — rounded plate blank) ──────────────
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box built: id=${boxId}`);

    // ── Step 2: Apply Fillet (r=2) via ribbon to produce rounded bracket plate ─
    const idBeforeFillet = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id);
    await selectBodies(win, [boxId]);
    await injectToolParams(win, 'Fillet', { radius: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Fillet');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet,
      { timeout: 60000 },
    );
    const filletedId = await win.evaluate(() => window.__lastBrepShape.id);
    console.log(`  Fillet applied: id=${filletedId}`);

    // ── Step 3: Measure the filleted plate bbox for preservation assertions ──
    const filletedStats = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape));
    const fBBox = filletedStats.boundingBox;
    const fDx = fBBox.max[0] - fBBox.min[0];
    const fDy = fBBox.max[1] - fBBox.min[1];
    const fDz = fBBox.max[2] - fBBox.min[2];
    console.log(`  Filleted plate bbox: dx=${fDx.toFixed(2)}, dy=${fDy.toFixed(2)}, dz=${fDz.toFixed(2)}`);

    // ── Step 4: Retopo the filleted plate ─────────────────────────────────────
    await selectBodies(win, [filletedId]);
    await win.evaluate(() => { window.__lastRetopoMesh = null; });
    await injectToolParams(win, 'Retopo Surface', { targetEdgeLength: 0, iterations: 5 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Retopo Surface');

    // Wait for the retopo operation to complete (can take up to 2 min).
    await win.waitForFunction(() => !!window.__lastRetopoMesh, null, { timeout: 120000 });

    // ── Step 5: Mesh validity assertions ─────────────────────────────────────
    const r = await win.evaluate(() => window.__lastRetopoMesh.stats);
    console.log(`  Retopo stats: baseTris=${r.baseTris}, retopoTris=${r.retopoTris}, retopoVerts=${r.retopoVerts}, weldedVerts=${r.weldedVerts}`);

    expect(r.retopoTris).toBeGreaterThan(0);
    expect(r.retopoVerts).toBeGreaterThan(0);

    // ── Step 6: Bounding-box preservation (within ~5 mm per axis) ──────────
    // Tangential relaxation may drift vertices slightly, but the outer envelope
    // of a closed mesh should be preserved to within a few mm.
    const bbox = await win.evaluate(() => {
      const p = window.__lastRetopoMesh.positions;
      const mn = [Infinity, Infinity, Infinity];
      const mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          if (p[i + a] < mn[a]) mn[a] = p[i + a];
          if (p[i + a] > mx[a]) mx[a] = p[i + a];
        }
      }
      return { dx: mx[0] - mn[0], dy: mx[1] - mn[1], dz: mx[2] - mn[2] };
    });
    console.log(`  Retopo bbox: dx=${bbox.dx.toFixed(2)}, dy=${bbox.dy.toFixed(2)}, dz=${bbox.dz.toFixed(2)}`);

    // Retopo'd mesh must span at least (inputDim - 5 mm) per axis.
    expect(bbox.dx).toBeGreaterThan(fDx - 5);
    expect(bbox.dy).toBeGreaterThan(fDy - 5);
    expect(bbox.dz).toBeGreaterThan(fDz - 5);

    // ── Step 7: All-angles capture ────────────────────────────────────────────
    const cap = await captureAllAngles(win, 'retopo', {
      azimuths: [0, 60, 120, 180, 240, 300],
      elevations: [-30, 30],
      zooms: [0.6, 1.0, 1.8],
    });
    console.log(`  Captured ${cap.total} angles, blanks: ${cap.blanks.length}`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
