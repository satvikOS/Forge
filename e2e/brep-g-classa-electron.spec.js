/**
 * brep-g-classa-electron.spec.js
 *
 * "Operation in motion" test for the Sub-project G class-A modelling tools —
 * Class-A Analyze (Gaussian-curvature heatmap) and Zebra Stripes (striped-
 * reflection continuity overlay). Drives everything via real ribbon clicks +
 * dialogs + REAL viewport body picks. Records the whole workflow as a .webm
 * video with key-frame stills (motion-capture standard).
 *
 * ── MOTION-CAPTURE PATTERN (see brep-g-catmullclark-electron.spec.js) ────────
 * - launchWithCapture() records the workflow as 00-session.webm (slow-mo).
 * - buildPrimitive() builds the box via the real Part-tab ribbon tool.
 * - clickBody() — REAL viewport mouse click — selects bodies.
 * - story.frame(label) drops NN-<label>.png stills at each meaningful beat.
 * - dragOrbit() shows the heatmap / stripes in 3D with a real drag gesture.
 * - captureAllAngles() does real drag-orbits for the closing all-angle sweep.
 * Artifacts: test-results/motion/brep-g-classa/ (00-session.webm + NN-*.png)
 *
 * Artifact: a ROUNDED PLATE — Box 40×40×40 with a Fillet (r=4 mm). The fillet
 * creates genuinely curved regions (the rolled edges) with positive Gaussian
 * curvature, so the heatmap has real variation to show and the zebra stripes
 * have curvature to flow across.
 *
 * Focal ops: Surface tab → Class-A Analyze, then Zebra Stripes on the same body.
 *
 * Assertions:
 *   - window.__lastClassAAnalysis.gaussianRange is a finite, non-degenerate
 *     range; samples > 0.
 *   - window.__lastZebraStripes.applied === true.
 *   - the 'input' and 'after-zebra' stills both exist and are > 1 KB.
 *   - captureAllAngles blanks empty, pageErrors empty.
 *   - the recorded session .webm exists and is non-trivial.
 *
 * ONE test() in this file — recordVideo teardown races across tests in a worker.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  buildPrimitive, clickRibbonTab, clickRibbonTool, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, dragOrbit,
} from './helpers/motionCapture.js';
import { captureAllAngles } from './helpers/orbitCapture.js';

test.setTimeout(600000);

// ─── Main gate test ───────────────────────────────────────────────────────────

test('Class-A tools: ribbon paints a Gaussian-curvature heatmap + zebra stripes on a filleted plate', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-g-classa');
  try {
    // ── Step 1: Build Box (40×40×40) — the plate blank ───────────────────────
    const boxId = await buildPrimitive(win, 'Box', { dx: 40, dy: 40, dz: 40 });
    console.log(`  Box id: ${boxId}`);
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // ── Step 2: Select the box (REAL viewport click) and apply Fillet ────────
    // The fillet rounds every edge → curved regions for the curvature analysis.
    await clickBody(win, boxId);
    const idBeforeFillet = await win.evaluate(
      () => (window.__lastBrepShape && window.__lastBrepShape.id) || null,
    );
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);

    await injectToolParams(win, 'Fillet', { radius: 4 });
    await story.frame('before-fillet');
    await clickRibbonTool(win, 'Fillet');
    await win.waitForTimeout(250);

    // Wait for __lastBrepShape to change (fillet completed).
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet,
      { timeout: 90000 },
    );
    const filletedId = await win.evaluate(
      () => window.__archdiscRegistry && window.__archdiscRegistry.bodies
        ? window.__archdiscRegistry.bodies[window.__archdiscRegistry.bodies.length - 1].id
        : window.__lastBrepShape.id,
    );
    console.log(`  Filleted plate id: ${filletedId}`);
    await win.waitForTimeout(300);
    await story.frame('after-fillet');
    await dragOrbit(win, { dx: -170, dy: 70 });
    await story.frame('after-fillet-3d');

    // ── Step 3: Run Class-A Analyze on the filleted body ─────────────────────
    // Select the filleted body with a REAL viewport click.
    await clickBody(win, filletedId);
    await win.evaluate(() => { window.__lastClassAAnalysis = null; });

    // Inject the resolution param (Playwright webdriver dialog bypass).
    await injectToolParams(win, 'Class-A Analyze', { gridSamples: 64 });

    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('before-classa');
    await clickRibbonTool(win, 'Class-A Analyze');
    await win.waitForTimeout(250);

    // Wait for __lastClassAAnalysis to be populated.
    await win.waitForFunction(() => !!window.__lastClassAAnalysis, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    await story.frame('after-classa');
    // Drag-orbit to reveal the curvature heatmap colours in 3D.
    await dragOrbit(win, { dx: -190, dy: 80 });
    await story.frame('after-classa-3d');

    // ── Step 4: Verify the Class-A curvature statistics ──────────────────────
    const classA = await win.evaluate(() => window.__lastClassAAnalysis);
    console.log(`  Class-A stats: samples=${classA.samples}, ` +
      `gaussianRange=[${classA.gaussianRange[0].toExponential(3)}, ` +
      `${classA.gaussianRange[1].toExponential(3)}], ` +
      `meanRange=[${classA.meanRange[0].toExponential(3)}, ` +
      `${classA.meanRange[1].toExponential(3)}]`);

    // Real vertices were analysed.
    expect(classA.samples).toBeGreaterThan(0);

    // The Gaussian-curvature range must be finite and non-degenerate. A box
    // with a rounded fillet has flat faces (K≈0) and convex rolled edges
    // (K>0) — so max must be strictly greater than min.
    const [gMin, gMax] = classA.gaussianRange;
    expect(Number.isFinite(gMin)).toBe(true);
    expect(Number.isFinite(gMax)).toBe(true);
    expect(gMax).toBeGreaterThan(gMin);

    // The mean-curvature range is also finite (companion DDG operator).
    expect(Number.isFinite(classA.meanRange[0])).toBe(true);
    expect(Number.isFinite(classA.meanRange[1])).toBe(true);

    // The heatmap mesh was added as a new body — the original plate survives.
    const plateStillThere = await win.evaluate((id) => {
      const reg = window.__archdiscRegistry;
      return !!(reg && reg.bodies && reg.bodies.some(b => b.id === id));
    }, filletedId);
    expect(plateStillThere, 'the filleted plate must survive Class-A Analyze').toBe(true);

    // ── Step 5: Run Zebra Stripes on the same filleted body ──────────────────
    // The filleted plate is still the active selection (Class-A is additive
    // and does not change the selection) — so Zebra Stripes overlays it.
    await clickBody(win, filletedId);
    await win.evaluate(() => { window.__lastZebraStripes = null; });

    await injectToolParams(win, 'Zebra Stripes', { stripeFrequency: 18, direction: 0 });

    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('before-zebra');
    await clickRibbonTool(win, 'Zebra Stripes');
    await win.waitForTimeout(250);

    // Wait for __lastZebraStripes to be populated.
    await win.waitForFunction(() => !!window.__lastZebraStripes, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    await story.frame('after-zebra');
    // Drag-orbit to reveal the zebra stripes flowing over the rounded edges.
    await dragOrbit(win, { dx: 200, dy: -70 });
    await story.frame('after-zebra-3d');

    // ── Step 6: Verify the Zebra Stripes overlay ─────────────────────────────
    const zebra = await win.evaluate(() => window.__lastZebraStripes);
    console.log(`  Zebra stats: applied=${zebra.applied}, stripeCount=${zebra.stripeCount}`);
    expect(zebra.applied).toBe(true);
    expect(zebra.stripeCount).toBeGreaterThan(0);

    // ── Step 7: Multi-angle render via REAL drag-orbits — no blank frames ────
    const cap = await captureAllAngles(win, 'classa-filleted-plate', {
      azimuths:   [0, 60, 120, 180, 240, 300],
      elevations: [-30, 30],
      zooms:      [0.6, 1.0, 1.8],
      story,
    });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Step 8: Verify the storyboard stills exist and are non-trivial ───────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const zebraStill = stills.find(f => /-after-zebra\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(zebraStill, 'an after-zebra still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(zebraStill).size,
      'after-zebra still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
