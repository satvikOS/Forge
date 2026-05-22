/**
 * brep-selfintersect-electron.spec.js
 *
 * "Operation in motion" gate for §3.6 FACE-LEVEL self-intersection detection
 * (P7) — the genuine pure-JS Möller triangle-triangle detector.
 *
 * ── MOTION-CAPTURE PATTERN (see brep-g-catmullclark-electron.spec.js) ────────
 * - launchWithCapture() records the workflow as 00-session.webm (slow-mo).
 * - buildPrimitive() builds bodies via the real Part-tab ribbon tools.
 * - clickBody() / addToSelection() — REAL viewport picks.
 * - story.frame(label) drops NN-<label>.png stills at each beat.
 * - dragOrbit() shows the model in 3D with a real drag gesture.
 * Artifacts: test-results/motion/brep-selfintersect/ (00-session.webm + NN-*.png)
 *
 * Artifact + scenario:
 *   CLEAN body  — a Box (40×40×40) with a Fillet (r=6). A well-formed solid:
 *                 Check Geometry must report NO face-level self-intersection.
 *   DIRTY body  — two diagonally-overlapping boxes grouped into ONE body as a
 *                 compound (NOT a boolean — a boolean would imprint the
 *                 intersection clean). In the compound, box A's faces and
 *                 box B's faces genuinely PASS THROUGH each other inside the
 *                 overlap region — a textbook face-level self-intersection.
 *                 Check Geometry must report it and the crossing zone is
 *                 highlighted in red. The compound is built via the kernel
 *                 (makeCompound) as artifact scaffolding; the FOCAL op
 *                 (Check Geometry) is driven by a real ribbon click.
 *
 * Focal op: Manufacture/Inspect tab → Check Geometry — runs
 *   ArchDiscKernel.brep.selfIntersect (per-face tessellation + pure-JS Möller
 *   triangle-triangle test, BVH-accelerated).
 *
 * Assertions:
 *   - CLEAN body: window.__lastSelfIntersection.faceLevelSelfIntersection===false
 *   - DIRTY body: faceLevelSelfIntersection===true, faceLevelPairCount>0,
 *     facePairs non-empty; a highlight body was added.
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

test.setTimeout(600000);

test('Check Geometry: detects face-level self-intersection in a non-cleanly fused body', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-selfintersect');
  try {
    // ════════════════════════════════════════════════════════════════════════
    // PART 1 — a CLEAN body: Box + Fillet. Must report NO self-intersection.
    // ════════════════════════════════════════════════════════════════════════
    const cleanBoxId = await buildPrimitive(win, 'Box', { dx: 40, dy: 40, dz: 40 });
    console.log(`  Clean box id: ${cleanBoxId}`);
    await story.frame('clean-box');
    await dragOrbit(win, { dx: 190, dy: 80 });
    await story.frame('clean-box-3d');

    // Fillet it → a well-formed rounded solid.
    await clickBody(win, cleanBoxId);
    const idBeforeFillet = await win.evaluate(
      () => (window.__lastBrepShape && window.__lastBrepShape.id) || null,
    );
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await injectToolParams(win, 'Fillet', { radius: 6 });
    await clickRibbonTool(win, 'Fillet');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet, { timeout: 90000 },
    );
    await win.waitForTimeout(400);
    const cleanId = await win.evaluate(
      () => window.__archdiscRegistry.bodies[window.__archdiscRegistry.bodies.length - 1].id,
    );
    console.log(`  Clean filleted body id: ${cleanId}`);
    await story.frame('clean-filleted');

    // Run Check Geometry on the clean body.
    await clickBody(win, cleanId);
    await win.evaluate(() => { window.__lastSelfIntersection = null; });
    await clickRibbonTab(win, 'Manufacture');
    await win.waitForTimeout(150);
    await story.frame('before-check-clean');
    await clickRibbonTool(win, 'Check Geometry');
    await win.waitForFunction(() => !!window.__lastSelfIntersection, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    await story.frame('after-check-clean');

    const cleanResult = await win.evaluate(() => window.__lastSelfIntersection);
    console.log(`  CLEAN verdict: faceLevelSelfIntersection=${cleanResult.faceLevelSelfIntersection}, ` +
      `pairCount=${cleanResult.faceLevelPairCount}, ` +
      `tris=${cleanResult.stats.triangles}, faces=${cleanResult.stats.faces}`);
    expect(cleanResult.faceLevelSelfIntersection,
      'a clean Box+Fillet body must report NO face-level self-intersection').toBe(false);
    expect(cleanResult.faceLevelPairCount).toBe(0);
    expect(cleanResult.stats.triangles).toBeGreaterThan(0);

    // ════════════════════════════════════════════════════════════════════════
    // PART 2 — a DIRTY body: two diagonally-overlapping boxes grouped into ONE
    // compound body. A compound is NOT a boolean — the kernel does not imprint
    // the intersection, so box A's faces and box B's faces genuinely pass
    // through each other. (A boolean Combine would imprint it clean.) The
    // compound is assembled via the kernel facade as artifact scaffolding.
    // ════════════════════════════════════════════════════════════════════════
    const dirtyBuilt = await win.evaluate(async () => {
      const brep = window.__archdiscKernel.kernel.brep;
      // Box A [0,30]^3 ; Box B translated by (15,15,15) → [15,45]^3. Their
      // axis-aligned faces cross along interior lines (e.g. A's +x face x=30
      // crosses B's -y face y=15). Grouped as a compound, no imprint.
      const boxA = await brep.makeBox(30, 30, 30);
      const boxBraw = await brep.makeBox(30, 30, 30);
      const boxB = await brep.translate(boxBraw, 15, 15, 15);
      boxBraw.dispose();
      const compound = await brep.makeCompound([boxA, boxB]);
      // NOTE: makeCompound shares the sub-shapes' kernel memory — do NOT
      // dispose boxA / boxB or the compound would break. They are leaked for
      // the lifetime of this short-lived test process (acceptable scaffolding).
      // Render it as the active body — Check Geometry's _pickBodies(1) falls
      // back to window.__lastBrepShape, so a real ribbon click inspects this.
      await window.__archdiscKernel.renderShape(compound);
      return { id: window.__lastBrepShape && window.__lastBrepShape.id };
    });
    console.log(`  Dirty (self-intersecting compound) body: ${JSON.stringify(dirtyBuilt)}`);
    await win.waitForTimeout(400);
    await story.frame('dirty-body');
    await dragOrbit(win, { dx: -170, dy: 70 });
    await story.frame('dirty-body-3d');

    // Run Check Geometry on the dirty body — clear any selection so
    // _pickBodies(1) falls back to the compound (window.__lastBrepShape).
    await win.evaluate(() => {
      if (window.__archdiscRegistry) window.__archdiscRegistry.clearSelection();
      window.__lastSelfIntersection = null;
    });
    const bodyCountBefore = await win.evaluate(
      () => window.__archdiscRegistry.bodies.length,
    );
    await clickRibbonTab(win, 'Manufacture');
    await win.waitForTimeout(150);
    await story.frame('before-check-dirty');
    await clickRibbonTool(win, 'Check Geometry');
    await win.waitForFunction(() => !!window.__lastSelfIntersection, null, { timeout: 120000 });
    await win.waitForTimeout(500);
    await story.frame('after-check-dirty');

    const dirtyResult = await win.evaluate(() => window.__lastSelfIntersection);
    console.log(`  DIRTY verdict: faceLevelSelfIntersection=${dirtyResult.faceLevelSelfIntersection}, ` +
      `pairCount=${dirtyResult.faceLevelPairCount}, facePairs=${dirtyResult.facePairs.length}, ` +
      `segments=${dirtyResult.segmentCount}, ` +
      `tris=${dirtyResult.stats.triangles}, testedPairs=${dirtyResult.stats.testedPairs}`);

    // The genuine Möller detector must catch the crossing faces.
    expect(dirtyResult.faceLevelSelfIntersection,
      'two overlapping boxes grouped as a compound must self-intersect at the face level').toBe(true);
    expect(dirtyResult.faceLevelPairCount).toBeGreaterThan(0);
    expect(dirtyResult.facePairs.length).toBeGreaterThan(0);
    expect(dirtyResult.stats.triangles).toBeGreaterThan(0);

    // The crossing zone was rendered as a highlight body (registry grew).
    const bodyCountAfter = await win.evaluate(
      () => window.__archdiscRegistry.bodies.length,
    );
    console.log(`  Registry bodies: ${bodyCountBefore} → ${bodyCountAfter} (crossing-zone highlight)`);
    expect(bodyCountAfter,
      'a red self-intersection-zone highlight body must have been added').toBeGreaterThan(bodyCountBefore);

    // Check Geometry is non-consuming — the inspected compound is untouched
    // (window.__lastBrepShape still holds a live shape).
    const dirtyStillLive = await win.evaluate(
      () => !!(window.__lastBrepShape && window.__lastBrepShape.shape),
    );
    expect(dirtyStillLive, 'Check Geometry must NOT consume the inspected body').toBe(true);

    // Reveal the highlighted crossing zone with a real drag-orbit.
    await dragOrbit(win, { dx: 200, dy: -60 });
    await story.frame('crossing-zone-highlighted');

    expect(pageErrors).toEqual([]);

    // ── Verify the storyboard stills exist and are non-trivial ───────────────
    const stills = story.frames();
    const cleanStill = stills.find(f => /-after-check-clean\.png$/.test(f));
    const dirtyStill = stills.find(f => /-after-check-dirty\.png$/.test(f));
    expect(cleanStill, 'an after-check-clean still must exist').toBeTruthy();
    expect(dirtyStill, 'an after-check-dirty still must exist').toBeTruthy();
    expect(fs.statSync(cleanStill).size).toBeGreaterThan(1024);
    expect(fs.statSync(dirtyStill).size).toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
