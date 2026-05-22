/**
 * brep-g-nsided-electron.spec.js
 *
 * "Operation in motion" gate for §3.3 N-SIDED PATCHING (G1) — the genuine
 * pure-JS variational N-sided fill.
 *
 * ── MOTION-CAPTURE PATTERN (see brep-g-catmullclark-electron.spec.js) ────────
 * - launchWithCapture() records the workflow as 00-session.webm (slow-mo).
 * - buildPrimitive() builds bodies via the real Part-tab ribbon tools.
 * - clickBody() / addToSelection() — REAL viewport picks.
 * - story.frame(label) drops NN-<label>.png stills at each beat.
 * - dragOrbit() shows the model in 3D with a real drag gesture.
 * Artifacts: test-results/motion/brep-g-nsided/ (00-session.webm + NN-*.png)
 *
 * Artifact: a NOTCHED PLATE — Box A (80×50×24) with a corner notch cut out by
 * Subtracting Box B (28×28×30). The notch turns the plate's top face into an
 * L-shaped SIX-sided face — a genuine non-four-sided opening.
 *
 * Focal op: Surface tab → N-Sided Patch — auto-picks the face with the most
 * edges (the L-shaped 6-sided face), then fills it with a smooth variational
 * surface patch (ear-clip triangulation + discrete cotangent-Laplacian
 * bending-energy fairing, boundary fixed) via ArchDiscKernel.brep.nSidedPatch.
 *
 * Assertions:
 *   - window.__lastNSidedPatch.stats.loopSides >= 5 (a non-4-sided opening).
 *   - a non-degenerate fill mesh: triangleCount > 0, vertexCount > loopSides,
 *     finite bbox spanning a real extent.
 *   - the input notched-plate body STILL EXISTS (N-Sided Patch is additive).
 *   - stills exist and are non-trivial; pageErrors empty; session .webm exists.
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

test('N-Sided Patch: ribbon fills a non-four-sided opening on a notched plate', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-g-nsided');
  try {
    // ── Step 1: Build Box A — the plate blank (80×50×24 mm) ──────────────────
    const plateId = await buildPrimitive(win, 'Box', { dx: 80, dy: 50, dz: 24 });
    console.log(`  Plate blank (Box A) id: ${plateId}`);
    await story.frame('input-plate');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-plate-3d');

    // ── Step 2: Build Box B — the notch cutter (28×28×30 mm) ─────────────────
    const cutterId = await buildPrimitive(win, 'Box', { dx: 28, dy: 28, dz: 30 });
    console.log(`  Notch cutter (Box B) id: ${cutterId}`);
    await story.frame('input-cutter');

    // ── Step 3: Subtract the cutter → a notched plate with a 6-sided face ────
    await clickBody(win, plateId);
    await addToSelection(win, cutterId);
    const idBeforeCut = await win.evaluate(
      () => (window.__lastBrepShape && window.__lastBrepShape.id) || null,
    );
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('before-subtract');
    await clickRibbonTool(win, 'Subtract');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeCut, { timeout: 90000 },
    );
    await win.waitForTimeout(400);
    const notchedId = await win.evaluate(
      () => window.__archdiscRegistry.bodies[window.__archdiscRegistry.bodies.length - 1].id,
    );
    console.log(`  Notched plate id: ${notchedId}`);
    await story.frame('input');
    await dragOrbit(win, { dx: -170, dy: 70 });
    await story.frame('input-3d');

    // ── Step 4: Select the notched plate (REAL viewport click) ───────────────
    await clickBody(win, notchedId);
    await win.evaluate(() => { window.__lastNSidedPatch = null; });

    const bodyCountBefore = await win.evaluate(
      () => window.__archdiscRegistry.bodies.length,
    );

    // ── Step 5: Inject N-Sided Patch params — faceIndex=-1 auto-picks the
    //            face with the most edges (the L-shaped 6-sided opening) ──────
    await injectToolParams(win, 'N-Sided Patch', {
      faceIndex: -1,
      subdivisions: 3,
      fairingIterations: 40,
    });

    // ── Step 6: Run N-Sided Patch from the Surface group (Part tab) ──────────
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('nsided-dialog');
    await clickRibbonTool(win, 'N-Sided Patch');
    await win.waitForTimeout(250);

    // ── Step 7: Wait for __lastNSidedPatch to be populated ───────────────────
    await win.waitForFunction(() => !!window.__lastNSidedPatch, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    await story.frame('after-nsided');
    await dragOrbit(win, { dx: -190, dy: 80 });
    await story.frame('after-nsided-3d');

    // ── Step 8: Verify the fill statistics ───────────────────────────────────
    const stats = await win.evaluate(() => window.__lastNSidedPatch.stats);
    console.log(`  N-Sided Patch stats: loopSides=${stats.loopSides}, ` +
      `wireEdges=${stats.wireEdgeCount}, faceIndex=${stats.faceIndex}/${stats.faceCount}, ` +
      `tris=${stats.triangleCount}, verts=${stats.vertexCount}, ` +
      `subdiv=${stats.subdivisions}, fairing=${stats.fairingIterations}`);

    // The auto-picked boundary loop must be a genuine non-four-sided opening.
    expect(stats.loopSides,
      'the auto-picked opening must be non-four-sided (L-notch → 6 sides)').toBeGreaterThanOrEqual(5);

    // Non-degenerate fill mesh: real triangles and interior vertices.
    expect(stats.triangleCount).toBeGreaterThan(0);
    expect(stats.vertexCount,
      'the fill must have interior vertices, not just the loop corners').toBeGreaterThan(stats.loopSides);

    // Finite bbox spanning a real extent.
    const bbox = stats.bbox;
    expect(bbox).toBeTruthy();
    for (const c of [0, 1, 2]) {
      expect(Number.isFinite(bbox.min[c])).toBe(true);
      expect(Number.isFinite(bbox.max[c])).toBe(true);
    }
    const dx = bbox.max[0] - bbox.min[0];
    const dy = bbox.max[1] - bbox.min[1];
    const dz = bbox.max[2] - bbox.min[2];
    const diag = Math.hypot(dx, dy, dz);
    console.log(`  Fill bbox extent: dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}, ` +
      `dz=${dz.toFixed(2)}, diag=${diag.toFixed(2)} mm`);
    expect(diag, 'the fill is a real surface, not a degenerate point').toBeGreaterThan(1);

    // ── Step 9: the input notched-plate body STILL EXISTS (additive op) ──────
    const plateStillThere = await win.evaluate((id) => {
      const reg = window.__archdiscRegistry;
      return !!(reg && reg.bodies && reg.bodies.some(b => b.id === id));
    }, notchedId);
    expect(plateStillThere, 'the notched-plate body must survive N-Sided Patch').toBe(true);

    const bodyCountAfter = await win.evaluate(
      () => window.__archdiscRegistry.bodies.length,
    );
    console.log(`  Registry bodies: ${bodyCountBefore} → ${bodyCountAfter} (fill patch added)`);
    expect(bodyCountAfter,
      'the scene gained the N-sided fill patch body').toBeGreaterThan(bodyCountBefore);

    // ── Step 10: Multi-angle render via REAL drag-orbits — no blank frames ───
    const cap = await captureAllAngles(win, 'nsided-notched-plate', {
      azimuths:   [0, 90, 180, 270],
      elevations: [-30, 30],
      zooms:      [0.7, 1.4],
      story,
    });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Step 11: Verify the storyboard stills exist and are non-trivial ──────
    const stills = story.frames();
    const inputStill  = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-nsided\.png$/.test(f));
    expect(inputStill,  'an input still must exist').toBeTruthy();
    expect(outputStill, 'an after-nsided still must exist').toBeTruthy();
    expect(fs.statSync(inputStill).size).toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size).toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
