/**
 * brep-g-ssi-electron.spec.js
 *
 * "Operation in motion" test for NURBS Surface-Surface Intersection (SSI):
 * a cylinder piercing a box. Drives everything via real ribbon clicks + dialogs.
 *
 * ── MOTION-CAPTURE PATTERN (see brep-g-catmullclark-electron.spec.js) ────────
 * - launchWithCapture() records the whole workflow as a .webm video.
 * - clickBody() — REAL viewport mouse click — selects bodies (replaces selectBodies).
 * - addToSelection() adds the second body (viewport click handler has no modifier
 *   branch; selectMany is used internally, same as Body Browser).
 * - story.frame(label) drops NN-<label>.png stills at each meaningful beat.
 * - dragOrbit() shows the model in 3D with real drag gestures.
 * - captureAllAngles() does real drag-orbits for the closing orbit sweep.
 * Artifacts: test-results/motion/brep-g-ssi/ (00-session.webm + NN-*.png)
 *
 * Artifact: Box (40×40×40) + Cylinder (r=20, h=40) piercing the box.
 * Focal op: Part tab → Surface-Surface Intersection (samples=64, tolerance=1e-6, lineWidth=2).
 *
 * Assertions (all original ones kept — video/stills are ADDITIVE):
 *   - stats.nbLines >= 1     (at least one intersection curve produced)
 *   - stats.totalPoints > 8  (sampled points exist)
 *   - curveCount === stats.nbLines
 *   - captureAllAngles blanks empty, pageErrors empty
 *   - NEW: the 'input' still and the 'after-ssi' still both exist
 *     and are non-trivial in size (> 1 KB).
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  buildPrimitive, clickRibbonTab, clickRibbonTool, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, addToSelection, dragOrbit,
} from './helpers/motionCapture.js';
import { captureAllAngles } from './helpers/orbitCapture.js';

test.setTimeout(600000);

// ─── Main gate test ───────────────────────────────────────────────────────────

test('NURBS SSI: piercing cylinder x box via ribbon produces real intersection curves', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-g-ssi');
  try {
    // ── Step 1: Build Box (40×40×40 default) ─────────────────────────────────
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // ── Step 2: Build Cylinder (r=20 h=40 default) ───────────────────────────
    const cylId = await buildPrimitive(win, 'Cylinder');
    console.log(`  Cylinder id: ${cylId}`);

    // Key-frame: both bodies in scene; real drag-orbit to show them in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // ── Step 3: Select both bodies (REAL viewport clicks) ────────────────────
    // First body: real viewport click.
    await clickBody(win, boxId);
    // Second body: addToSelection uses a visible cursor travel + selectMany
    // (the viewport click handler has no modifier branch — verdict D).
    await addToSelection(win, cylId);

    // ── Step 4: Clear __lastSSI before triggering the tool ───────────────────
    await win.evaluate(() => { window.__lastSSI = null; });

    // ── Step 5: Inject SSI params (Playwright webdriver bypass) ─────────────
    await injectToolParams(win, 'Surface-Surface Intersection', {
      samples: 64,
      tolerance: 1e-6,
      lineWidth: 2,
    });

    // ── Step 6: Click Surface-Surface Intersection on the Part tab ──────────
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('ssi-dialog');
    await clickRibbonTool(win, 'Surface-Surface Intersection');

    // ── Step 7: Wait for __lastSSI to be populated ───────────────────────────
    await win.waitForFunction(() => !!window.__lastSSI, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    await story.frame('after-ssi');

    // Drag-orbit to reveal the intersection curves in 3D.
    await dragOrbit(win, { dx: -180, dy: 80 });
    await story.frame('after-ssi-3d');

    // ── Step 8: Verify intersection statistics ───────────────────────────────
    const stats = await win.evaluate(() => window.__lastSSI.stats);
    console.log(`  SSI stats: nbLines=${stats.nbLines}, totalPoints=${stats.totalPoints}, totalLength=${stats.totalLength.toFixed(3)}`);

    expect(stats.nbLines).toBeGreaterThanOrEqual(1);
    expect(stats.totalPoints).toBeGreaterThan(8);

    // ── Step 9: Verify curves array integrity ────────────────────────────────
    const curveCount = await win.evaluate(() => window.__lastSSI.curves.length);
    expect(curveCount).toEqual(stats.nbLines);

    // ── Step 10: Multi-angle render via REAL drag-orbits — no blank frames ───
    const cap = await captureAllAngles(win, 'ssi-box-cyl', {
      azimuths:   [0, 60, 120, 180, 240, 300],
      elevations: [-30, 30],
      zooms:      [0.6, 1.0, 1.8],
      story,
    });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Step 11: Verify the storyboard stills exist and are non-trivial ──────
    const stills = story.frames();
    const inputStill   = stills.find(f => /-input\.png$/.test(f));
    const outputStill  = stills.find(f => /-after-ssi\.png$/.test(f));
    expect(inputStill,  'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-ssi still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-ssi still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    // The session video must exist and be non-trivial.
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
