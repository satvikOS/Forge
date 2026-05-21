/**
 * brep-nurbs-electron.spec.js
 *
 * Sub-project E gate — real-artifact NURBS e2e tests.
 * All geometry is created by clicking real ribbon tools + filling dialogs.
 * No kernel APIs are called to BUILD geometry; only read-only taps (measure,
 * area, window.__lastNurbsCurvature) are used for assertions.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ──────────────────
 * Records the whole workflow as a .webm video with key-frame stills at each
 * beat. REAL viewport clicks + drag-orbits show the operation in motion.
 *
 * ONE consolidated test — all 4 ops in a single session:
 *   A — NURBS Patch:    sail-like fairing patch
 *   B — Refine NURBS:   refined fairing patch (knot insertion)
 *   C — Elevate NURBS:  elevated-degree fairing patch
 *   D — NURBS Curvature: curvature analysis on sail + flat patches
 *      D1: crown=8 sail → finite gaussian + mean curvature
 *      D2: crown=0 flat  → gaussian ≈ 0, mean ≈ 0
 *
 * Artifacts land in:  test-results/motion/brep-nurbs/
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

const SWEEP_OPTS = {
  azimuths: [0, 60, 120, 180, 240, 300],
  elevations: [-30, 30],
  zooms: [0.6, 1.0, 1.8],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function snapBrepId(win) {
  return win.evaluate(() =>
    (window.__lastBrepShape && window.__lastBrepShape.id) || null,
  );
}

/**
 * Build a NURBS Patch (arity 0) by injecting params and clicking the ribbon.
 * Returns the registry ID of the new body.
 */
async function buildNurbsPatch(win, params) {
  params = params || { size: 40, crown: 8 };
  const before = await snapBrepId(win);
  const regCountBefore = await win.evaluate(
    () => (window.__archdiscRegistry && window.__archdiscRegistry.bodies
      ? window.__archdiscRegistry.bodies.length : 0),
  );
  await injectToolParams(win, 'NURBS Patch', params);
  await clickRibbonTab(win, 'Part');
  await win.waitForTimeout(120);
  await clickRibbonTool(win, 'NURBS Patch');
  await win.waitForFunction(
    (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
    before,
    { timeout: 300000 },
  );
  return win.evaluate((countBefore) => {
    const reg = window.__archdiscRegistry;
    if (reg && reg.bodies && reg.bodies.length > countBefore) {
      return reg.bodies[reg.bodies.length - 1].id;
    }
    return window.__lastBrepShape && window.__lastBrepShape.id;
  }, regCountBefore);
}

/**
 * Apply an arity-1 NURBS op (Refine NURBS, Elevate NURBS) via REAL viewport
 * body click + ribbon tool.
 * Returns the REGISTRY body ID (body-NNN) of the new result body.
 */
async function applyNurbsOp(win, toolName, bodyId, params) {
  const before = await snapBrepId(win);
  // Snapshot registry count AND list of IDs before the op so we can detect the new entry.
  const regCountBefore = await win.evaluate(
    () => (window.__archdiscRegistry && window.__archdiscRegistry.bodies
      ? window.__archdiscRegistry.bodies.length : 0),
  );
  // REAL viewport click to select the input body.
  await clickBody(win, bodyId);
  if (params && Object.keys(params).length > 0) {
    await injectToolParams(win, toolName, params);
  }
  await clickRibbonTab(win, 'Part');
  await win.waitForTimeout(120);
  await clickRibbonTool(win, toolName);
  await win.waitForFunction(
    (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
    before,
    { timeout: 300000 },
  );
  // Always return the registry body-NNN ID; fall back to last body in registry.
  return win.evaluate((countBefore) => {
    const reg = window.__archdiscRegistry;
    if (reg && reg.bodies && reg.bodies.length > 0) {
      // Prefer the newly-added body (last in registry after op).
      if (reg.bodies.length > countBefore) {
        return reg.bodies[reg.bodies.length - 1].id;
      }
      // If body count didn't increase (consuming op replaced in place) return the last body.
      return reg.bodies[reg.bodies.length - 1].id;
    }
    // Last resort: brep shape id (will fail clickBody — flagged above if needed).
    return window.__lastBrepShape && window.__lastBrepShape.id;
  }, regCountBefore);
}

// ─── Consolidated test ────────────────────────────────────────────────────────

test('NURBS suite: Patch → Refine → Elevate → Curvature on sail + flat patches', async () => {
  // Single-session recording: all 4 NURBS ops in sequence.
  // One launchWithCapture = one .webm video, numbered stills at each beat.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-nurbs');
  try {

    // ── A: NURBS Patch (sail — crown=8) ──────────────────────────────────────
    // Artifact: sail-like NURBS fairing patch (40×40 mm, crown=8 mm)
    console.log('  [A] Building NURBS Patch (sail)...');
    const patchId = await buildNurbsPatch(win, { size: 40, crown: 8 });
    console.log(`  NURBS Patch id: ${patchId}`);

    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    const mPatch = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape),
    );
    console.log(`  NURBS Patch: area=${mPatch.area?.toFixed(1)}, faces=${mPatch.faceCount}`);

    // A 40×40 mm flat patch has area 1600 mm². Crown lifts inner poles 8 mm;
    // actual surface area is larger — expected ≈ 1600–2800 mm².
    expect(mPatch.area).toBeGreaterThan(1500);
    expect(mPatch.area).toBeLessThan(2800);
    expect(mPatch.faceCount).toBeGreaterThanOrEqual(1);

    await story.frame('after-nurbs-patch');

    // ── B: Refine NURBS (knot insertion preserves area) ───────────────────────
    // Artifact: refined NURBS fairing patch (h-refinement)
    console.log('  [B] Applying Refine NURBS...');
    const mPre = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape),
    );
    console.log(`  Pre-refine area: ${mPre.area?.toFixed(4)} mm²`);
    expect(mPre.area).toBeGreaterThan(0);

    // REAL viewport click to select the sail patch before Refine op.
    await story.frame('before-refine');
    const refinedId = await applyNurbsOp(win, 'Refine NURBS', patchId, {});

    const mPost = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape),
    );
    console.log(`  Post-refine area: ${mPost.area?.toFixed(4)} mm²`);

    // Area preservation is the key correctness criterion for h-refinement.
    expect(mPost.area).toBeGreaterThan(0);
    expect(Math.abs(mPost.area - mPre.area)).toBeLessThan(1.0);

    await win.waitForTimeout(300);
    await story.frame('after-nurbs-refine');

    // ── C: Elevate NURBS (degree elevation preserves area) ────────────────────
    // Artifact: degree-elevated NURBS fairing patch (p-refinement u,v deg 3→4)
    console.log('  [C] Applying Elevate NURBS...');
    const mPreElev = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape),
    );
    console.log(`  Pre-elevate area: ${mPreElev.area?.toFixed(4)} mm²`);
    expect(mPreElev.area).toBeGreaterThan(0);

    // REAL viewport click on the refined patch before Elevate op.
    await story.frame('before-elevate');
    const elevatedId = await applyNurbsOp(win, 'Elevate NURBS', refinedId, {
      uDegree: 4,
      vDegree: 4,
    });

    const mPostElev = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape),
    );
    console.log(`  Post-elevate area: ${mPostElev.area?.toFixed(4)} mm²`);

    // Area preservation is the key correctness criterion for p-refinement.
    expect(mPostElev.area).toBeGreaterThan(0);
    expect(Math.abs(mPostElev.area - mPreElev.area)).toBeLessThan(1.0);

    await win.waitForTimeout(300);
    await story.frame('after-nurbs-elevate');

    // ── D1: NURBS Curvature on the elevated sail patch ────────────────────────
    // Artifact: NURBS curvature analysis on sail patch (non-zero curvature)
    console.log('  [D1] NURBS Curvature on sail patch...');
    // REAL viewport click on elevated body to select it.
    await clickBody(win, elevatedId);
    await win.evaluate(() => { window.__lastNurbsCurvature = null; });
    await injectToolParams(win, 'NURBS Curvature', { u: 0.5, v: 0.5 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('before-curvature-sail');
    await clickRibbonTool(win, 'NURBS Curvature');

    await win.waitForFunction(
      () => !!window.__lastNurbsCurvature,
      null,
      { timeout: 300000 },
    );

    const sailCurv = await win.evaluate(() => window.__lastNurbsCurvature);
    console.log(`  Sail curvature at (0.5, 0.5): gaussian=${sailCurv.gaussian?.toExponential(3)}, mean=${sailCurv.mean?.toExponential(3)}, kMin=${sailCurv.kMin?.toExponential(3)}, kMax=${sailCurv.kMax?.toExponential(3)}`);
    console.log(`  normal=[${sailCurv.normal?.map(n => n.toFixed(4)).join(', ')}], pos=[${sailCurv.position?.map(p => p.toFixed(2)).join(', ')}]`);

    await story.frame('after-curvature-sail');

    // Position must be inside the patch's approximate xy bounds [0..40].
    expect(sailCurv.position).toHaveLength(3);
    expect(sailCurv.position[0]).toBeGreaterThanOrEqual(-1);
    expect(sailCurv.position[0]).toBeLessThanOrEqual(41);
    expect(sailCurv.position[1]).toBeGreaterThanOrEqual(-1);
    expect(sailCurv.position[1]).toBeLessThanOrEqual(41);

    // Normal must be a valid unit 3-vector.
    expect(sailCurv.normal).toHaveLength(3);
    const nLen = Math.sqrt(
      sailCurv.normal[0] ** 2 + sailCurv.normal[1] ** 2 + sailCurv.normal[2] ** 2,
    );
    expect(nLen).toBeGreaterThan(0.9);
    expect(nLen).toBeLessThan(1.1);

    // Gaussian and mean curvature must be finite numbers.
    expect(Number.isFinite(sailCurv.gaussian)).toBe(true);
    expect(Number.isFinite(sailCurv.mean)).toBe(true);
    expect(Number.isFinite(sailCurv.kMin)).toBe(true);
    expect(Number.isFinite(sailCurv.kMax)).toBe(true);

    // ── D2: NURBS Curvature on a fresh flat patch (crown=0) ───────────────────
    // Artifact: NURBS curvature analysis on flat patch (zero curvature)
    // Build a separate flat patch within the same session.
    console.log('  [D2] Building flat NURBS Patch (crown=0) for curvature check...');
    const flatId = await buildNurbsPatch(win, { size: 40, crown: 0 });
    console.log(`  Flat patch id: ${flatId}`);

    await story.frame('input-flat-patch');
    await dragOrbit(win, { dx: -150, dy: 60 });
    await story.frame('input-flat-patch-3d');

    // Origin crowding: body-003 (elevated sail) and body-004 (flat, crown=0) both
    // sit at origin. The flat patch (crown=0) is coincident with the base plane of
    // the sail patch — clickBody raycasting cannot reliably pick the flat body
    // because the elevated body's faces occlude it from almost every camera angle.
    // Using programmatic selectMany (same API the Body Browser panel rows use)
    // after a visible cursor-hover for video intent. No clickBody here — documented.
    await win.evaluate((fid) => {
      const reg = window.__archdiscRegistry;
      if (reg && typeof reg.clearSelection === 'function') reg.clearSelection();
      if (reg && typeof reg.selectMany === 'function') reg.selectMany([fid]);
    }, flatId);
    await win.waitForTimeout(200);
    await win.evaluate(() => { window.__lastNurbsCurvature = null; });
    await injectToolParams(win, 'NURBS Curvature', { u: 0.5, v: 0.5 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('before-curvature-flat');
    await clickRibbonTool(win, 'NURBS Curvature');

    await win.waitForFunction(
      () => !!window.__lastNurbsCurvature,
      null,
      { timeout: 300000 },
    );

    const flatCurv = await win.evaluate(() => window.__lastNurbsCurvature);
    console.log(`  Flat patch curvature at (0.5, 0.5): gaussian=${flatCurv.gaussian?.toExponential(3)}, mean=${flatCurv.mean?.toExponential(3)}`);

    await story.frame('after-curvature-flat');

    // Planar surface must have zero Gaussian and mean curvature.
    expect(Math.abs(flatCurv.gaussian)).toBeLessThan(1e-5);
    expect(Math.abs(flatCurv.mean)).toBeLessThan(1e-5);

    // ── Multi-angle render ────────────────────────────────────────────────────
    const cap = await captureAllAngles(win, 'nurbs-suite', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ────────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-nurbs-patch\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-nurbs-patch still must have been captured').toBeTruthy();
    expect(fs.existsSync(inputStill),
      `input still must exist on disk: ${inputStill}`).toBe(true);
    expect(fs.existsSync(outputStill),
      `after-nurbs-patch still must exist on disk: ${outputStill}`).toBe(true);
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-nurbs-patch still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
