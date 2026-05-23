/**
 * spine-s2-makebox-electron.spec.js  —  SP-1 Stage S2
 *
 * Verifies the FIRST PRODUCTION OP MIGRATION to the unified topology spine:
 * `makeBox` now returns a `SpineBody` (Body→Lump→Shell→Face→Loop→Coedge→
 * Edge→Vertex bound from the engine TopoDS_Shape) instead of a raw BrepShape.
 *
 * The S2 acceptance gates (per docs/superpowers/plans/2026-05-22-sp1-
 * topology-spine.md §4 Stage S2):
 *
 *   (a) The migrated op flows facade → scene → BodyRegistry →
 *       window.__last* IDENTICALLY to before — the Body Browser lists the
 *       box, it renders in the viewport, `measure` returns volume=64,000
 *       for a 40 mm box (40³). This is the BrepShape-duck-compatibility
 *       contract (SP-1 §5).
 *   (b) `window.__lastSpine` is the NEW slot that exposes the spine `Body`,
 *       which carries the full topology graph (lumps, shells, faces, loops,
 *       coedges, edges, vertices) bound by `bindSpine`, validated by
 *       `validateSpine` (Euler-Poincaré + structural invariants), with
 *       persistent ids and the geomEngineShape back-reference.
 *   (c) `withScope` survivor detection recognises a SpineBody — the engine
 *       shape inside the SpineBody is kept alive after the makeBox returns,
 *       so the next op's tessellation/measure must succeed (proving the
 *       adapter actually works end-to-end). The spec covers this by running
 *       `measure` AFTER the box is in the scene, which must succeed with
 *       the live engine shape.
 *   (d) MIXED-CURRENCY interop — a downstream un-migrated op (filletAll
 *       still returns BrepShape in S2) MUST accept a SpineBody input and
 *       produce a valid filleted body. This is the canonical "migrated op +
 *       legacy op" combination the adapter has to make seamless. The spec
 *       drives makeBox → Fillet → measure(filleted) > 0 and renders the
 *       result from multiple angles, key-framing the workflow.
 *
 * Methodology — ArchDisc standing standards:
 *   - HEADED ELECTRON, motion-capture (slow-mo video + key-frame stills via
 *     real ribbon clicks + real viewport drag-orbit), captures multiple
 *     camera angles + zoom levels (`captureAllAngles`).
 *   - ONE test() per file. Imports use BARE specifiers (no node:).
 *   - The workflow is a COMPLETE complex flow — Box (migrated) → orbit →
 *     select → Fillet (legacy) → orbit + multi-angle render, NOT an
 *     isolated single click.
 *
 * Run: ./node_modules/.bin/playwright test spine-s2-makebox-electron --headed --workers=1
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  clickRibbonTab, clickRibbonTool, buildPrimitive, injectToolParams,
} from './helpers/uiWorkflow.js';
import { launchWithCapture, clickBody, dragOrbit } from './helpers/motionCapture.js';
import { captureAllAngles } from './helpers/orbitCapture.js';

test.setTimeout(600000);

test('SP-1 S2 — makeBox migration: SpineBody flows facade→scene→registry, validateSpine green, downstream Fillet interops', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('spine-s2-makebox');
  try {
    // ── Step 1 — drive the REAL Part-tab Box ribbon tool (the migrated op) ───
    // makeBox now returns a SpineBody, which is duck-compatible with BrepShape
    // so the entire downstream — brepToMesh, measure, addBrepShapeToScene,
    // BodyRegistry, window.__last* — must work IDENTICALLY. The S2 acceptance
    // is that this single workflow step is indistinguishable to the user.
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);
    await story.frame('input-box');
    // Real viewport drag-orbit so the storyboard shows the box in 3D, not a
    // static front-view — the in-motion methodology standard.
    await dragOrbit(win, { dx: 220, dy: 95 });
    await story.frame('input-box-3d');

    // ── Step 2 — assert the BrepShape-duck-compatibility contract ────────────
    // The MIGRATED makeBox must produce a body that is INDISTINGUISHABLE from
    // a BrepShape to every downstream consumer. Specifically:
    //   - window.__lastBrepShape is set (the existing slot — every legacy spec
    //     reads this), and exposes .shape (live TopoDS_Shape), .id, .meta.
    //   - The BodyRegistry has the new entry — Part Browser will list it.
    //   - The new SpineBody-specific slots (__lastSpine, __lastSpineBody,
    //     __lastSpineValidation) are populated.
    const compat = await win.evaluate(() => {
      const last = window.__lastBrepShape;
      const reg = window.__archdiscRegistry;
      return {
        lastExists: !!last,
        lastHasShape: !!(last && last.shape && !last.shape.IsNull()),
        lastId: last && last.id,
        lastOp: last && last.meta && last.meta.op,
        lastDx: last && last.meta && last.meta.params && last.meta.params.dx,
        registryHasEntry: !!(reg && reg.bodies.length > 0
          && reg.bodies[reg.bodies.length - 1].brepShapeRef === last),
        spineExists: !!window.__lastSpine,
        spineBodyExists: !!window.__lastSpineBody,
        // The new slot must be the same object as the legacy one — a
        // SpineBody IS the last BrepShape (duck-compatible).
        spineBodyIsLastBrep: window.__lastSpineBody === window.__lastBrepShape,
        // The spine body's underlying engine shape is the same TopoDS_Shape
        // the legacy consumers read off .shape — single live shape.
        sameUnderlyingShape: !!(window.__lastSpineBody
          && window.__lastSpineBody.body
          && window.__lastSpineBody.shape === last.shape),
      };
    });
    console.log(`  duck-compat: ${JSON.stringify(compat)}`);
    expect(compat.lastExists, 'window.__lastBrepShape must be set after makeBox').toBe(true);
    expect(compat.lastHasShape, '__lastBrepShape.shape must be a live engine shape').toBe(true);
    expect(compat.lastOp, 'meta.op must record makeBox').toBe('makeBox');
    expect(compat.lastDx, 'meta.params.dx must record the default 40 mm').toBe(40);
    expect(compat.registryHasEntry, 'BodyRegistry must list the new body').toBe(true);
    // The S2-new slots must be populated and consistent with the legacy slot.
    expect(compat.spineExists, 'window.__lastSpine must be the spine Body').toBe(true);
    expect(compat.spineBodyExists, 'window.__lastSpineBody must be the SpineBody').toBe(true);
    expect(compat.spineBodyIsLastBrep,
      '__lastSpineBody must be IDENTITY-EQUAL to __lastBrepShape (the SpineBody is the new currency)')
      .toBe(true);
    expect(compat.sameUnderlyingShape,
      'the SpineBody.shape getter must return the same TopoDS_Shape the legacy consumers see')
      .toBe(true);

    // ── Step 3 — inspect the spine Body (the genuinely-built topology) ───────
    const spine = await win.evaluate(() => {
      const body = window.__lastSpine;
      if (!body) return { error: '__lastSpine is null' };
      const validation = window.__lastSpineValidation;
      const euler = body.checkEulerPoincare();
      // Persistent-id sanity — every entity has an id with the body's tag.
      const allIds = [
        body.persistentId,
        ...body.lumps.map(l => l.persistentId),
        ...body.shells().map(s => s.persistentId),
        ...body.faces().map(f => f.persistentId),
        ...body.edges().map(e => e.persistentId),
        ...body.vertices().map(v => v.persistentId),
      ];
      const ids = new Set(allIds);
      return {
        kind: body.kind,
        lumps: body.lumps.length,
        shells: body.shells().length,
        faces: body.faces().length,
        loops: body.loops().length,
        coedges: body.coedges().length,
        edges: body.edges().length,
        vertices: body.vertices().length,
        euler: { actual: euler.actual, lhs: euler.lhs, ok: euler.ok,
          genusImplied: euler.genusImplied },
        validationOk: validation && validation.ok,
        validationErrors: validation && validation.errors && validation.errors.slice(0, 5),
        // every persistent id is unique within the body.
        idsUnique: ids.size === allIds.length,
        // every persistent id is namespaced to the body's tag.
        idsNamespaced: allIds.every(id => id && id.startsWith(body.persistentId)),
        // the geomEngineShape back-ref points at the wrapper our op handed to bindSpine.
        geomEngineShapeIsLastBrep:
          body.geomEngineShape === window.__lastSpineBody.occtWrapper,
        adjacency: body.diagnostics && body.diagnostics.bind
          && body.diagnostics.bind.adjacencyStrategy,
        coedgePartners: body.diagnostics && body.diagnostics.bind
          && body.diagnostics.bind.coedgePartners,
      };
    });
    console.log(`  spine: ${JSON.stringify(spine)}`);
    expect(spine.error, `spine inspection error: ${spine.error}`).toBeUndefined();
    // A 40 mm box is the canonical V−E+F=2 case: 8 V, 12 E (24 coedges = 12×2
    // because each edge is used by 2 face loops), 6 F, 6 loops, 1 shell, 1 lump.
    expect(spine.kind, 'a watertight box must bind as a solid body').toBe('solid');
    expect(spine.lumps).toBe(1);
    expect(spine.shells).toBe(1);
    expect(spine.faces).toBe(6);
    expect(spine.loops).toBe(6);
    expect(spine.edges).toBe(12);
    expect(spine.vertices).toBe(8);
    expect(spine.coedges).toBe(24);
    expect(spine.euler.actual, 'V−E+F = 8−12+6 = 2 for a genus-0 box').toBe(2);
    expect(spine.euler.genusImplied, 'box is genus 0').toBe(0);
    expect(spine.euler.ok, 'Euler-Poincaré must be consistent').toBe(true);
    expect(spine.validationOk,
      `validateSpine errors: ${JSON.stringify(spine.validationErrors)}`).toBe(true);
    expect(spine.idsUnique, 'persistent ids must be unique within the body').toBe(true);
    expect(spine.idsNamespaced,
      'every persistent id must be namespaced to the body tag').toBe(true);
    expect(spine.geomEngineShapeIsLastBrep,
      'body.geomEngineShape must point at the SpineBody.occtWrapper').toBe(true);

    // ── Step 4 — `measure` on the migrated body (verifies adapter end-to-end) ─
    // `measure` is a withScope op that reads .shape from its argument — a
    // critical adapter-contract test: it must work IDENTICALLY on a
    // SpineBody-wrapped engine shape. Volume of a 40 mm box = 64,000 mm³.
    const measured = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      const m = await K.brep.measure(window.__lastBrepShape);
      return { volume: m.volume, area: m.area };
    });
    console.log(`  measure: ${JSON.stringify(measured)}`);
    expect(measured.volume, 'measure(box 40 mm) must return volume=64,000 mm³').toBeCloseTo(64000, 0);
    expect(measured.area, 'measure(box 40 mm) must return area=9,600 mm² (6 × 40²)').toBeCloseTo(9600, 0);

    // ── Step 5 — select the box with a REAL viewport click; pickable verified ─
    // The migrated body must be selectable from the viewport — the gizmo pick
    // path is selection-driven and reads `userData.brepShapeRef` (the SpineBody)
    // off the registry entry.
    await clickBody(win, boxId);
    await story.frame('box-selected');
    const selOk = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      const sel = reg.selectedIds();
      const selShapes = reg.selectedBrepShapes();
      return {
        selectedIds: sel,
        selectedShapeIsLast: selShapes[0] === window.__lastBrepShape,
        selectedHasShape: !!(selShapes[0] && selShapes[0].shape),
      };
    });
    console.log(`  selection: ${JSON.stringify(selOk)}`);
    expect(selOk.selectedIds.length, 'viewport click must select the body').toBeGreaterThan(0);
    expect(selOk.selectedShapeIsLast,
      'selectedBrepShapes()[0] must be the migrated SpineBody (the registry stored it as brepShapeRef)')
      .toBe(true);
    expect(selOk.selectedHasShape,
      'the selected SpineBody must still expose a live engine shape (the SpineBody adapter)').toBe(true);

    // ── Step 6 — downstream FILLET (legacy BrepShape op) on the SpineBody ────
    // THIS is the mixed-currency interop test: the SpineBody from makeBox
    // (migrated) flows as the input to filletAll (un-migrated, still returns
    // BrepShape). The adapter's promise is that this works seamlessly — and
    // the storyboard captures the climactic operation. After this step:
    //   - The fillet result is a BrepShape (legacy).
    //   - `addBrepShapeToScene` rendered it; the box is consumed.
    //   - The new body's volume is < the original (corners shaved off).
    const idBeforeFillet = await win.evaluate(
      () => window.__lastBrepShape && window.__lastBrepShape.id);
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await injectToolParams(win, 'Fillet', { radius: 3 });
    await story.frame('before-fillet');
    await clickRibbonTool(win, 'Fillet');
    await win.waitForTimeout(250);
    await story.frame('fillet-dialog');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet, { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-fillet');

    const filleted = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      const last = window.__lastBrepShape;
      const m = await K.brep.measure(last);
      return {
        id: last.id,
        op: last.meta && last.meta.op,
        parents: last.meta && last.meta.parents,
        volume: m.volume,
        // Is the post-fillet body itself a SpineBody (NO — filletAll is
        // un-migrated in S2) or a BrepShape (YES). The adapter's contract is
        // exactly this MIXED-CURRENCY state — and the spec verifies it.
        isSpineBody: !!(last && last.body && last.occtWrapper),
      };
    });
    console.log(`  fillet result: ${JSON.stringify(filleted)}`);
    expect(filleted.op, 'fillet must record its op tag').toBe('filletAll');
    expect(filleted.volume, 'fillet shaved volume from the 64,000 mm³ box').toBeLessThan(64000);
    expect(filleted.volume, 'fillet kept most of the volume').toBeGreaterThan(60000);
    expect(filleted.isSpineBody,
      'S2 leaves filletAll un-migrated — its result is a legacy BrepShape (mixed-currency adapter contract)')
      .toBe(false);

    // ── Step 7 — multi-angle render via REAL drag-orbits — no blank frames ───
    const cap = await captureAllAngles(win, 'spine-s2-makebox', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors, `page errors during the workflow: ${JSON.stringify(pageErrors)}`).toEqual([]);

    // ── Step 8 — storyboard stills exist and are non-trivial ─────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input-box\.png$/.test(f));
    const filletedStill = stills.find(f => /-after-fillet\.png$/.test(f));
    expect(inputStill, 'an input-box still must exist').toBeTruthy();
    expect(filletedStill, 'an after-fillet still must exist').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input-box still must be a real screenshot (>10 KB)').toBeGreaterThan(10 * 1024);
    expect(fs.statSync(filletedStill).size,
      'after-fillet still must be a real screenshot (>10 KB)').toBeGreaterThan(10 * 1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
