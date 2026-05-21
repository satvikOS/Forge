/**
 * brep-ribbon-electron.spec.js
 *
 * "Operation in motion" tests — verifies that kernel operations are genuinely
 * wired into the ribbon toolbar. For each tested tool: switch to the correct
 * ribbon tab, click the ribbon button, wait for window.__lastBrepShape to
 * update, measure via the kernel, assert real geometry (volume > 0,
 * faceCount >= 1), and confirm zero pageErrors.
 *
 * ── MOTION-CAPTURE PATTERN (see brep-g-catmullclark-electron.spec.js) ────────
 * - launchWithCapture() records the whole workflow as a .webm video.
 * - clickBody() — REAL viewport mouse click — replaces selectBodies() for
 *   arity-1 ops (Fillet). For arity-2 (Combine): clickBody() selects the first
 *   body; addToSelection() adds the second (viewport has no modifier-click branch).
 * - story.frame(label) drops NN-<label>.png stills at each meaningful beat.
 * - dragOrbit() shows the model in 3D with real drag gestures.
 * - NOTE: arity-0 primitives (Box, Cylinder, Sphere) use no clickBody — they
 *   are creation ops that construct geometry from scratch.
 *
 * All five ribbon tools are exercised in a single session to avoid the
 * Playwright Electron recordVideo teardown race that affects back-to-back
 * multi-test files (each would launch its own Electron instance and the
 * second app's screenshots would silently not write).
 *
 * Artifacts: test-results/motion/brep-ribbon/ (00-session.webm + NN-*.png)
 *
 * Tools covered: Box (primitive), Cylinder (primitive), Sphere (primitive),
 * Fillet (feature/modify), Combine (boolean).
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, addToSelection, dragOrbit,
} from './helpers/motionCapture.js';

const SHOT = path.resolve(__dirname, 'screenshots');

test.setTimeout(600000); // Kernel WASM is 50 MB; allow up to 10 min cold-load

// ─── All five ribbon tools in one motion-capture session ─────────────────────

test('ribbon: Box, Cylinder, Sphere (primitives), Fillet (arity-1), Combine (arity-2) — all ribbon tools wired to ArchDisc exact B-rep kernel', async () => {
  // Five ribbon tools in one session — avoids the Playwright Electron
  // recordVideo teardown race that silently breaks screenshots in back-to-back
  // multi-test files.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-ribbon');
  fs.mkdirSync(SHOT, { recursive: true });

  // Pre-warm kernel WASM (cached after first call)
  await win.waitForFunction(async () => {
    try {
      const oc = await window.__archdiscKernel.getOCCT();
      window.__occtPreWarmed = { ok: true };
    } catch (e) {
      window.__occtPreWarmed = { ok: false, error: String(e) };
    }
    return !!window.__occtPreWarmed;
  }, null, { timeout: 300000 });

  const occtReady = await win.evaluate(() => window.__occtPreWarmed);
  expect(occtReady.ok, `Kernel load failed: ${occtReady.error ?? 'unknown'}`).toBe(true);

  try {
    // ── Box ──────────────────────────────────────────────────────────────────
    // Artifact: test cube — the simplest engineering primitive, proves Box ribbon wiring.
    // Arity-0 primitive: no clickBody needed — Box is a creation op from scratch.
    // Build box FIRST (single body in scene) so the Fillet step can select it.
    const boxId = await buildPrimitive(win, 'Box');
    await story.frame('input-box');
    await dragOrbit(win, { dx: 200, dy: 80 });
    await story.frame('box-3d');

    const boxMetrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Box: vol=${boxMetrics.volume.toFixed(0)}, faces=${boxMetrics.faceCount}, edges=${boxMetrics.edgeCount}`);
    expect(boxMetrics.volume).toBeGreaterThan(63000);
    expect(boxMetrics.volume).toBeLessThan(65000);
    expect(boxMetrics.faceCount).toBe(6);
    expect(boxMetrics.edgeCount).toBe(12);

    const shotBox = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'ribbon-box.png'),
    });
    expect(shotBox.length).toBeGreaterThan(2000);

    // ── Fillet ────────────────────────────────────────────────────────────────
    // Artifact: rounded plate — the Box(40³) above with all edges filleted at r=2mm.
    // A fully-filleted box (12 edges, 8 corners) produces 6 flat + 12 fillet + 8 corner = 26 faces.
    // Arity-1: select the box with a REAL viewport click (only 1 body in scene,
    // so the raycast will unambiguously hit boxId).
    await clickBody(win, boxId);

    const idBeforeFillet = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    await injectToolParams(win, 'Fillet', { radius: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('fillet-dialog');
    await clickRibbonTool(win, 'Fillet');

    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet,
      { timeout: 60000 },
    );
    await win.waitForTimeout(400);
    await story.frame('after-fillet');
    await dragOrbit(win, { dx: -160, dy: 100 });
    await story.frame('after-fillet-3d');

    const filletMetrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Fillet (rounded plate): vol=${filletMetrics.volume.toFixed(0)}, faces=${filletMetrics.faceCount}, edges=${filletMetrics.edgeCount}`);
    expect(filletMetrics.volume).toBeGreaterThan(0);
    expect(filletMetrics.volume).toBeLessThan(64000); // volume drop confirms fillet material removal
    expect(filletMetrics.faceCount).toBe(26);

    const shotFillet = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'ribbon-fillet.png'),
    });
    expect(shotFillet.length).toBeGreaterThan(2000);

    // ── Cylinder ─────────────────────────────────────────────────────────────
    // Artifact: shaft stub — a cylindrical stock piece, proves Cylinder ribbon wiring.
    // Arity-0 primitive: no clickBody needed — Cylinder is a creation op from scratch.
    await buildPrimitive(win, 'Cylinder');
    await story.frame('input-cylinder');
    await dragOrbit(win, { dx: -180, dy: 80 });
    await story.frame('cylinder-3d');

    const cylMetrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Cylinder: vol=${cylMetrics.volume.toFixed(0)}, faces=${cylMetrics.faceCount}, edges=${cylMetrics.edgeCount}`);
    // r=20mm h=40mm → π×400×40 ≈ 50265 mm³
    expect(cylMetrics.volume).toBeGreaterThan(0);
    expect(cylMetrics.faceCount).toBeGreaterThanOrEqual(3); // top, bottom, lateral

    const shotCyl = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'ribbon-cylinder.png'),
    });
    expect(shotCyl.length).toBeGreaterThan(2000);

    // ── Sphere ────────────────────────────────────────────────────────────────
    // Artifact: bearing ball — a precision spherical component, proves Sphere ribbon wiring.
    // Arity-0 primitive: no clickBody needed — Sphere is a creation op from scratch.
    await buildPrimitive(win, 'Sphere');
    await story.frame('input-sphere');
    await dragOrbit(win, { dx: 200, dy: -80 });
    await story.frame('sphere-3d');

    const sphMetrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Sphere: vol=${sphMetrics.volume.toFixed(0)}, faces=${sphMetrics.faceCount}, edges=${sphMetrics.edgeCount}`);
    // r=25mm → (4/3)π×15625 ≈ 65450 mm³
    expect(sphMetrics.volume).toBeGreaterThan(0);
    expect(sphMetrics.faceCount).toBeGreaterThanOrEqual(1);

    const shotSph = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'ribbon-sphere.png'),
    });
    expect(shotSph.length).toBeGreaterThan(2000);

    // ── Combine ───────────────────────────────────────────────────────────────
    // Artifact: mounting block with boss — two Box(40³) bodies fused.
    // Arity-2: build two Boxes via ribbon, select first with clickBody (REAL
    // viewport click), add second with addToSelection (selectMany path, same as
    // Body Browser — the viewport click handler has no modifier branch), click Combine.
    // The two boxes are built on top of the fillet result + cylinder + sphere scene.
    // clickBody uses frameBody + raycast grid to find the correct body even in a
    // crowded scene (centre-outward scan, hits nearest pickable in target group).
    const comb1Id = await buildPrimitive(win, 'Box');
    const comb2Id = await buildPrimitive(win, 'Box');
    await story.frame('input-combine-boxes');
    await dragOrbit(win, { dx: 180, dy: 80 });
    await story.frame('combine-input-3d');

    await clickBody(win, comb1Id);
    await addToSelection(win, comb2Id);

    const idBeforeCombine = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('combine-dialog');
    await clickRibbonTool(win, 'Combine');

    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeCombine,
      { timeout: 60000 },
    );
    await win.waitForTimeout(400);
    await story.frame('after-combine');
    await dragOrbit(win, { dx: -160, dy: 100 });
    await story.frame('after-combine-3d');

    const combineMetrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Combine: vol=${combineMetrics.volume.toFixed(0)}, faces=${combineMetrics.faceCount}, edges=${combineMetrics.edgeCount}`);
    expect(combineMetrics.volume).toBeGreaterThan(0);
    expect(combineMetrics.faceCount).toBeGreaterThanOrEqual(1);

    const shotCombine = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'ribbon-combine.png'),
    });
    expect(shotCombine.length).toBeGreaterThan(2000);

    expect(pageErrors).toEqual([]);

    // ── Verify the storyboard stills exist and are non-trivial ─────────────────
    const stills = story.frames();
    const inputStill   = stills.find(f => /-input-box\.png$/.test(f));
    const filletStill  = stills.find(f => /-after-fillet\.png$/.test(f));
    const combineStill = stills.find(f => /-after-combine\.png$/.test(f));
    expect(inputStill,   'an input-box still must have been captured').toBeTruthy();
    expect(filletStill,  'an after-fillet still must have been captured').toBeTruthy();
    expect(combineStill, 'an after-combine still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input-box still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(filletStill).size,
      'after-fillet still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(combineStill).size,
      'after-combine still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
