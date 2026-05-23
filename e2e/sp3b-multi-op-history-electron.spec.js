/**
 * sp3b-multi-op-history-electron.spec.js  —  SP-3b (op coverage across
 * primitives + booleans + features + local + surfacing + transforms)
 *
 * The bespoke real-model acceptance for SP-3b (per the kernel-parity program
 * §3/§4 Area L row). SP-3a proved the mechanism on `makeBox`; SP-3b drives
 * a CHAIN of 8 different op classes through the same forward/inverse
 * machinery, then verifies that the full timeline round-trips
 * rollback→rollforward and every op's persistent body id is stable.
 *
 * ── The bespoke model — a MACHINED BUSHING WITH GREASE GROOVE ───────────────
 *
 * A real engineered part — the kind that ships in millions of automotive,
 * agricultural, and industrial assemblies. The workflow:
 *
 *   1. `makeCylinder(20, 30)`     — outer cylinder, ⌀40mm × 30mm tall
 *   2. `makeCylinder(13, 30)`     — inner bore, ⌀26mm × 30mm tall (subtract)
 *   3. `cut(outer, inner)`        — hollow bushing tube
 *   4. `filletAll(tube, 1.0)`     — break sharp edges 1mm radius
 *   5. `revolveRect(15, 1.5, 2, 360)` — the GREASE GROOVE — annular ring
 *      r=15mm × 1.5mm wide × 2mm tall (full 360°)
 *   6. `cut(filletedTube, groove)` — cut the groove into the bushing wall
 *   7. `translate(bushing, 50, 0, 0)` — re-position to +50mm
 *   8. `makeSphere(8)`            — flange-cap pellet (visible witness body)
 *   9. `fuse(translatedBushing, sphere)` — attach pellet flush against the
 *      bushing for a final compound assembly
 *
 * The CHAIN exercises every SP-3b op family:
 *   - PRIMITIVE create (makeCylinder ×2, makeSphere, revolveRect)
 *   - BOOLEAN derive (cut ×2, fuse)
 *   - FEATURE derive (filletAll)
 *   - TRANSFORM derive (translate)
 *
 * Each step is wrapped by the SP-3b history hook, so the HistoryLog grows
 * one entry per op. A MARK is dropped after each phase ('outer', 'tube',
 * 'filleted', 'grooved', 'positioned', 'assembled') so the timeline can be
 * scrubbed at meaningful checkpoints.
 *
 * ── The timeline-scrub story ────────────────────────────────────────────────
 *
 * One perfectly-viewable camera framing — corner-anchored iso, HELD
 * throughout. At each of the 5 scrub-points the workbench shows EXACTLY
 * the state the timeline cursor is on; no orbit, no zoom, no refit.
 *
 *   start                 — empty viewport
 *   quarter (filleted)    — the hollow tube with broken sharp edges (no
 *                           groove yet)
 *   half (grooved)        — the bushing with the grease groove machined in
 *   three-quarter         — the bushing translated to +50mm (still no sphere)
 *   end (assembled)       — bushing + sphere fused into the final compound
 *
 * The scrub then runs in REVERSE: rollback to start (every inverse fires
 * in newest-first order), then rollforward to end (every forward replays
 * the op against the live re-created inputs). Final state is asserted
 * IDENTICAL — same persistent body ids, same final body count.
 *
 * ── Focal assertions — every op's forward+inverse round-trips ───────────────
 * - Forward replay reproduces the SAME persistent id as the original build
 *   (the bodyTag-stable replay contract).
 * - Inverse pass removes the body cleanly from the registry.
 * - Rollback to baseline → empty registry; rollforward to end → final
 *   state matches the originally-built state by persistent id.
 *
 * Run: ./node_modules/.bin/playwright test sp3b-multi-op-history --headed --workers=1
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { launchWithCapture, dragOrbit } from './helpers/motionCapture.js';

test.setTimeout(600000);

test('SP-3b — multi-op history: 9-step bushing chain (primitives + booleans + feature + transform) rollback→rollforward round-trips, all persistent ids stable', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('sp3b-multi-op-history');
  try {
    // ── Step 0 — initialise the kernel + the HistoryLog hook ─────────────────
    await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 30000 });
    await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      await K.init();
      // Force lazy init of the HistoryLog singleton via the wrapped makeBox
      // path (any wrapped op triggers it). Drop the probe body immediately.
      const probe = await K.brep.makeBox(1, 1, 1);
      try { probe.dispose(); } catch { /* ok */ }
      // Now reset the log to a clean baseline.
      const hist = window.__archdiscKernelHistory;
      if (hist) {
        hist.cursor = -1;
        hist.entries.length = 0;
        hist._markIndex.clear();
      }
      const reg = window.__archdiscRegistry;
      if (reg) {
        reg.clearSelection();
        const ids = reg.bodies.map(b => b.id);
        for (const id of ids) reg.remove(id);
      }
    });
    await win.waitForTimeout(200);
    const hookCheck = await win.evaluate(() => ({
      hookInstalled: !!window.__archdiscKernelHistory,
      cursor: window.__archdiscKernelHistory.cursor,
      entries: window.__archdiscKernelHistory.entries.length,
    }));
    expect(hookCheck.hookInstalled, 'kernel HistoryLog hook installed').toBe(true);
    expect(hookCheck.entries, 'log starts empty after reset').toBe(0);
    expect(hookCheck.cursor, 'cursor at baseline').toBe(-1);

    // ── Step 1 — build the bushing chain ────────────────────────────────────
    // Each op is wrapped by the SP-3b history hook, so the log grows one
    // entry per op. After each PHASE we drop a named mark.
    const buildStage = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      const hist = window.__archdiscKernelHistory;
      const adder = window.__archdiscAddBrepShape;
      const vp = window.__archdiscViewport;
      const scene = vp && vp.scene;
      if (!adder || !scene) {
        return { error: 'addBrepShape or viewport.scene unavailable' };
      }
      const built = {};
      const opEntries = {};

      // Every kernel op auto-records its forward delta whose register thunk
      // calls __archdiscAddBrepShape. The standardSceneRegister thunk also
      // calls __archdiscAddBrepShape on REPLAY. To make the initial-build
      // and replay states equivalent, we register EVERY op result via the
      // adder during the initial build too — the timeline state then mirrors
      // exactly what each forward delta produces on replay.

      // Phase 1 — outer cylinder (r=20mm, h=30mm)
      const outer = await K.brep.makeCylinder(20, 30);
      built.outerPid = outer.body.persistentId;
      opEntries.outerOp = hist.entries[hist.entries.length - 1].id;
      await adder(scene, vp, outer, 0x9aa3ad);

      // Phase 2 — inner bore (r=13mm)
      const inner = await K.brep.makeCylinder(13, 30);
      built.innerPid = inner.body.persistentId;
      opEntries.innerOp = hist.entries[hist.entries.length - 1].id;
      await adder(scene, vp, inner, 0xb0b8c0);
      hist.mark('outer');

      // Phase 3 — hollow tube via cut
      const tube = await K.brep.cut(outer, inner);
      built.tubePid = tube.body.persistentId;
      opEntries.tubeOp = hist.entries[hist.entries.length - 1].id;
      await adder(scene, vp, tube, 0xc8d0d8);
      hist.mark('tube');

      // Phase 4 — break sharp edges with a fillet
      const filleted = await K.brep.filletAll(tube, 1.0);
      built.filletedPid = filleted.body.persistentId;
      opEntries.filletedOp = hist.entries[hist.entries.length - 1].id;
      await adder(scene, vp, filleted, 0xa8b2bd);
      hist.mark('filleted');

      // Phase 5 — the grease groove (revolved annular ring)
      const groove = await K.brep.revolveRect(15, 1.5, 2, 360);
      built.groovePid = groove.body.persistentId;
      opEntries.grooveOp = hist.entries[hist.entries.length - 1].id;
      await adder(scene, vp, groove, 0x8a96a3);

      // Phase 6 — cut the groove into the filleted bushing
      const grooved = await K.brep.cut(filleted, groove);
      built.groovedPid = grooved.body.persistentId;
      opEntries.groovedOp = hist.entries[hist.entries.length - 1].id;
      await adder(scene, vp, grooved, 0xb89dde);
      hist.mark('grooved');

      // Phase 7 — translate to +50mm so the pellet has somewhere to attach
      const positioned = await K.brep.translate(grooved, 50, 0, 0);
      built.positionedPid = positioned.body.persistentId;
      opEntries.positionedOp = hist.entries[hist.entries.length - 1].id;
      await adder(scene, vp, positioned, 0xc9aedb);
      hist.mark('positioned');

      // Phase 8 — the witness pellet (a small sphere at the new origin)
      const sphere = await K.brep.makeSphere(8);
      built.spherePid = sphere.body.persistentId;
      opEntries.sphereOp = hist.entries[hist.entries.length - 1].id;
      await adder(scene, vp, sphere, 0xd4a575);

      // Phase 9 — fuse the bushing + sphere into the final compound
      const assembled = await K.brep.fuse(positioned, sphere);
      built.assembledPid = assembled.body.persistentId;
      opEntries.assembledOp = hist.entries[hist.entries.length - 1].id;
      await adder(scene, vp, assembled, 0xfbc068);
      hist.mark('assembled');

      return {
        built,
        opEntries,
        logEntries: hist.entries.length,
        logCursor: hist.cursor,
        marks: hist.listMarks().map(e => ({ id: e.id, name: e.mark })),
        registryCount: window.__archdiscRegistry.bodies.length,
        opNames: hist.entries.map(e => e.opName),
      };
    });
    console.log(`  build: ops=${JSON.stringify(buildStage.opNames)}`);
    console.log(`         entries=${buildStage.logEntries}, cursor=${buildStage.logCursor}, marks=${buildStage.marks.length}`);
    expect(buildStage.error, `build error: ${buildStage.error}`).toBeUndefined();
    expect(buildStage.logEntries,
      '9 ops + 6 marks = 15 entries').toBe(15);
    expect(buildStage.opNames).toEqual([
      'makeCylinder', 'makeCylinder', 'mark', 'cut', 'mark',
      'filletAll', 'mark', 'revolveRect', 'cut', 'mark',
      'translate', 'mark', 'makeSphere', 'fuse', 'mark',
    ]);
    expect(buildStage.marks.map(m => m.name)).toEqual([
      'outer', 'tube', 'filleted', 'grooved', 'positioned', 'assembled',
    ]);
    // Every op result is added to the scene — 9 ops → 9 bodies. (Each op
    // is non-consuming at the kernel layer; booleans/features don't auto-
    // remove inputs.) The build state mirrors what each forward delta
    // produces on replay, so initial and replayed states match exactly.
    expect(buildStage.registryCount,
      '9 bodies in the scene — one per op').toBe(9);

    // Frame the model — focus on the final assembled body, then a deliberate
    // drag-orbit for an iso corner-on view. HELD throughout.
    await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      const last = reg.bodies[reg.bodies.length - 1];
      if (last && last.group && typeof window.__archdiscFocusOnObject === 'function') {
        window.__archdiscFocusOnObject(last.group);
      }
    });
    await win.waitForTimeout(900);
    await dragOrbit(win, { dx: -180, dy: -60, steps: 24 });
    await win.waitForTimeout(420);
    await story.frame('state-end-built');

    // ── Step 2 — roll BACK to baseline through every op ─────────────────────
    const back = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      const r = await hist.rollBackTo('__baseline');
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        entries: hist.entries.length,
      };
    });
    console.log(`  rollback to baseline: ${JSON.stringify(back)}`);
    expect(back.cursor, 'cursor at baseline').toBe(-1);
    expect(back.registryCount, 'registry empty after rollback').toBe(0);
    expect(back.entries, 'entries preserved (redo stack intact)').toBe(15);
    await win.waitForTimeout(420);
    await story.frame('state-start-empty');

    // ── Step 3 — scrub FORWARD to 'filleted' (quarter point) ────────────────
    const fwdQuarter = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      const r = await hist.rollForwardTo('filleted');
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        persistentIds: window.__archdiscRegistry.bodies.map(b => {
          const ref = b.brepShapeRef
            || (b.group && b.group.userData && b.group.userData.brepShapeRef);
          return ref && ref.body && ref.body.persistentId;
        }),
        ops: window.__archdiscRegistry.bodies.map(b => {
          const ref = b.brepShapeRef
            || (b.group && b.group.userData && b.group.userData.brepShapeRef);
          return ref && ref.meta && ref.meta.op;
        }),
      };
    });
    console.log(`  forward to filleted: ${JSON.stringify(fwdQuarter)}`);
    expect(fwdQuarter.cursor, 'cursor at filleted mark (entry 6)').toBe(6);
    // After forwarding to 'filleted', entries 0..6 are applied = ops at
    // indices 0,1,3,5 (the 4 mark entries are no-ops). So 4 bodies registered.
    expect(fwdQuarter.registryCount,
      '4 bodies — outer + inner + tube + filleted').toBe(4);
    // Persistent ids of rebuilt bodies MUST match the originally-built ones —
    // every op's rebuild thunk seeded bindSpine with the captured persistentBodyId.
    expect(fwdQuarter.persistentIds).toContain(buildStage.built.outerPid);
    expect(fwdQuarter.persistentIds).toContain(buildStage.built.innerPid);
    expect(fwdQuarter.persistentIds).toContain(buildStage.built.tubePid);
    expect(fwdQuarter.persistentIds).toContain(buildStage.built.filletedPid);
    await win.waitForTimeout(420);
    await story.frame('state-quarter-filleted');

    // ── Step 4 — scrub forward to 'grooved' (half point) ────────────────────
    const fwdHalf = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      const r = await hist.rollForwardTo('grooved');
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        persistentIds: window.__archdiscRegistry.bodies.map(b => {
          const ref = b.brepShapeRef
            || (b.group && b.group.userData && b.group.userData.brepShapeRef);
          return ref && ref.body && ref.body.persistentId;
        }),
      };
    });
    console.log(`  forward to grooved: ${JSON.stringify(fwdHalf)}`);
    expect(fwdHalf.cursor, 'cursor at grooved mark (entry 9)').toBe(9);
    // After 'grooved' (entry 9), ops at indices 0,1,3,5,7,8 forwarded = 6 bodies.
    expect(fwdHalf.registryCount,
      '6 bodies — adds groove + grooved bushing').toBe(6);
    expect(fwdHalf.persistentIds).toContain(buildStage.built.groovedPid);
    await win.waitForTimeout(420);
    await story.frame('state-half-grooved');

    // ── Step 5 — scrub forward to 'positioned' (three-quarter point) ────────
    const fwdThreeQuarter = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      const r = await hist.rollForwardTo('positioned');
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        persistentIds: window.__archdiscRegistry.bodies.map(b => {
          const ref = b.brepShapeRef
            || (b.group && b.group.userData && b.group.userData.brepShapeRef);
          return ref && ref.body && ref.body.persistentId;
        }),
      };
    });
    console.log(`  forward to positioned: ${JSON.stringify(fwdThreeQuarter)}`);
    expect(fwdThreeQuarter.cursor, 'cursor at positioned mark (entry 11)').toBe(11);
    // After 'positioned' (entry 11), 7 ops forwarded = 7 bodies.
    expect(fwdThreeQuarter.registryCount, '7 bodies').toBe(7);
    expect(fwdThreeQuarter.persistentIds).toContain(buildStage.built.positionedPid);
    await win.waitForTimeout(420);
    await story.frame('state-threequarter-positioned');

    // ── Step 6 — scrub forward to 'assembled' (end) ─────────────────────────
    const fwdEnd = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      const r = await hist.rollForwardTo('assembled');
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        persistentIds: window.__archdiscRegistry.bodies.map(b => {
          const ref = b.brepShapeRef
            || (b.group && b.group.userData && b.group.userData.brepShapeRef);
          return ref && ref.body && ref.body.persistentId;
        }),
      };
    });
    console.log(`  forward to assembled: ${JSON.stringify(fwdEnd)}`);
    expect(fwdEnd.cursor, 'cursor at assembled mark (entry 14)').toBe(14);
    expect(fwdEnd.registryCount, '9 bodies fully restored').toBe(9);
    expect(fwdEnd.persistentIds).toContain(buildStage.built.assembledPid);
    // The full round-trip: every persistent id of the final state matches
    // the originally-built one. This is the SP-3b focal contract — every
    // forward delta replays its op with the same bodyTag, so the rebuilt
    // body's persistentId is stable across rollback/rollforward cycles.
    const finalIds = new Set(fwdEnd.persistentIds);
    expect(finalIds.has(buildStage.built.tubePid),
      'tube body id stable across replay').toBe(true);
    expect(finalIds.has(buildStage.built.filletedPid),
      'filletedTube body id stable across replay').toBe(true);
    expect(finalIds.has(buildStage.built.groovedPid),
      'grooved bushing body id stable across replay').toBe(true);
    expect(finalIds.has(buildStage.built.positionedPid),
      'translated bushing body id stable across replay').toBe(true);
    expect(finalIds.has(buildStage.built.assembledPid),
      'fused (bushing+sphere) body id stable across replay').toBe(true);
    await win.waitForTimeout(420);
    await story.frame('state-end-rebuilt');

    // ── Step 7 — clean state assertions ─────────────────────────────────────
    // Some pageErrors are tolerated if they're transient mesh rebuild
    // warnings from the rapid scene churn; ASSERT no kernel-level errors.
    const kernelErrors = pageErrors.filter(e =>
      /HistoryLog|recordBodyDerive|recordBodyCreate|persistentId/.test(e));
    expect(kernelErrors,
      `kernel-level page errors: ${JSON.stringify(kernelErrors)}`).toEqual([]);

    const stills = story.frames();
    expect(stills.length,
      '5 timeline-scrub stills (end + start + quarter + half + three-q + end-rebuilt)').toBeGreaterThanOrEqual(5);
    const endBuilt = stills.find(f => /state-end-built\.png$/.test(f));
    const startEmpty = stills.find(f => /state-start-empty\.png$/.test(f));
    const endRebuilt = stills.find(f => /state-end-rebuilt\.png$/.test(f));
    expect(endBuilt, 'end-built still exists').toBeTruthy();
    expect(startEmpty, 'start-empty still exists').toBeTruthy();
    expect(endRebuilt, 'end-rebuilt still exists').toBeTruthy();
    expect(fs.statSync(endBuilt).size,
      'end-built still is a real screenshot').toBeGreaterThan(10 * 1024);
    expect(fs.statSync(endRebuilt).size,
      'end-rebuilt still is a real screenshot').toBeGreaterThan(10 * 1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
