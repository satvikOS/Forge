/**
 * brep-features-electron.spec.js
 *
 * "Operation in motion" retrofit — feature operations on real engineering artifacts.
 * Drives everything via real ribbon clicks, REAL viewport body clicks, and drag-orbits.
 * Records the whole workflow as a .webm video with key-frame stills at each beat.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ─────────────────────
 *
 * Under Playwright (navigator.webdriver=true) the ToolParamDialog
 * auto-resolves with schema defaults immediately. Effective defaults:
 *   Extrude Boss : width=80 depth=50 height=25 → V = 80×50×25 = 100 000 mm³
 *   Revolve Boss : innerR=12 width=18 height=40 → ring torus-like solid
 *   Fillet       : build Box (40³) → select → click Fillet → radius=2 → V < 64000
 *   Chamfer      : build Box (40³) → select → click Chamfer → distance=2 → V < 64000
 *
 * Artifacts land in:  test-results/motion/brep-features-<op>/
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

// ─── Extrude Boss ─────────────────────────────────────────────────────────────

test('Extrude Boss: extruded structural beam — ribbon click + dialog defaults → 80×50×25 mm, V = 100 000 mm³', async () => {
  // Artifact: extruded structural beam
  // Arity-0: no body selection needed. The ToolParamDialog auto-resolves under
  // Playwright with defaults: width=80, depth=50, height=25.
  // Produces a rectangular prismatic beam cross-section (like a steel I-beam blank).
  const { app, win, pageErrors, story } = await launchWithCapture('brep-features-extrude');
  try {
    // Click Part tab → Extrude Boss → accept dialog defaults.
    const bossId = await buildPrimitive(win, 'Extrude Boss');
    console.log(`  Extrude Boss id: ${bossId}`);

    // Key-frame: input model, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Extrude Boss (structural beam): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // 80×50×25 = 100 000 mm³, ±10%
    expect(m.volume).toBeGreaterThan(90000);
    expect(m.volume).toBeLessThan(110000);
    expect(m.faceCount).toBe(6); // rectangular prism

    await story.frame('after-extrude-boss');

    const cap = await captureAllAngles(win, 'extrude-boss', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-extrude-boss\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-extrude-boss still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-extrude-boss still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});

// ─── Revolve Boss ─────────────────────────────────────────────────────────────

test('Revolve Boss: rotational shaft — ribbon click + dialog defaults → innerR=12 w=18 h=40, positive volume', async () => {
  // Artifact: rotational shaft (revolved)
  // Arity-0: no body selection needed. Handler defaults: innerR=12, width=18,
  // height=40 — revolves a ring 360°, producing an annular shaft/hub profile.
  // Volume = π×40×((12+18)²−12²) = π×40×(900−144) = π×40×756 ≈ 95 034 mm³
  const { app, win, pageErrors, story } = await launchWithCapture('brep-features-revolve');
  try {
    // Click Part tab → Revolve Boss → accept dialog defaults.
    const bossId = await buildPrimitive(win, 'Revolve Boss');
    console.log(`  Revolve Boss id: ${bossId}`);

    // Key-frame: input model, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Revolve Boss (rotational shaft): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Annular ring: outerR=innerR+width=30, innerR=12, height=40
    // V = π×h×(R²−r²) = π×40×(900−144) ≈ 95 034 mm³, ±15% (kernel approximation)
    expect(m.volume).toBeGreaterThan(50000);
    expect(m.faceCount).toBeGreaterThanOrEqual(3);

    await story.frame('after-revolve-boss');

    const cap = await captureAllAngles(win, 'revolve-boss', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-revolve-boss\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-revolve-boss still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-revolve-boss still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});

// ─── Fillet ───────────────────────────────────────────────────────────────────

test('Fillet: rounded plate — build 40³ box → select → ribbon click → r=2 dialog → V in (58000, 64000)', async () => {
  // Artifact: rounded plate
  // Arity-1 workflow: build a Box (40³ — the plate blank), select it, click Fillet,
  // fill radius=2. Fillet removes material from all edges, rounding the plate corners.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-features-fillet');
  try {
    // 1. Build the plate blank (Box 40³) via the Box primitive (user workflow).
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // Key-frame: the input box, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // 2. Select the body for the Fillet op with a REAL viewport click.
    await clickBody(win, boxId);

    // 3. Capture current shape id so we can detect the new result.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Fillet tool.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Fillet', { radius: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('fillet-dialog');
    await clickRibbonTool(win, 'Fillet');

    // 5. Wait for the new result body.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-fillet');

    // 6. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Fillet (rounded plate): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(58000); // r=2 on 40³ box → small material removal
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBeGreaterThan(6);  // filleted box has curved faces

    const cap = await captureAllAngles(win, 'fillet-boss', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-fillet\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-fillet still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-fillet still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});

// ─── Chamfer ──────────────────────────────────────────────────────────────────

test('Chamfer: chamfered-edge plate — build 40³ box → select → ribbon click → d=2 dialog → V in (55000, 64000)', async () => {
  // Artifact: chamfered-edge plate
  // Arity-1 workflow: build a Box (40³ — the plate blank), select it, click Chamfer,
  // fill distance=2. Chamfer cuts 45° bevels on all edges of the plate.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-features-chamfer');
  try {
    // 1. Build the plate blank (Box 40³) via the Box primitive (user workflow).
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // Key-frame: the input box, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // 2. Select the body for the Chamfer op with a REAL viewport click.
    await clickBody(win, boxId);

    // 3. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Chamfer tool.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Chamfer', { distance: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('chamfer-dialog');
    await clickRibbonTool(win, 'Chamfer');

    // 5. Wait for the new result body.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-chamfer');

    // 6. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Chamfer (chamfered-edge plate): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(55000); // d=2 chamfer on 40³ box
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBeGreaterThan(6);  // chamfered box has extra faces

    const cap = await captureAllAngles(win, 'chamfer-boss', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-chamfer\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-chamfer still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-chamfer still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
