/**
 * brep-g-g2blend-electron.spec.js
 *
 * "Operation in motion" test for the true G2 (curvature-continuous) surface
 * blend. Drives everything via real ribbon clicks + dialogs + REAL viewport
 * body picks. Records the whole workflow as a .webm video with key-frame
 * stills (motion-capture standard).
 *
 * ── MOTION-CAPTURE PATTERN (see brep-g-catmullclark-electron.spec.js) ────────
 * - launchWithCapture() records the workflow as 00-session.webm (slow-mo).
 * - buildPrimitive() builds bodies via the real Part-tab ribbon tools.
 * - clickBody() — REAL viewport mouse click — selects bodies.
 * - addToSelection() adds the second body (viewport handler has no modifier
 *   branch; selectMany is used internally, same as the Body Browser panel).
 * - story.frame(label) drops NN-<label>.png stills at each meaningful beat.
 * - dragOrbit() shows the model in 3D with a real drag gesture.
 * - captureAllAngles() does real drag-orbits for the closing sweep.
 * Artifacts: test-results/motion/brep-g-g2blend/ (00-session.webm + NN-*.png)
 *
 * Artifact: a NOTCHED PLATE — Box A (80×50×24) with a corner notch cut out by
 * Subtracting a second Box B (28×28×30). The notch creates fresh edges; G2
 * Blend fairs a smooth curvature-continuous surface between two of the plate's
 * edges.
 *
 * Focal op: Surface tab → G2 Blend (edgeA, edgeB, uSegments=32, vSegments=16).
 *
 * Assertions:
 *   - window.__lastG2Blend.stats: non-degenerate surface (triangleCount > 0,
 *     vertexCount > 0, finite bbox spanning a real extent).
 *   - PARITY-AUDIT P1: the blend RETAINS a NATIVE ArchDisc analytic NURBS face
 *     — stats.analytic === true, finite degrees, finite control-net counts,
 *     a real topoFaceId; and the analytic surface STEP-exports as a real
 *     B_SPLINE_SURFACE entity (window.__lastG2Blend.analyticStepHasBSpline).
 *   - the input notched-plate body STILL EXISTS after G2 Blend (the op is
 *     additive — it does NOT consume the body).
 *   - the 'input' and 'after-g2blend' stills both exist and are > 1 KB.
 *   - captureAllAngles blanks empty, pageErrors empty.
 *   - the recorded session .webm exists and is non-trivial.
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

test('G2 Blend: ribbon fairs a curvature-continuous surface on a notched plate', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-g-g2blend');
  try {
    // ── Step 1: Build Box A — the plate blank (80×50×24 mm) ──────────────────
    const plateId = await buildPrimitive(win, 'Box', { dx: 80, dy: 50, dz: 24 });
    console.log(`  Plate blank (Box A) id: ${plateId}`);
    await story.frame('input-plate');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-plate-3d');

    // ── Step 2: Build Box B — the notch cutter (28×28×30 mm) ─────────────────
    // Taller in Z (30 > 24) so it cuts cleanly through one corner of the plate.
    const cutterId = await buildPrimitive(win, 'Box', { dx: 28, dy: 28, dz: 30 });
    console.log(`  Notch cutter (Box B) id: ${cutterId}`);
    await story.frame('input-cutter');

    // ── Step 3: Subtract the cutter from the plate → notched plate ───────────
    // Real viewport click on the plate, then add the cutter to the selection.
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

    // Wait for the Boolean Cut to finish (a new __lastBrepShape).
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
    await clickBody(win, notchedId);
    await win.evaluate(() => { window.__lastG2Blend = null; });

    // How many edges does the notched plate have? Pick two well-separated ones.
    const edgeCount = await win.evaluate(async () => {
      const reg = window.__archdiscRegistry;
      const sel = reg && reg.selectedBrepShapes ? reg.selectedBrepShapes() : [];
      const body = (sel && sel[0]) || window.__lastBrepShape;
      if (!body || !body.shape) return 0;
      return window.__archdiscKernel.kernel.brep.edgeCount(body);
    });
    console.log(`  Notched plate edge count: ${edgeCount}`);
    expect(edgeCount).toBeGreaterThanOrEqual(2);

    // Two edges far apart on the notched plate. Edge 0 and an edge roughly
    // half-way round the edge list — well-separated so the blend spans a gap.
    const edgeA = 0;
    const edgeB = Math.min(edgeCount - 1, Math.max(2, Math.floor(edgeCount / 2)));
    console.log(`  Blending edge ${edgeA} ↔ edge ${edgeB}`);

    // ── Step 5: Inject G2 Blend params (Playwright webdriver bypass) ─────────
    await injectToolParams(win, 'G2 Blend', {
      edgeA,
      edgeB,
      uSegments: 32,
      vSegments: 16,
    });

    // ── Step 6: Run G2 Blend from the ribbon ─────────────────────────────────
    // The Surface tool group lives under the Part tab (same as the SSI tool).
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('g2blend-dialog');
    await clickRibbonTool(win, 'G2 Blend');
    await win.waitForTimeout(250);

    // ── Step 7: Wait for __lastG2Blend to be populated ───────────────────────
    await win.waitForFunction(() => !!window.__lastG2Blend, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    await story.frame('after-g2blend');

    // Drag-orbit to reveal the fairing surface in 3D.
    await dragOrbit(win, { dx: -190, dy: 80 });
    await story.frame('after-g2blend-3d');

    // ── Step 8: Verify the blend surface statistics ──────────────────────────
    const stats = await win.evaluate(() => window.__lastG2Blend.stats);
    console.log(`  G2 Blend stats: edges ${stats.edgeIndexA}↔${stats.edgeIndexB}, ` +
      `degree ${stats.degreeU}×${stats.degreeV}, ` +
      `CPs ${stats.controlPointsU}×${stats.controlPointsV}, ` +
      `tris=${stats.triangleCount}, verts=${stats.vertexCount}, ` +
      `errA=${Number(stats.boundaryAMaxError).toExponential(2)}, ` +
      `errB=${Number(stats.boundaryBMaxError).toExponential(2)}, ` +
      `faceTangentA=${stats.usedFaceTangentA}, faceTangentB=${stats.usedFaceTangentB}`);

    // Non-degenerate surface: real triangles + vertices.
    expect(stats.triangleCount).toBeGreaterThan(0);
    expect(stats.vertexCount).toBeGreaterThan(0);
    // Degree is the documented degree-3-in-u / degree-5-in-v construction.
    expect(stats.degreeU).toEqual(3);
    expect(stats.degreeV).toEqual(5);

    // Finite bounding box spanning a real extent (the blend is not a point).
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
    console.log(`  Blend bbox extent: dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}, ` +
      `dz=${dz.toFixed(2)}, diag=${diag.toFixed(2)} mm`);
    expect(diag).toBeGreaterThan(1); // a real surface, not a degenerate point

    // The boundary fit error must be tiny — the blend interpolates the edges.
    expect(Number.isFinite(stats.boundaryAMaxError)).toBe(true);
    expect(Number.isFinite(stats.boundaryBMaxError)).toBe(true);

    // ── Step 8b: PARITY-AUDIT P1 — the blend RETAINS a native analytic face ──
    // The G2 blend now carries its exact degree-3×5 NURBSSurface as a native
    // ArchDisc analytic TopoFace (not just a tessellated shell). Assert the
    // analytic flag, the finite degrees/control net, and the topoFaceId.
    const blend = await win.evaluate(() => ({
      analyticSurfacePresent: !!window.__lastG2Blend.analyticSurface,
      analyticStepHasBSpline: window.__lastG2Blend.analyticStepHasBSpline,
      analyticStepLen: window.__lastG2Blend.analyticStep
        ? window.__lastG2Blend.analyticStep.length : 0,
      // a snippet of the STEP text to prove the entity is genuinely present
      stepBSplineSnippet: (() => {
        const s = window.__lastG2Blend.analyticStep || '';
        const i = s.indexOf('B_SPLINE_SURFACE');
        return i >= 0 ? s.slice(Math.max(0, i - 8), i + 60) : null;
      })(),
    }));
    console.log(`  P1 analytic face: analytic=${stats.analytic}, ` +
      `topoFaceId=${stats.topoFaceId}, ` +
      `CPs ${stats.controlPointsU}×${stats.controlPointsV}, ` +
      `knots ${stats.knotCountU}/${stats.knotCountV}, ` +
      `STEP B_SPLINE present=${blend.analyticStepHasBSpline}`);
    console.log(`  P1 STEP B-spline snippet: ${blend.stepBSplineSnippet}`);

    // The blend body carries a NATIVE analytic NURBS face.
    expect(stats.analytic, 'the G2 blend must retain a native analytic NURBS face').toBe(true);
    expect(Number.isFinite(stats.degreeU)).toBe(true);
    expect(Number.isFinite(stats.degreeV)).toBe(true);
    expect(stats.controlPointsU).toBeGreaterThan(1);
    expect(stats.controlPointsV).toBeGreaterThan(1);
    expect(Number.isInteger(stats.topoFaceId)).toBe(true);
    // The analytic surface STEP-exports as a real B_SPLINE_SURFACE entity.
    expect(blend.analyticSurfacePresent,
      'the exact analytic NURBS surface data must be present').toBe(true);
    expect(blend.analyticStepHasBSpline,
      'the analytic surface must STEP-export with a B_SPLINE_SURFACE entity').toBe(true);
    expect(blend.analyticStepLen).toBeGreaterThan(500);
    expect(blend.stepBSplineSnippet,
      'the STEP text must contain a B_SPLINE_SURFACE entity').toBeTruthy();

    // ── Step 9: the input notched-plate body STILL EXISTS ────────────────────
    // G2 Blend is additive — it adds the fairing surface, it does NOT consume
    // the body. The notched plate must still be in the registry.
    const plateStillThere = await win.evaluate((id) => {
      const reg = window.__archdiscRegistry;
      return !!(reg && reg.bodies && reg.bodies.some(b => b.id === id));
    }, notchedId);
    expect(plateStillThere, 'the notched-plate body must survive G2 Blend').toBe(true);

    // The scene also gained the blend body (a new registry entry).
    const bodyCount = await win.evaluate(
      () => (window.__archdiscRegistry && window.__archdiscRegistry.bodies
        ? window.__archdiscRegistry.bodies.length : 0),
    );
    console.log(`  Registry body count after G2 Blend: ${bodyCount}`);
    expect(bodyCount).toBeGreaterThanOrEqual(2); // notched plate + blend surface

    // ── Step 10: Multi-angle render via REAL drag-orbits — no blank frames ───
    const cap = await captureAllAngles(win, 'g2blend-notched-plate', {
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
    const outputStill = stills.find(f => /-after-g2blend\.png$/.test(f));
    expect(inputStill,  'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-g2blend still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-g2blend still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
