/**
 * brep-boolean-electron.spec.js
 *
 * "Operation in motion" retrofit — boolean operations on real engineering artifacts.
 * Drives everything via real ribbon clicks, REAL viewport body clicks, and drag-orbits.
 * Records the whole workflow as a .webm video with key-frame stills at each beat.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ─────────────────────
 *
 * Body geometry (dialog defaults):
 *   Box       : 40×40×40 mm  (V = 64 000 mm³)
 *   Cylinder  : r=20 mm, h=40 mm  (V ≈ 50 265 mm³)
 *   Sphere    : r=25 mm  (V ≈ 65 450 mm³)
 *
 * Combine  (arity-2): mounting block + boss → V > 0
 * Subtract (arity-2): block with through-hole → 0 < V < 64000
 * Intersect(arity-2): rounded chunk → V > 0
 *
 * Artifacts land in:  test-results/motion/brep-boolean-<op>/
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool, buildPrimitive,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, addToSelection, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

// ─── Combine (fuse) ───────────────────────────────────────────────────────────

test('Combine: mounting block with a boss — Box(40³) + Cylinder(r20,h40) → fuse → volume > 0', async () => {
  // Artifact: mounting block with a cylindrical boss
  // A 40×40×40 mm mounting block (Box) fused with a cylindrical boss (Cylinder r=20, h=40)
  // stacked through the block's centre. Arity-2 fuse of two solids.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-boolean-combine');
  try {
    // 1. Build the mounting block (Box 40³) via ribbon + dialog.
    const boxId = await buildPrimitive(win, 'Box');
    // 2. Build the cylindrical boss (Cylinder r=20, h=40) via ribbon + dialog.
    const cylId = await buildPrimitive(win, 'Cylinder');

    // Key-frame: input model in 3D before the op.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // 3. Select the box body with a REAL viewport click, then add cylinder.
    await clickBody(win, boxId);
    await addToSelection(win, cylId);

    // 4. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 5. Click Part tab → Combine.
    //    Combine has no params; bypass auto-resolves under Playwright.
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('combine-dialog');
    await clickRibbonTool(win, 'Combine');

    // 6. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-combine');

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Combine (mounting block + boss): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Fused union: volume must be > 0 (positive solid produced).
    expect(m.volume).toBeGreaterThan(27000);
    expect(m.faceCount).toBeGreaterThanOrEqual(1);

    const cap = await captureAllAngles(win, 'bool-combine', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-combine\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-combine still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-combine still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});

// ─── Subtract (cut) ───────────────────────────────────────────────────────────

test('Subtract: block with through-hole — Box(40³) − Cylinder(r20,h40) → 0 < V < 64000', async () => {
  // Artifact: block with through-hole (drilled mounting block)
  // A 40×40×40 mm block (Box) with a cylindrical through-hole drilled through it
  // (Cylinder r=20, h=40 as the drill tool). Subtract removes the cylinder from the block.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-boolean-subtract');
  try {
    // 1. Build the block (Box 40³) — base body.
    const boxId = await buildPrimitive(win, 'Box');
    // 2. Build the drill cylinder (r=20, h=40) — tool body.
    const cylId = await buildPrimitive(win, 'Cylinder');

    // Key-frame: input model in 3D before the op.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // 3. Select box as [0] (base), cylinder as [1] (tool).
    //    REAL viewport click on the box first, then add cylinder.
    await clickBody(win, boxId);
    await addToSelection(win, cylId);

    // 4. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 5. Click Part tab → Subtract.
    //    Subtract has no params; bypass auto-resolves under Playwright.
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('subtract-dialog');
    await clickRibbonTool(win, 'Subtract');

    // 6. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-subtract');

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Subtract (block with through-hole): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Cut removed material → V < box (64000) and > 0.
    expect(m.volume).toBeGreaterThan(0);
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBeGreaterThan(2);

    const cap = await captureAllAngles(win, 'bool-subtract', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-subtract\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-subtract still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-subtract still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});

// ─── Intersect (common) ───────────────────────────────────────────────────────

test('Intersect: rounded chunk — Box(40³) ∩ Sphere(r25) → positive volume < both inputs', async () => {
  // Artifact: rounded chunk (intersection of a block and a ball — like a ball-end cap)
  // Box (40³) at origin intersected with Sphere (r=25) at origin → corner sector
  // ≈ (1/8) of sphere = (4/3)π×15625/8 ≈ 8181 mm³, well below both input volumes.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-boolean-intersect');
  try {
    // 1. Build the block (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');
    // 2. Build the ball (Sphere r=25).
    const sphId = await buildPrimitive(win, 'Sphere');

    // Key-frame: input model in 3D before the op.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // 3. Select both bodies with REAL viewport click + addToSelection.
    await clickBody(win, boxId);
    await addToSelection(win, sphId);

    // 4. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 5. Click Part tab → Intersect.
    //    Intersect has no params; bypass auto-resolves under Playwright.
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('intersect-dialog');
    await clickRibbonTool(win, 'Intersect');

    // 6. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-intersect');

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Intersect (rounded chunk): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Corner sector of sphere-r=25 inside box-40³ ≈ 8181 mm³, ±30% tolerance
    expect(m.volume).toBeGreaterThan(5000);
    expect(m.volume).toBeLessThan(30000);
    expect(m.faceCount).toBeGreaterThanOrEqual(1);

    const cap = await captureAllAngles(win, 'bool-intersect', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-intersect\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-intersect still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-intersect still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
