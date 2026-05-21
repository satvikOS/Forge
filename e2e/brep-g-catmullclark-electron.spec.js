/**
 * brep-g-catmullclark-electron.spec.js
 *
 * Real-world-artifact test for Catmull-Clark subdivision on a rounded bracket
 * plate (Box + Fillet). Drives everything via real ribbon clicks + dialogs.
 *
 * Artifact: rounded bracket plate (Box 40×40×40, Fillet r=2 mm).
 * Focal op: Part tab → Catmull-Clark Subdivide (levels=2, dihedralDeg=30, quadAngleDeg=5).
 *
 * Assertions:
 *   - refinedQuads > 0 (mesh was produced)
 *   - refinedQuads > baseQuads × 4 (2 CC steps = ×16 theory; ×4 is the conservative floor)
 *   - bbox dx/dy/dz > 35 mm (CC with creases preserves the 40 mm envelope minus fillet pull-in)
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

// ─── Main gate test ───────────────────────────────────────────────────────────

test('Catmull-Clark Subdivide: clicking ribbon refines a real-world artifact (rounded plate)', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    // ── Step 1: Build Box (40×40×40 default) ─────────────────────────────────
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // ── Step 2: Select box body and apply Fillet (r=2 mm) ────────────────────
    await selectBodies(win, [boxId]);
    const idBeforeFillet = await win.evaluate(
      () => (window.__lastBrepShape && window.__lastBrepShape.id) || null,
    );
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);

    // Inject fillet params before clicking.
    await win.evaluate(() => {
      if (!window.__archdiscPlanParams) window.__archdiscPlanParams = {};
      window.__archdiscPlanParams['Fillet'] = { radius: 2 };
    });
    await clickRibbonTool(win, 'Fillet');

    // Wait for __lastBrepShape to change (fillet completed).
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet,
      { timeout: 60000 },
    );
    const filletedId = await win.evaluate(
      () => window.__archdiscRegistry && window.__archdiscRegistry.bodies
        ? window.__archdiscRegistry.bodies[window.__archdiscRegistry.bodies.length - 1].id
        : window.__lastBrepShape.id,
    );
    console.log(`  Filleted box id: ${filletedId}`);

    // ── Step 3: Run Catmull-Clark Subdivide on the filleted body ─────────────
    await selectBodies(win, [filletedId]);
    await win.evaluate(() => { window.__lastCatmullClarkMesh = null; });

    // Inject CC params before clicking (Playwright navigator.webdriver bypass).
    await injectToolParams(win, 'Catmull-Clark Subdivide', {
      levels: 2,
      dihedralDeg: 30,
      quadAngleDeg: 5,
    });

    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Catmull-Clark Subdivide');

    // ── Step 4: Wait for __lastCatmullClarkMesh ───────────────────────────────
    await win.waitForFunction(() => !!window.__lastCatmullClarkMesh, null, { timeout: 120000 });

    // ── Step 5: Quad-count growth assertions ──────────────────────────────────
    const stats = await win.evaluate(() => window.__lastCatmullClarkMesh.stats);
    console.log(`  CC stats: baseQuads=${stats.baseQuads}, refinedQuads=${stats.refinedQuads}, ` +
      `refinedVerts=${stats.refinedVerts}, creaseEdges=${stats.creaseEdges}, ` +
      `pairedQuads=${stats.pairedQuads}, degenerateQuads=${stats.degenerateQuads}`);

    // After 2 CC steps the quad count grows ×16 in theory; ×4 is the minimum
    // acceptable floor (1 step minimum already quadruples).
    expect(stats.refinedQuads).toBeGreaterThan(0);
    expect(stats.refinedQuads).toBeGreaterThan(stats.baseQuads * 4);

    // ── Step 6: Bbox preservation ────────────────────────────────────────────
    // CC with creases keeps the outer envelope: Box=40 mm, fillet r=2 → ~36 mm
    // effective smooth extent. With crease edges on the cube boundaries the
    // subdivided mesh should still span ≥35 mm in every axis.
    const bbox = await win.evaluate(() => {
      const p = window.__lastCatmullClarkMesh.positions;
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
    console.log(`  Post-CC bbox: dx=${bbox.dx.toFixed(3)}, dy=${bbox.dy.toFixed(3)}, dz=${bbox.dz.toFixed(3)}`);

    // Bbox preservation: the rounded bracket plate must span ≥35 mm per axis.
    expect(bbox.dx).toBeGreaterThan(35);
    expect(bbox.dy).toBeGreaterThan(35);
    expect(bbox.dz).toBeGreaterThan(35);

    // ── Step 7: Multi-angle render — no blank frames, no page errors ──────────
    const cap = await captureAllAngles(win, 'catmull-clark', {
      azimuths:   [0, 60, 120, 180, 240, 300],
      elevations: [-30, 30],
      zooms:      [0.6, 1.0, 1.8],
    });
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
