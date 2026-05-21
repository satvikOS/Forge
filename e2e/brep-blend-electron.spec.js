/**
 * brep-blend-electron.spec.js
 *
 * "Operation in motion" retrofit — hard-blending operations on real engineering artifacts.
 * Drives everything via real ribbon clicks, REAL viewport body clicks, and drag-orbits.
 * Records the whole workflow as a .webm video with key-frame stills at each beat.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ─────────────────────
 *
 * ONE consolidated test runs three blend workflows in sequence inside a single
 * launchWithCapture session (one video, one storyboard). This avoids the
 * Playwright Electron recordVideo teardown race that silently drops stills when
 * multiple test() blocks share a worker.
 *
 * Workflow A — Face Fillet (G2 blend, arity-0):
 *   Artifact: smooth fairing patch (C2 fill face) — no input body needed
 *
 * Workflow B — Full Round Fillet (cliff blend, arity-1):
 *   Artifact: softened keycap (cliff blend)
 *   Extrude Boss (80×50×25 mm) → select → Full Round Fillet r=8
 *
 * Workflow C — Corner Mitre (arity-1):
 *   Artifact: mitred die (cube with rounded corners)
 *   Box (40³) → select → Corner Mitre r=3
 *
 * Assertions (all original ones kept — video/stills are ADDITIVE):
 *   - Face Fillet area in (20, 70) mm²
 *   - Full Round Fillet: volume < pre, faceCount > 6
 *   - Corner Mitre: volume < pre, faceCount ≥ 20
 *   - stills: 'input-b' and 'after-cornermitre' both exist and > 1 KB
 *
 * Artifacts land in:  test-results/motion/brep-blend/
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

// ─── Single consolidated test ─────────────────────────────────────────────────

test('Blend ops: Face Fillet (fairing patch) + Full Round Fillet (keycap) + Corner Mitre (mitred die) — geometry preserved', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-blend');
  try {

    // ══════════════════════════════════════════════════════════════════════════
    // Workflow A — Face Fillet (G2 blend, arity-0)
    // No input body selection needed. The op creates a G2/C2 fill face on its
    // own 6mm internal wire boundary.
    // ══════════════════════════════════════════════════════════════════════════

    // Key-frame: empty scene before the arity-0 op.
    await story.frame('before-facefillet');

    const idBeforeA = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    await injectToolParams(win, 'Face Fillet', { holeBoxSize: 6 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('facefillet-dialog');
    await clickRibbonTool(win, 'Face Fillet');

    // Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeA,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-facefillet');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('after-facefillet-3d');

    // Measure + assert Face Fillet.
    const mA = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  [A] Face Fillet (fairing patch): area=${mA.area?.toFixed(1)}, faces=${mA.faceCount}`);
    // G2 fill on 6mm box wire: area ≈ 36 mm² ±35% (curvature variation in C2 surface).
    expect(mA.area).toBeGreaterThan(20);
    expect(mA.area).toBeLessThan(70);
    expect(mA.faceCount).toBeGreaterThanOrEqual(1);


    // ══════════════════════════════════════════════════════════════════════════
    // Workflow B — Full Round Fillet (cliff blend, arity-1)
    // Extrude Boss (80×50×25 mm) → select → Full Round Fillet r=8
    // ══════════════════════════════════════════════════════════════════════════

    // Step B1: Build the keycap blank (Extrude Boss, 80×50×25 mm, arity-0).
    const beamId = await buildPrimitive(win, 'Extrude Boss');
    console.log(`  [B] Extrude Boss (keycap blank) id: ${beamId}`);

    // Key-frame: the input beam, then a real drag-orbit.
    await story.frame('input-b');
    await dragOrbit(win, { dx: -200, dy: 90 });
    await story.frame('input-b-3d');

    // Step B2: Baseline volume.
    const mPreB = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  [B] Extrude Boss (keycap blank): vol=${mPreB.volume.toFixed(0)}, faces=${mPreB.faceCount}`);
    expect(mPreB.volume).toBeGreaterThan(0);

    // Step B3: REAL viewport click to select the keycap blank.
    await clickBody(win, beamId);

    // Step B4: Inject params and click Full Round Fillet.
    await injectToolParams(win, 'Full Round Fillet', { radius: 8 });
    const idBeforeB = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('fullround-dialog');
    await clickRibbonTool(win, 'Full Round Fillet');

    // Step B5: Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeB,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-fullround');

    // Step B6: Post-op assertions.
    const mPostB = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  [B] Full Round Fillet (softened keycap): vol=${mPostB.volume.toFixed(0)}, faces=${mPostB.faceCount}`);
    // Cliff-edge blend rounds all convex edges — volume shrinks from corner removal.
    expect(mPostB.volume).toBeGreaterThan(0);
    expect(mPostB.volume).toBeLessThan(mPreB.volume);
    // Blending adds curved edge-fillet faces → faceCount > 6.
    expect(mPostB.faceCount).toBeGreaterThan(6);


    // ══════════════════════════════════════════════════════════════════════════
    // Workflow C — Corner Mitre (arity-1)
    // Box (40³) → select → Corner Mitre r=3
    // ══════════════════════════════════════════════════════════════════════════

    // Step C1: Build the die blank (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  [C] Box (die blank) id: ${boxId}`);

    // Key-frame: the input box.
    await story.frame('input-c');
    await dragOrbit(win, { dx: 200, dy: 80 });
    await story.frame('input-c-3d');

    // Step C2: Baseline volume.
    const mPreC = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  [C] Box (die blank): vol=${mPreC.volume.toFixed(0)}, faces=${mPreC.faceCount}`);
    expect(mPreC.volume).toBeGreaterThan(0);

    // Step C3: REAL viewport click to select the die blank.
    await clickBody(win, boxId);

    // Step C4: Inject params and click Corner Mitre.
    await injectToolParams(win, 'Corner Mitre', { radius: 3 });
    const idBeforeC = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('cornermitre-dialog');
    await clickRibbonTool(win, 'Corner Mitre');

    // Step C5: Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeC,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-cornermitre');

    // Step C6: Post-op assertions.
    const mPostC = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  [C] Corner Mitre (mitred die): vol=${mPostC.volume.toFixed(0)}, faces=${mPostC.faceCount}`);
    // Mitre removes corner/edge material → volume < box.
    expect(mPostC.volume).toBeGreaterThan(0);
    expect(mPostC.volume).toBeLessThan(mPreC.volume);
    // Spherical corner patches + edge cylinders: ≥ 20 faces.
    expect(mPostC.faceCount).toBeGreaterThanOrEqual(20);

    // ── Closing orbit sweep ───────────────────────────────────────────────────
    const cap = await captureAllAngles(win, 'blend', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input-b\.png$/.test(f));
    const outputStill = stills.find(f => /-after-cornermitre\.png$/.test(f));
    expect(inputStill, 'an input-b still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-cornermitre still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-cornermitre still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);

  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
