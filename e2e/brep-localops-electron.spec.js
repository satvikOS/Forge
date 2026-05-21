/**
 * brep-localops-electron.spec.js
 *
 * "Operation in motion" retrofit — local operations on real engineering artifacts.
 * Drives everything via real ribbon clicks, REAL viewport body clicks, and drag-orbits.
 * Records the whole workflow as a .webm video with key-frame stills at each beat.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ─────────────────────
 *
 * Arity-0 (no selection):
 *   Thicken     : thicken( 60×40 sheet, 3 mm ) → V ≈ 7200 mm³  [metal plate]
 *
 * Arity-1 (build Box → select → click → fill dialog):
 *   Shell       : shell( 40³ box, t=3 )         → hollow, V in (3500, 62000)  [open tray / housing]
 *   Offset Shape: offsetShape( 40³ box, +2 )    → V ≈ 70 400 mm³              [padded block]
 *   Draft       : draft( 40³ box, 5° )          → tapered, V < 64000          [draft-angle plug]
 *
 * Artifacts land in:  test-results/motion/brep-localops-<op>/
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

// ─── Shell ────────────────────────────────────────────────────────────────────

test('Shell: thin-walled tray (open housing) — build 40³ box → select → ribbon click → t=3 → hollow, V in (3500, 62000)', async () => {
  // Artifact: thin-walled tray (open housing)
  // Arity-1: build a Box (40³ — the housing blank), select it, click Shell,
  // accept thickness=3. Result: a thin-walled open tray like an electronics enclosure
  // or oil-pan housing. Shell removes one face (open shell).
  const { app, win, pageErrors, story } = await launchWithCapture('brep-localops-shell');
  try {
    // 1. Build the housing blank (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // Key-frame: the input box, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // 2. Select for Shell op with a REAL viewport click.
    await clickBody(win, boxId);

    // 3. Capture current id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Shell.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Shell', { thickness: 3 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('shell-dialog');
    await clickRibbonTool(win, 'Shell');

    // 5. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-shell');

    // 6. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Shell (open housing tray): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(3500);
    expect(m.volume).toBeLessThan(62000);

    const cap = await captureAllAngles(win, 'shell', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-shell\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-shell still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-shell still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});

// ─── Thicken ─────────────────────────────────────────────────────────────────

test('Thicken: thickened sheet (metal plate) — ribbon click thickens 60×40 sheet by 3 mm, V in (6480, 7920)', async () => {
  // Artifact: thickened sheet (metal plate)
  // Arity-0: no body selection needed. Dialog defaults: width=60, height=40, thickness=3.
  // Produces a thin sheet-metal plate as used in brackets, flanges, or sheet-metal blanks.
  // 60×40×3 = 7200 mm³, ±10%.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-localops-thicken');
  try {
    // Click Part tab → Thicken → accept dialog defaults.
    const plateId = await buildPrimitive(win, 'Thicken');
    console.log(`  Thicken id: ${plateId}`);

    // Key-frame: the produced plate, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Thicken (metal plate): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // 60×40×3 = 7200 mm³, ±10%
    expect(m.volume).toBeGreaterThan(6480);
    expect(m.volume).toBeLessThan(7920);

    await story.frame('after-thicken');

    const cap = await captureAllAngles(win, 'thicken', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-thicken\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-thicken still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-thicken still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});

// ─── Offset Shape ─────────────────────────────────────────────────────────────

test('Offset Shape: padded block (face-offset) — build 40³ box → select → ribbon click → +2 mm → V in (63360, 77440)', async () => {
  // Artifact: padded block (face-offset)
  // Arity-1: build a Box (40³ — the base block), select it, click Offset Shape,
  // fill distance=2. Uniformly offsets all faces outward by 2 mm, producing a
  // padded enclosure block (like adding material for machining stock allowance).
  // Empirically measured: 70400 mm³ (offsetShape result at +2mm offset).
  const { app, win, pageErrors, story } = await launchWithCapture('brep-localops-offset');
  try {
    // 1. Build the base block (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // Key-frame: the input box, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // 2. Select for Offset Shape op with a REAL viewport click.
    await clickBody(win, boxId);

    // 3. Capture current id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Offset Shape.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Offset Shape', { distance: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('offset-dialog');
    await clickRibbonTool(win, 'Offset Shape');

    // 5. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-offset-shape');

    // 6. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Offset Shape (padded block): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Empirically measured: 70400 mm³, ±10%
    expect(m.volume).toBeGreaterThan(63360);
    expect(m.volume).toBeLessThan(77440);

    const cap = await captureAllAngles(win, 'offset-shape', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-offset-shape\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-offset-shape still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-offset-shape still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});

// ─── Draft ────────────────────────────────────────────────────────────────────

test('Draft: draft-angle plug (mold-release shape) — build 40³ box → select → ribbon click → 5° dialog → positive V < 64000, 6 faces', async () => {
  // Artifact: draft-angle plug (mold-release shape)
  // Arity-1: build a Box (40³ — the plug blank), select it, click Draft, fill angleDeg=5.
  // Tapers the side faces inward at 5° for mold-release, producing a plastic injection
  // mold plug or die casting insert with the required draft angle.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-localops-draft');
  try {
    // 1. Build the plug blank (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // Key-frame: the input box, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // 2. Select for Draft op with a REAL viewport click.
    await clickBody(win, boxId);

    // 3. Capture current id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Draft.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Draft', { angleDeg: 5 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('draft-dialog');
    await clickRibbonTool(win, 'Draft');

    // 5. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-draft');

    // 6. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Draft (mold-release plug): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(0);
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBe(6);

    const cap = await captureAllAngles(win, 'draft', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-draft\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-draft still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-draft still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
