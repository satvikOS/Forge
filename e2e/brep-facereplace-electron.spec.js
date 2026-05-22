/**
 * brep-facereplace-electron.spec.js
 *
 * "Operation in motion" test for PARITY-AUDIT P4 — arbitrary face replacement
 * in ArchDisc's NATIVE B-rep topology kernel.
 *
 * The §3.4 capability: swap a face's underlying surface for a GENUINELY
 * DIFFERENT (curved) one, rebuilding the boundary topology. The hard part is
 * the new surface needs fresh PCURVES for every boundary edge — the 2-D
 * parametric trace of the edge in the new surface's (u,v) space. ArchDisc
 * generates these natively: `foundation/PCurveProjection.js` ports OCCT's
 * `ShapeConstruct_ProjectCurveOnSurface` — Newton point-inversion (Piegl &
 * Tiller "The NURBS Book" §6.1) + 2-D B-spline fitting (§9.2.1).
 *
 * ── MOTION-CAPTURE PATTERN ───────────────────────────────────────────────────
 * - launchWithCapture() records the workflow as 00-session.webm (slow-mo).
 * - buildPrimitive() builds bodies via the real Part-tab ribbon tools.
 * - clickBody() — REAL viewport mouse click — selects the body.
 * - injectToolParams() supplies the Replace Face params (curvedSwap=1).
 * - story.frame(label) drops NN-<label>.png stills at each meaningful beat.
 * - dragOrbit() / captureAllAngles() show the model in 3D with real gestures.
 * Artifacts: test-results/motion/brep-facereplace/
 *
 * Artifact: a notched plate — Box A (60×60×24) with a corner notch cut by
 * Subtracting Box B (24×24×30). Replace Face then re-seats one of the plate's
 * planar faces onto an ARBITRARY curved NURBS surface.
 *
 * Focal op: Direct Edit tab → Replace Face (faceIndex=1, curvedSwap=1).
 *
 * Assertions:
 *   - window.__lastFaceReplace.stats: curvedSwap === true, the rebuilt face is
 *     VALID — fresh pcurves generated (pcurveCount === boundaryEdges),
 *     loopClosed === true, allConverged === true, finite errors.
 *   - the analytic surface STEP-exports with a B_SPLINE_SURFACE entity.
 *   - the result body still tessellates / measures (a real body in the scene).
 *   - the input/output stills exist and are non-trivial.
 *   - captureAllAngles blanks empty, pageErrors empty.
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

test('Replace Face: re-seats a face onto an arbitrary curved NURBS surface with native pcurves', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-facereplace');
  try {
    // ── Step 1: Build Box A — the plate blank (60×60×24 mm) ──────────────────
    const plateId = await buildPrimitive(win, 'Box', { dx: 60, dy: 60, dz: 24 });
    console.log(`  Plate blank (Box A) id: ${plateId}`);
    await story.frame('input-plate');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-plate-3d');

    // ── Step 2: Build Box B — the notch cutter (24×24×30 mm) ─────────────────
    const cutterId = await buildPrimitive(win, 'Box', { dx: 24, dy: 24, dz: 30 });
    console.log(`  Notch cutter (Box B) id: ${cutterId}`);
    await story.frame('input-cutter');

    // ── Step 3: Subtract the cutter → notched plate ──────────────────────────
    await clickBody(win, plateId);
    await addToSelection(win, cutterId);

    const idBeforeCut = await win.evaluate(
      () => (window.__lastBrepShape && window.__lastBrepShape.id) || null,
    );
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('before-subtract');
    await clickRibbonTool(win, 'Subtract');
    await win.waitForTimeout(250);
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeCut,
      { timeout: 90000 },
    );
    await win.waitForTimeout(400);
    const notchedId = await win.evaluate(
      () => window.__archdiscRegistry && window.__archdiscRegistry.bodies
        ? window.__archdiscRegistry.bodies[window.__archdiscRegistry.bodies.length - 1].id
        : window.__lastBrepShape.id,
    );
    console.log(`  Notched plate id: ${notchedId}`);
    await story.frame('input');
    await dragOrbit(win, { dx: -170, dy: 70 });
    await story.frame('input-3d');

    // ── Step 4: Select the notched plate (REAL viewport click) ───────────────
    await win.evaluate(() => window.__archdiscRegistry.clearSelection());
    await addToSelection(win, notchedId);
    await win.evaluate(() => { window.__lastFaceReplace = null; });

    // ── Step 5: Inject Replace Face params — CURVED SWAP (P4) ────────────────
    // curvedSwap=1 → re-seat the face onto an arbitrary curved NURBS surface,
    // generating fresh pcurves natively. bulge=0 → auto (scales with the face).
    await injectToolParams(win, 'Replace Face', {
      faceIndex: 1,
      curvedSwap: 1,
      bulge: 0,
    });

    // ── Step 6: Run Replace Face from the Direct Edit ribbon ─────────────────
    const idBeforeReplace = await win.evaluate(
      () => (window.__lastBrepShape && window.__lastBrepShape.id) || null,
    );
    await clickRibbonTab(win, 'Direct Edit');
    await win.waitForTimeout(150);
    await story.frame('replaceface-dialog');
    await clickRibbonTool(win, 'Replace Face');
    await win.waitForTimeout(250);

    // ── Step 7: Wait for __lastFaceReplace to be populated ───────────────────
    await win.waitForFunction(() => !!window.__lastFaceReplace, null, { timeout: 120000 });
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeReplace,
      { timeout: 120000 },
    );
    await win.waitForTimeout(400);
    await story.frame('after-replaceface');
    await dragOrbit(win, { dx: -190, dy: 80 });
    await story.frame('after-replaceface-3d');

    // ── Step 8: Verify the arbitrary-surface swap statistics ─────────────────
    const fr = await win.evaluate(() => ({
      stats: window.__lastFaceReplace.stats,
      analyticSurfacePresent: !!window.__lastFaceReplace.analyticSurface,
      analyticStepHasBSpline: window.__lastFaceReplace.analyticStepHasBSpline,
      analyticStepLen: window.__lastFaceReplace.analyticStep
        ? window.__lastFaceReplace.analyticStep.length : 0,
      stepBSplineSnippet: (() => {
        const s = window.__lastFaceReplace.analyticStep || '';
        const i = s.indexOf('B_SPLINE_SURFACE');
        return i >= 0 ? s.slice(Math.max(0, i - 8), i + 60) : null;
      })(),
    }));
    const stats = fr.stats;
    console.log(`  Replace Face stats: curvedSwap=${stats.curvedSwap}, ` +
      `boundaryEdges=${stats.boundaryEdges}, pcurves=${stats.pcurveCount}, ` +
      `degree ${stats.degreeU}×${stats.degreeV}, ` +
      `CPs ${stats.controlPointsU}×${stats.controlPointsV}, ` +
      `bulge=${Number(stats.bulge).toFixed(2)} mm, ` +
      `loopClosed=${stats.loopClosed}, allConverged=${stats.allConverged}, ` +
      `maxProjErr=${Number(stats.maxProjectionError).toExponential(2)}, ` +
      `maxPushFwd=${Number(stats.maxPushForwardError).toExponential(2)}`);
    console.log(`  Replace Face STEP B-spline snippet: ${fr.stepBSplineSnippet}`);

    // The swap re-seated the face onto a genuinely curved NURBS surface.
    expect(stats.curvedSwap, 'Replace Face must run the arbitrary curved-swap path').toBe(true);
    expect(stats.valid, 'the rebuilt face must be valid').toBe(true);
    // Fresh pcurves — ONE per boundary edge — generated for the new surface.
    expect(stats.pcurveCount).toBeGreaterThanOrEqual(3);
    expect(stats.pcurveCount).toEqual(stats.boundaryEdges);
    // The rebuilt boundary is a closed loop in (u,v) parameter space.
    expect(stats.loopClosed, 'the rebuilt pcurve boundary must be closed in (u,v)').toBe(true);
    // Every boundary sample inverted onto the new surface (Newton converged).
    expect(stats.allConverged, 'point-inversion must converge for every sample').toBe(true);
    // The new surface is a genuine NURBS surface (finite degrees, real CPs).
    expect(Number.isFinite(stats.degreeU)).toBe(true);
    expect(Number.isFinite(stats.degreeV)).toBe(true);
    expect(stats.controlPointsU).toBeGreaterThan(1);
    expect(stats.controlPointsV).toBeGreaterThan(1);
    // It is genuinely CURVED — a non-zero bulge (a real geometric swap).
    expect(stats.bulge).toBeGreaterThan(0);
    // Finite, bounded projection / push-forward errors.
    expect(Number.isFinite(stats.maxProjectionError)).toBe(true);
    expect(Number.isFinite(stats.maxPushForwardError)).toBe(true);

    // The analytic surface STEP-exports as a real B_SPLINE_SURFACE entity.
    expect(fr.analyticSurfacePresent,
      'the new analytic NURBS surface data must be present').toBe(true);
    expect(fr.analyticStepHasBSpline,
      'the new surface must STEP-export with a B_SPLINE_SURFACE entity').toBe(true);
    expect(fr.analyticStepLen).toBeGreaterThan(500);
    expect(fr.stepBSplineSnippet,
      'the STEP text must contain a B_SPLINE_SURFACE entity').toBeTruthy();

    // ── Step 9: the result body is a real, measurable body in the scene ──────
    const measured = await win.evaluate(async () => {
      try {
        const m = await window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape);
        return { ok: true, faceCount: m.faceCount, area: m.area };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    });
    console.log(`  Result body: measurable=${measured.ok}, faces=${measured.faceCount}`);
    expect(measured.ok, 'the swapped-face body must still measure cleanly').toBe(true);
    expect(measured.faceCount).toBeGreaterThan(0);

    const bodyCount = await win.evaluate(
      () => (window.__archdiscRegistry && window.__archdiscRegistry.bodies
        ? window.__archdiscRegistry.bodies.length : 0),
    );
    console.log(`  Registry body count after Replace Face: ${bodyCount}`);
    expect(bodyCount).toBeGreaterThanOrEqual(1);

    // ── Step 10: Multi-angle render via REAL drag-orbits — no blank frames ───
    const cap = await captureAllAngles(win, 'facereplace-curved-swap', {
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
    const inputStill  = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-replaceface\.png$/.test(f));
    expect(inputStill,  'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-replaceface still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-replaceface still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
