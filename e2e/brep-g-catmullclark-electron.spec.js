/**
 * brep-g-catmullclark-electron.spec.js
 *
 * Real-world-artifact test for Catmull-Clark subdivision on a rounded bracket
 * plate (Box + Fillet). Drives everything via real ribbon clicks + dialogs.
 *
 * ── REFERENCE PATTERN for the "operation in motion" retrofit ────────────────
 * This spec is the template every later retrofit copies. It uses
 * e2e/helpers/motionCapture.js so the workflow is recorded as a .webm video
 * and key-frame stills are dropped at each meaningful beat:
 *   - launchWithCapture() replaces the local launch() (slow-mo video).
 *   - clickBody() — REAL viewport mouse click — replaces selectBodies().
 *   - story.frame(label) drops NN-<label>.png stills (input / dialog / after).
 *   - dragOrbit() shows the model in 3D with a real drag.
 *   - captureAllAngles() does real drag-orbits (no programmatic camera jumps).
 * Artifacts: test-results/motion/brep-g-catmullclark/  (00-session.webm + NN-*.png)
 *
 * Artifact: rounded bracket plate (Box 40×40×40, Fillet r=2 mm).
 * Focal op: Part tab → Catmull-Clark Subdivide (levels=2, dihedralDeg=30, quadAngleDeg=5).
 *
 * Assertions (all original ones kept — video/stills are ADDITIVE):
 *   - refinedQuads > 0 (mesh was produced)
 *   - refinedQuads > baseQuads × 4 (2 CC steps = ×16 theory; ×4 is the floor)
 *   - bbox dx/dy/dz > 35 mm (CC with creases preserves the 40 mm envelope)
 *   - captureAllAngles blanks empty, pageErrors empty
 *   - NEW: the 'input' still and the 'after-catmullclark' still both exist
 *     and are non-trivial in size.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  clickRibbonTab, clickRibbonTool, buildPrimitive, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, dragOrbit,
} from './helpers/motionCapture.js';
import { captureAllAngles } from './helpers/orbitCapture.js';

test.setTimeout(600000);

// ─── Main gate test ───────────────────────────────────────────────────────────

test('Catmull-Clark Subdivide: clicking ribbon refines a real-world artifact (rounded plate)', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-g-catmullclark');
  try {
    // ── Step 1: Build Box (40×40×40 default) ─────────────────────────────────
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);
    // Key-frame: the plain input box, then a real drag-orbit to show it in 3D.
    await story.frame('input-box');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-box-3d');

    // ── Step 2: Select box body (REAL viewport click) and apply Fillet ───────
    await clickBody(win, boxId);
    const idBeforeFillet = await win.evaluate(
      () => (window.__lastBrepShape && window.__lastBrepShape.id) || null,
    );
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);

    // Inject fillet params, then click the ribbon tool.
    await injectToolParams(win, 'Fillet', { radius: 2 });
    await story.frame('before-fillet');
    await clickRibbonTool(win, 'Fillet');
    // The Fillet param dialog opens (bypassed under Playwright, but the
    // ribbon state is captured as the "dialog" beat for the storyboard).
    await win.waitForTimeout(250);
    await story.frame('fillet-dialog');

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
    await win.waitForTimeout(300);
    await story.frame('after-fillet');

    // ── Step 3: Run Catmull-Clark Subdivide on the filleted body ─────────────
    // Select the filleted body with a REAL viewport click.
    await clickBody(win, filletedId);
    await win.evaluate(() => { window.__lastCatmullClarkMesh = null; });

    // Inject CC params before clicking (Playwright navigator.webdriver bypass).
    await injectToolParams(win, 'Catmull-Clark Subdivide', {
      levels: 2,
      dihedralDeg: 30,
      quadAngleDeg: 5,
    });

    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('before-catmullclark');
    await clickRibbonTool(win, 'Catmull-Clark Subdivide');
    await win.waitForTimeout(250);
    await story.frame('catmullclark-dialog');

    // ── Step 4: Wait for __lastCatmullClarkMesh ───────────────────────────────
    await win.waitForFunction(() => !!window.__lastCatmullClarkMesh, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    await story.frame('after-catmullclark');

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

    // ── Step 7: Multi-angle render via REAL drag-orbits — no blank frames ─────
    const cap = await captureAllAngles(win, 'catmull-clark', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Step 8: Verify the storyboard stills exist and are non-trivial ───────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input-box\.png$/.test(f));
    const outputStill = stills.find(f => /-after-catmullclark\.png$/.test(f));
    expect(inputStill, 'an input-box still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-catmullclark still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>10 KB)').toBeGreaterThan(10 * 1024);
    expect(fs.statSync(outputStill).size,
      'after-catmullclark still must be a real screenshot (>10 KB)').toBeGreaterThan(10 * 1024);
  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    // The session video must exist and be non-trivial.
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
