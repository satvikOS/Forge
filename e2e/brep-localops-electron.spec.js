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

// ─── Thicken — §3.2 thickening sheets, real open-surface input (P8) ──────────

test('Thicken: real open-surface body → watertight solid — build a NURBS Patch (open curved sail surface) → select → Thicken 3 mm → closed solid', async () => {
  // Artifact: a real OPEN SURFACE body — a doubly-curved NURBS sail patch
  // (40×40 mm footprint, 8 mm crown). Thickening THIS — a complex open
  // surface a user actually built — is the §3.2 "thickening sheets" intent:
  // converting a complex open surface into a valid watertight solid.
  //
  // P8 gap-closure: BrepLocalOps.thicken was refactored from building a
  // rectangular face internally (w,h,t params) to doing _pickBodies(1) and
  // thickening the SELECTED body's actual open surface. This test builds a
  // genuine open-surface body via the NURBS Patch ribbon tool, selects it,
  // and applies Thicken — the closed-gap workflow.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-localops-thicken');
  try {
    // 1. Build the open-surface body — a NURBS sail patch (real curved
    //    open surface, NOT an internally-fabricated rectangle).
    const patchId = await buildPrimitive(win, 'NURBS Patch', { size: 40, crown: 8 });
    console.log(`  NURBS Patch (open surface) id: ${patchId}`);

    // Key-frame: the open surface, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // Baseline — the input is an OPEN surface (a sheet), not a closed solid.
    const mSurf = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Open NURBS surface: faces=${mSurf.faceCount}, vol=${mSurf.volume.toFixed(1)}`);
    // An open tessellated sail surface has many faces and ~zero enclosed volume.
    expect(mSurf.faceCount).toBeGreaterThan(1);

    // 2. Select the open-surface body with a REAL viewport click.
    await clickBody(win, patchId);
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 3. Click Thicken — thickens the SELECTED open surface (arity-1).
    //    Inject wall thickness; the op no longer needs width/height (it reads
    //    the selected body's real geometry).
    await injectToolParams(win, 'Thicken', { thickness: 3 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('thicken-dialog');
    await clickRibbonTool(win, 'Thicken');

    // 4. Wait for the thickened solid.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 90000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-thicken');

    // 5. Measure + assert — the open surface is now a watertight solid.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Thicken (open surface → solid): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Thickening a 40×40 mm curved sail by 3 mm encloses a real positive
    // volume — order ~40×40×3 ≈ 4800 mm³ (the curved surface area exceeds the
    // flat footprint, so allow a generous band).
    expect(m.volume).toBeGreaterThan(1000);
    expect(m.volume).toBeLessThan(40000);
    expect(m.faceCount).toBeGreaterThan(0);

    // 6. GAP-CLOSURE assertion — the op consumed the user's REAL open-surface
    //    body (recorded its input face count), not an internal rectangle.
    const tp = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.meta && window.__lastBrepShape.meta.params
    );
    console.log(`  Thicken params: ${JSON.stringify(tp)}`);
    expect(tp, 'thicken must record its params').toBeTruthy();
    expect(tp.thickness).toBe(3);
    // The legacy op had {w,h,thickness}; the closed-gap op records the
    // SELECTED surface's face count — proving it thickened a real body.
    expect(tp.inputFaceCount).toBeGreaterThan(1);

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

// ─── Offset Shape — §3.2 complex face offsetting (P2 parity gap) ──────────────

test('Offset Shape: complex high-curvature surface offset — Box 40³ → Fillet r=8 (curved enclosure) → select → Offset +4 mm → valid solid, NO self-intersection', async () => {
  // Artifact: a heavily-rounded enclosure block (Box 40³ + Fillet r=8 on every
  // edge → 26 curved/flat faces). Offsetting THIS — a high-curvature surface —
  // is the §3.2 "complex face offsetting" case: a naive uniform offset
  // (PerformBySimple) self-intersects where the rolling rounds overlap.
  //
  // P2 gap-closure: BrepLocalOps.offsetShape now uses PerformByJoin with
  // intersection handling (Join=GeomAbs_Intersection, Intersection=true,
  // SelfInter=true). This test exercises a CURVED body and asserts the offset
  // result is a VALID, NON-SELF-INTERSECTING solid — the closed-gap behaviour.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-localops-offset');
  try {
    // 1. Build the enclosure blank (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // Key-frame: the input box, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // 2. Select the box and Fillet every edge at r=8 → a high-curvature
    //    rounded enclosure (the "complex surface" the offset must handle).
    await clickBody(win, boxId);
    const idBeforeFillet = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    await injectToolParams(win, 'Fillet', { radius: 8 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('before-fillet');
    await clickRibbonTool(win, 'Fillet');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-fillet');

    // Registry id of the filleted curved body (body-NNN), for the next click.
    const filletedId = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      if (reg && reg.bodies && reg.bodies.length > 0) {
        return reg.bodies[reg.bodies.length - 1].id;
      }
      return window.__lastBrepShape && window.__lastBrepShape.id;
    });
    const mCurved = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Curved enclosure (Box+Fillet r=8): vol=${mCurved.volume.toFixed(0)}, faces=${mCurved.faceCount}`);
    // Fillet r=8 on a 40³ box → 26 faces (curved + flat mix).
    expect(mCurved.faceCount).toBeGreaterThan(6);

    // 3. Select the curved body with a REAL viewport click for Offset Shape.
    await clickBody(win, filletedId);
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Offset Shape, +4 mm (a large offset relative to the
    //    r=8 rounds — the regime where a naive offset self-intersects).
    await injectToolParams(win, 'Offset Shape', { distance: 4 });
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

    // 6. Measure the offset result.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Offset Shape (curved enclosure, +4 mm): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Offsetting the curved body outward grows it — volume must exceed the
    // curved input and stay finite/positive (a self-intersecting offset would
    // collapse or explode the volume).
    expect(m.volume).toBeGreaterThan(mCurved.volume);
    expect(m.volume).toBeLessThan(mCurved.volume * 3);
    expect(m.faceCount).toBeGreaterThan(0);

    // 7. GAP-CLOSURE assertion — the offset of the high-curvature surface is a
    //    VALID, NON-SELF-INTERSECTING solid. This is exactly what PerformBySimple
    //    failed to guarantee and PerformByJoin's intersection handling delivers.
    const offParams = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.meta && window.__lastBrepShape.meta.params
    );
    console.log(`  Offset params: ${JSON.stringify(offParams)}`);
    expect(offParams, 'offset must record its join params').toBeTruthy();
    // The repaired-offset path: intersection handling on, arc-vs-intersection join.
    expect(offParams.joinType).toBe('intersection');
    expect(offParams.intersection).toBe(true);

    const check = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.checkSelfIntersection(window.__lastBrepShape)
    );
    console.log(`  Offset result self-check: valid=${check.valid}, selfIntersects=${check.selfIntersects}`);
    expect(check.valid, 'offset of the curved body must be a valid solid').toBe(true);
    expect(check.selfIntersects,
      'offset of the high-curvature surface must NOT self-intersect').toBe(false);

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

// ─── Draft — §3.2 drafting faces, fully parametric neutral plane (P3) ─────────

test('Draft: draft-angle plug about a PARAMETRIC neutral plane — build 40³ box → select → Draft 6° about an offset, X-tilted parting plane → tapered solid, params flow through', async () => {
  // Artifact: a draft-angle plug (mold-release shape) tapered about a NON-default
  // parting plane — not the legacy hardcoded z=0 / +Z setup.
  //
  // P3 gap-closure: BrepLocalOps.draft now takes a fully parametric neutral
  // plane (origin + normal) and pull direction. This test drives a neutral
  // plane that is OFFSET (origin z=8 mm) and TILTED off +Z (normal has an X
  // component), pulled along that same tilted axis — exercising the closed
  // gap. The op classifies side faces relative to the chosen pull axis and
  // records the parametric setup in meta.params.
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

    // 4. Click Part tab → Draft with a PARAMETRIC neutral plane + pull dir.
    //    Neutral plane: origin (0,0,8) mm, normal slightly tilted off +Z
    //    (0.15, 0, 1) → a real arbitrary parting plane. Pull along the same.
    //    Inject params before clicking — under Playwright (navigator.webdriver
    //    =true) ToolParamDialog auto-bypasses; planParams is the injection path.
    await injectToolParams(win, 'Draft', {
      angleDeg: 6,
      neutralOriginX: 0, neutralOriginY: 0, neutralOriginZ: 8,
      neutralNormalX: 0.15, neutralNormalY: 0, neutralNormalZ: 1,
      pullDirX: 0.15, pullDirY: 0, pullDirZ: 1,
    });
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

    // 6. Measure + assert the taper happened.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Draft (parametric-neutral-plane plug): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(0);
    // Drafting tapers the side faces → volume moves off the 64000 mm³ blank.
    expect(m.volume).not.toBe(64000);
    expect(m.volume).toBeLessThan(64000 * 1.5);
    expect(m.faceCount).toBe(6);

    // 7. GAP-CLOSURE assertion — the parametric neutral plane + pull direction
    //    flowed all the way through to the kernel op and were recorded. The
    //    legacy op hardcoded neutralNormal=[0,0,1]; here it is the TILTED
    //    normal we supplied, proving the neutral plane is fully parametric.
    const dp = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.meta && window.__lastBrepShape.meta.params
    );
    console.log(`  Draft params: ${JSON.stringify(dp)}`);
    expect(dp, 'draft must record its parametric neutral plane').toBeTruthy();
    expect(dp.angleDeg).toBe(6);
    // Neutral-plane origin: offset to z=8 mm (legacy hardcoded z=0).
    expect(dp.neutralOrigin[2]).toBeCloseTo(8, 3);
    // Neutral-plane normal: TILTED off +Z (normalised) — has a real X part.
    expect(dp.neutralNormal[0]).toBeGreaterThan(0.1);
    expect(dp.neutralNormal[2]).toBeGreaterThan(0.9);
    // Pull direction: the same tilted axis, normalised — real X part.
    expect(dp.pullDir[0]).toBeGreaterThan(0.1);
    // The op classified + tapered the prismatic side faces.
    expect(dp.draftedFaces).toBeGreaterThanOrEqual(1);

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
