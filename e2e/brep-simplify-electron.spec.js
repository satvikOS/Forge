/**
 * brep-simplify-electron.spec.js
 *
 * "Operation in motion" retrofit — Simplify Geometry on real engineering artifacts.
 * Drives everything via real ribbon clicks, REAL viewport body clicks, and drag-orbits.
 * Records the whole workflow as a .webm video with key-frame stills at each beat.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ─────────────────────
 *
 * ONE consolidated test runs three Simplify Geometry workflows in sequence inside
 * a single launchWithCapture session (one video, one storyboard). This avoids the
 * Playwright Electron recordVideo teardown race that silently drops stills when
 * multiple test() blocks share a worker.
 *
 * Workflow A — welded plate seam:
 *   Extrude Boss (plate, accept defaults → 80×50×25 mm) → select → Simplify Geometry
 *
 * Workflow B — tiny-feature removal (§3.5 parity gap P2/P5):
 *   Box (40³) → Fillet r=0.4 (26 faces, 20 micro-round faces) → select →
 *   Simplify Geometry (minFeatureSize=4) — the micro-fillet faces are TINY
 *   features; Simplify must REMOVE them (faceCount drops 26→6) and report a
 *   positive removed-feature count.
 *
 * Workflow C — block with through-hole cleanup:
 *   Box (40³) + Cylinder (r=20, h=40) → Subtract → select result → Simplify Geometry
 *
 * Assertions (all original ones kept — video/stills are ADDITIVE):
 *   - volume preserved within 0.5% after Workflows A and C
 *   - faceCount must not increase after each Simplify
 *   - Workflow B: faceCount DROPS and window.__lastSimplifyResult.removedFeatures > 0
 *   - stills: 'input-weldedplate' and 'after-simplify-c' both exist and > 1 KB
 *
 * Artifacts land in:  test-results/motion/brep-simplify/
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, addToSelection, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

// ─── Single consolidated test ─────────────────────────────────────────────────

test('Simplify Geometry: three artifact workflows (welded plate, bottle cap, block+hole) — volume preserved ±0.5%, faceCount non-increasing', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-simplify');
  try {

    // ══════════════════════════════════════════════════════════════════════════
    // Workflow A — welded plate seam
    // Extrude Boss (arity-0, 80×50×25 mm) → Simplify Geometry
    // ══════════════════════════════════════════════════════════════════════════

    // Step A1: Build the plate via Extrude Boss (arity-0, accept defaults).
    const plateId = await buildPrimitive(win, 'Extrude Boss');
    console.log(`  [A] Extrude Boss plate id: ${plateId}`);

    // Key-frame: the input plate, then a real drag-orbit to show it in 3D.
    await story.frame('input-weldedplate');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-weldedplate-3d');

    // Step A2: Baseline measurements.
    const mPreA = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  [A] Extrude Boss plate: vol=${mPreA.volume.toFixed(0)}, faces=${mPreA.faceCount}`);
    expect(mPreA.volume).toBeGreaterThan(0);

    // Step A3: Select the plate body with a REAL viewport click.
    await clickBody(win, plateId);

    // Step A4: Inject params (none needed for Simplify, but guard for bypass).
    const idBeforeA = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    await clickRibbonTab(win, 'Direct Edit');
    await win.waitForTimeout(120);
    await story.frame('simplify-a-dialog');
    await clickRibbonTool(win, 'Simplify Geometry');

    // Step A5: Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeA,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-simplify-a');

    // Step A6: Post-simplify assertions.
    const mPostA = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  [A] Simplified (welded plate): vol=${mPostA.volume.toFixed(0)}, faces=${mPostA.faceCount}`);

    // Volume preserved within 0.5%.
    expect(mPostA.volume).toBeGreaterThan(mPreA.volume * 0.995);
    expect(mPostA.volume).toBeLessThan(mPreA.volume * 1.005);
    // Simplify merges faces — face count must not increase.
    expect(mPostA.faceCount).toBeLessThanOrEqual(mPreA.faceCount);


    // ══════════════════════════════════════════════════════════════════════════
    // Workflow B — tiny-feature removal  (§3.5 parity gap P2/P5)
    // Box 40³ → Fillet r=0.4 (26 faces, 20 micro-round faces) → select →
    // Simplify Geometry (minFeatureSize=4). The micro-fillet faces are TINY
    // features below the 4 mm threshold — Simplify must REMOVE them, dropping
    // the face count back toward 6 and reporting removedFeatures > 0.
    // This exercises the CLOSED P5 gap: simplify now does real small-feature
    // removal (ShapeFix_FixSmallFace), not just same-domain merge.
    // ══════════════════════════════════════════════════════════════════════════

    // Step B1: Build the blank (Box 40³).
    const blankId = await buildPrimitive(win, 'Box');
    console.log(`  [B] Box (tiny-fillet blank) id: ${blankId}`);

    await story.frame('input-tinyfillet-box');
    await dragOrbit(win, { dx: -180, dy: 90 });
    await story.frame('input-tinyfillet-box-3d');

    // Step B2: Select the box and Fillet every edge at r=0.4 — 20 micro-round
    // faces (12 cylindrical bands + 8 spherical corners) = the tiny features.
    await clickBody(win, blankId);
    const idBeforeFilletB = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    await injectToolParams(win, 'Fillet', { radius: 0.4 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('before-fillet-b');
    await clickRibbonTool(win, 'Fillet');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFilletB,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-fillet-b');

    // Registry id of the micro-filleted body, for the next click.
    const microFilletedId = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      if (reg && reg.bodies && reg.bodies.length > 0) {
        return reg.bodies[reg.bodies.length - 1].id;
      }
      return window.__lastBrepShape && window.__lastBrepShape.id;
    });

    // Step B3: Baseline — the micro-filleted body has many tiny faces.
    const mPreB = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  [B] Micro-filleted box (r=0.4): vol=${mPreB.volume.toFixed(0)}, faces=${mPreB.faceCount}`);
    // Fillet on a 40³ box → 26 faces; the 20 extra faces are the tiny features.
    expect(mPreB.faceCount).toBeGreaterThan(6);
    expect(mPreB.volume).toBeGreaterThan(0);

    // Step B4: REAL viewport click to select the micro-filleted body.
    await clickBody(win, microFilletedId);

    // Step B5: Apply Simplify Geometry (Direct Edit tab) with minFeatureSize=4
    // — large enough to classify the r=0.4 fillet faces as tiny features.
    await win.evaluate(() => { window.__lastSimplifyResult = null; });
    await injectToolParams(win, 'Simplify Geometry', { minFeatureSize: 4 });
    const idBeforeB = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    await clickRibbonTab(win, 'Direct Edit');
    await win.waitForTimeout(120);
    await story.frame('simplify-b-dialog');
    await clickRibbonTool(win, 'Simplify Geometry');

    // Step B6: Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeB,
      { timeout: 60000 },
    );
    await win.waitForFunction(() => !!window.__lastSimplifyResult, null, { timeout: 60000 });
    await win.waitForTimeout(300);
    await story.frame('after-simplify-b');

    // Step B7: GAP-CLOSURE assertions — tiny features were REMOVED.
    const mPostB = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    const simplifyStat = await win.evaluate(() => window.__lastSimplifyResult);
    console.log(`  [B] Simplified (micro-fillet removed): vol=${mPostB.volume.toFixed(0)}, ` +
      `faces ${mPreB.faceCount}→${mPostB.faceCount}, removedFeatures=${simplifyStat.removedFeatures}`);

    // The micro-fillet faces must be GONE — face count drops sharply.
    expect(mPostB.faceCount).toBeLessThan(mPreB.faceCount);
    // The op must report that it removed tiny features (the P5 closed gap).
    expect(simplifyStat, 'Simplify must publish a result stat').toBeTruthy();
    expect(simplifyStat.removedFeatures,
      'Simplify must report > 0 tiny features removed').toBeGreaterThan(0);
    // Removing r=0.4 micro-fillets reverts material toward the sharp box —
    // a tiny change; the simplified body must still be substantial.
    expect(mPostB.volume).toBeGreaterThan(mPreB.volume * 0.97);
    expect(mPostB.volume).toBeLessThan(mPreB.volume * 1.03);


    // ══════════════════════════════════════════════════════════════════════════
    // Workflow C — block with through-hole cleanup
    // Box (40³) + Cylinder (r=20, h=40) → Subtract → select result → Simplify
    // Note: origin crowding risk managed by doing the clickBody on the Box
    // BEFORE the Cylinder is built, then using addToSelection for the cylinder
    // so the subtract op gets both bodies.
    // ══════════════════════════════════════════════════════════════════════════

    // Step C1: Build the block (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  [C] Box (block blank) id: ${boxId}`);

    // Key-frame: just the box before the cylinder is added.
    await story.frame('input-c-box');
    await dragOrbit(win, { dx: 200, dy: 80 });
    await story.frame('input-c-box-3d');

    // Step C2: Build the drill cylinder (r=20, h=40).
    const cylId = await buildPrimitive(win, 'Cylinder');
    console.log(`  [C] Cylinder (drill) id: ${cylId}`);

    // Key-frame: both input bodies visible.
    await story.frame('input-c-both');

    // Step C3: Select box as base (REAL click), add cylinder as tool.
    await clickBody(win, boxId);
    await addToSelection(win, cylId);

    // Step C4: Subtract — block with through-hole.
    const idBeforeSubtr = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('subtract-c-dialog');
    await clickRibbonTool(win, 'Subtract');

    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeSubtr,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-subtract-c');

    // Grab the subtracted body's registry id.
    const holeBlockId = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      if (reg && reg.bodies && reg.bodies.length > 0) {
        return reg.bodies[reg.bodies.length - 1].id;
      }
      return window.__lastBrepShape && window.__lastBrepShape.id;
    });
    console.log(`  [C] Subtracted body id: ${holeBlockId}`);

    // Baseline of the subtracted body.
    const mPreC = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  [C] Block with hole: vol=${mPreC.volume.toFixed(0)}, faces=${mPreC.faceCount}`);
    expect(mPreC.volume).toBeGreaterThan(0);

    // Step C5: REAL viewport click on the subtracted body, then Simplify.
    await clickBody(win, holeBlockId);

    const idBeforeC = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    await clickRibbonTab(win, 'Direct Edit');
    await win.waitForTimeout(120);
    await story.frame('simplify-c-dialog');
    await clickRibbonTool(win, 'Simplify Geometry');

    // Step C6: Wait for Simplify result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeC,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-simplify-c');

    // Step C7: Post-simplify assertions.
    const mPostC = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  [C] Simplified (block with hole): vol=${mPostC.volume.toFixed(0)}, faces=${mPostC.faceCount}`);

    // Volume preserved within 0.5%.
    expect(mPostC.volume).toBeGreaterThan(0);
    expect(mPostC.volume).toBeGreaterThan(mPreC.volume * 0.995);
    expect(mPostC.volume).toBeLessThan(mPreC.volume * 1.005);
    expect(mPostC.faceCount).toBeLessThanOrEqual(mPreC.faceCount);

    // ── Closing orbit sweep ───────────────────────────────────────────────────
    const cap = await captureAllAngles(win, 'simplify', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input-weldedplate\.png$/.test(f));
    const outputStill = stills.find(f => /-after-simplify-c\.png$/.test(f));
    expect(inputStill, 'an input-weldedplate still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-simplify-c still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-simplify-c still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);

  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
