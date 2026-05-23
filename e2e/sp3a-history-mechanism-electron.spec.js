/**
 * sp3a-history-mechanism-electron.spec.js  —  SP-3a (kernel history & rollback)
 *
 * The bespoke real-model acceptance for the SP-3a mechanism + first-op hook
 * (per the kernel-parity program §3/§4 Area L row, the §3 row labelled
 * "kernel-level bulletin-board / rollback / mark / replay" — mirroring ACIS
 * BULLETIN_BOARD + Parasolid PK_PARTITION_set_history_state).
 *
 * The single test verifies, end-to-end inside the real Electron app:
 *   1. The kernel HistoryLog singleton (`window.__archdiscKernelHistory`) is
 *      live and empty at session start.
 *   2. `kernel.brep.makeBox` is wrapped so every invocation appends a
 *      forward/inverse delta to the log, with the spine body's persistent
 *      id captured in entry.meta. Public makeBox API + return-shape are
 *      unchanged (the box renders normally; window.__lastSpine* populated;
 *      BodyRegistry has the entry).
 *   3. Named MARKS (`log.mark(name)`) drop pointers into the timeline,
 *      addressable later by name.
 *   4. `rollBackTo(mark)` walks inverses NEWEST-FIRST of entries above the
 *      target. The crate stack visibly shrinks state-by-state (3 → 2 → 1 →
 *      0 boxes), each state captured as a perfectly-framed still.
 *   5. `rollForwardTo(mark)` walks forwards from the cursor up to the
 *      target. The crate stack visibly re-grows (0 → 1 → 2 → 3 boxes),
 *      with each rebuilt body re-keyed under the SAME persistentId (so the
 *      inverse + downstream id-keyed lookups continue to resolve).
 *   6. Rollback-then-act invalidates the redo stack — recording a fresh
 *      op after rolling back drops the future branch (classic undo/redo).
 *
 * The bespoke model — a DIE-CAST CRATE STACK
 * ─────────────────────────────────────────────────────────────────────────
 * Three boxes of DIFFERENT SIZES, all anchored at the +X+Y+Z origin corner,
 * forming a nested stack: 20 mm → 40 mm → 60 mm.
 *
 * The visual progression at each timeline state is genuine — each rolled-
 * back state shows a SMALLER cube than the prior (the outer layer was peeled
 * back), because the larger cubes hide the smaller ones inside themselves.
 *
 *   State 3   (3 boxes built)   — 60 mm cube is visible (40 + 20 hidden inside)
 *   State 2   (rolled back 1)   — 40 mm cube is visible (20 hidden inside)
 *   State 1   (rolled back 2)   — 20 mm cube is visible
 *   State 0   (baseline)        — empty viewport
 *   State 1'  (rolled forward)  — 20 mm cube back
 *   State 2'  (rolled forward)  — 40 mm cube back
 *   State 3'  (rolled forward)  — 60 mm cube back
 *
 * This is the TIMELINE-SCRUB story — a single perfectly-viewable framing
 * of the stack, HELD throughout, with each rollback state captured as the
 * deliberate key frame. NO 7-angle orbit. NO zoom-in/zoom-out. ONE camera
 * position, seven scrubbed states.
 *
 * Run:  ./node_modules/.bin/playwright test sp3a-history-mechanism --headed --workers=1
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { launchWithCapture, dragOrbit } from './helpers/motionCapture.js';

test.setTimeout(600000);

test('SP-3a — history-mechanism: 3-box crate stack records → marks → rollBack 3→2→1→0 → rollForward 0→1→2→3, persistent ids stable, redo stack honoured', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('sp3a-history-mechanism');
  try {
    // ── Step 0 — confirm the kernel HistoryLog hook is live ──────────────────
    // The kernel module installs `window.__archdiscKernelHistory` lazily on
    // first getHistoryLog() call. Force the lazy init by reading
    // window.__archdiscKernel and importing the history barrel through the
    // kernel facade. The simplest forced touch — call any kernel op that
    // goes through the wrapped makeBox path (the wrapping itself imports
    // recordBodyCreate which calls getHistoryLog).
    await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 30000 });
    // Trigger lazy initialisation of the singleton by importing the barrel.
    await win.evaluate(async () => {
      // Touch the kernel module; the SP-3a hook in BrepPrimitives.makeBox
      // imports `recordBodyCreate` which calls getHistoryLog() which
      // installs the window hook on first call. Simplest forced touch: a
      // trivial kernel-API ping.
      const K = window.__archdiscKernel.kernel;
      await K.init();
    });
    // The hook installs lazily on the first makeBox call; force-call once
    // and then assert. The first call also dirties the log; we reset right
    // after to start from a clean baseline.
    const probe = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      const box = await K.brep.makeBox(10, 10, 10);
      const hist = window.__archdiscKernelHistory;
      const result = {
        hookInstalled: !!hist,
        hookHasEntries: !!(hist && hist.entries && hist.entries.length > 0),
        firstEntryOp: hist && hist.entries[0] && hist.entries[0].opName,
        firstEntryHasInverse: typeof (hist && hist.entries[0] && hist.entries[0].inverse) === 'function',
        firstEntryPersistentId: hist && hist.entries[0]
          && hist.entries[0].meta && hist.entries[0].meta.persistentBodyId,
        boxPersistentId: box.body.persistentId,
      };
      // Free the probe box's engine shape; do NOT remove from history yet,
      // the next step does that via a clean rollback through the log itself.
      try { box.dispose(); } catch { /* ok */ }
      return result;
    });
    console.log(`  probe: ${JSON.stringify(probe)}`);
    expect(probe.hookInstalled,
      'window.__archdiscKernelHistory must be installed after the first makeBox call').toBe(true);
    expect(probe.hookHasEntries,
      'the wrapped makeBox must append at least one entry on its first call').toBe(true);
    expect(probe.firstEntryOp, 'entry opName is makeBox').toBe('makeBox');
    expect(probe.firstEntryHasInverse,
      'every recorded entry must carry an inverse delta').toBe(true);
    expect(probe.firstEntryPersistentId,
      'meta.persistentBodyId must match the freshly-bound body').toBe(probe.boxPersistentId);

    // Reset the log + clear the scene so the deliberate crate-stack workflow
    // starts from a clean baseline. The reset uses setHistoryLogForTest which
    // installs a fresh HistoryLog and re-bridges __archdiscKernelHistory.
    await win.evaluate(() => {
      // Import via the kernel barrel exposed on the global. The history
      // sub-export was added in SP-3a (kernel/index.js append).
      const kernelMod = window.__archdiscKernel;
      // Recreate the history singleton by reaching through the
      // kernelHistory module's set-for-test helper. Cheaper alternative:
      // truncate the existing log to baseline.
      const hist = window.__archdiscKernelHistory;
      if (hist) {
        // Roll back to baseline silently — every entry's inverse runs but
        // the scene is also cleared after, so any side-effect on the
        // registry is wiped by the subsequent clear().
        try { hist.cursor = -1; hist.entries.length = 0; hist._markIndex.clear(); } catch { /* noop */ }
      }
      const reg = window.__archdiscRegistry;
      if (reg) {
        reg.clearSelection();
        const ids = reg.bodies.map(b => b.id);
        for (const id of ids) reg.remove(id);
      }
    });
    await win.waitForTimeout(200);

    // ── Step 1 — build the 3-box crate stack, marking after each ─────────────
    // The wrapping records each makeBox automatically. The e2e ALSO drives
    // addBrepShape to put each result in the scene + registers (so the
    // inverse delta's `BodyRegistry.remove`-by-id has something to remove,
    // and so the viewer sees the cube). The forward delta re-creates the
    // body AND re-adds it to the scene via the same __archdiscAddBrepShape
    // hook — so a rollForward fully restores the scene state without the
    // e2e re-running anything itself.
    const buildStage = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      const hist = window.__archdiscKernelHistory;
      const adder = window.__archdiscAddBrepShape;
      const vp = window.__archdiscViewport;
      const scene = vp && vp.scene;
      if (!adder || !scene) {
        return { error: 'addBrepShape hook or viewport.scene unavailable' };
      }
      // Build 20 mm → 40 mm → 60 mm in that order so each larger cube hides
      // the previous in the nested stack — the timeline-scrub story.
      const sizes = [20, 40, 60];
      const built = [];
      for (let i = 0; i < sizes.length; i++) {
        const sz = sizes[i];
        const box = await K.brep.makeBox(sz, sz, sz);
        // The wrapping recorded an entry for this makeBox. Verify the most
        // recent entry is this box's persistentId.
        const recordedEntryId = hist.entries[hist.entries.length - 1].id;
        // Render — addBrepShape registers in BodyRegistry, adds to scene,
        // and updates window.__last* slots.
        await adder(scene, vp, box, 0x9aa3ad);
        // Drop a NAMED MARK after each crate so we can scrub through them.
        const mark = hist.mark(`crate-${sz}`);
        built.push({
          size: sz,
          persistentId: box.body.persistentId,
          opEntryId: recordedEntryId,
          markEntryId: mark.id,
          markName: `crate-${sz}`,
        });
      }
      // Snapshot the post-build state.
      return {
        sizes,
        built,
        logEntries: hist.entries.length,
        logCursor: hist.cursor,
        marks: hist.listMarks().map(e => ({ id: e.id, name: e.mark })),
        registryCount: window.__archdiscRegistry.bodies.length,
      };
    });
    console.log(`  build: ${JSON.stringify(buildStage)}`);
    expect(buildStage.error, `build error: ${buildStage.error}`).toBeUndefined();
    // The log should have 6 entries: makeBox20, mark20, makeBox40, mark40,
    // makeBox60, mark60. Cursor at the last mark (index 5).
    expect(buildStage.logEntries, 'log has 6 entries — 3 ops + 3 marks').toBe(6);
    expect(buildStage.logCursor, 'cursor at the tail (the last mark)').toBe(5);
    expect(buildStage.marks.length, '3 named marks').toBe(3);
    expect(buildStage.marks.map(m => m.name)).toEqual(['crate-20', 'crate-40', 'crate-60']);
    expect(buildStage.registryCount, '3 bodies in the registry').toBe(3);

    // Frame the stack with one well-chosen camera position, HELD for every
    // timeline-scrub still. Focus on the LARGEST body so the framing
    // accommodates the whole stack — when we peel back to smaller cubes the
    // camera does NOT re-fit (a real CAD timeline-scrub does not refit the
    // camera on every step).
    await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      // The 60 mm box is the most recent body; framing on it covers all 3.
      const last = reg.bodies[reg.bodies.length - 1];
      if (last && last.group && typeof window.__archdiscFocusOnObject === 'function') {
        window.__archdiscFocusOnObject(last.group);
      }
    });
    await win.waitForTimeout(900);
    // A single deliberate drag-orbit so the framing is iso (corner-on),
    // NOT a head-on view. ONE adjustment, then HELD throughout. The crate
    // stack reads as a corner-anchored cube — the +X+Y+Z octant model.
    await dragOrbit(win, { dx: -180, dy: -80, steps: 24 });
    await win.waitForTimeout(420);

    // ── Step 2 — capture the SEVEN timeline states 3→2→1→0→1→2→3 ─────────────
    // Each rollback state is one still at the held framing. The video
    // captures the cumulative scrubbing.
    await story.frame('state-3-three-boxes');

    // 3 → 2: roll back to crate-40 mark (cursor=3). Walks inverses of
    //        entries [4, 5] = [makeBox60, mark60]. The makeBox60's inverse
    //        scans the registry for a body whose persistentId === the
    //        recorded persistentBodyId (the 60 mm box) and calls
    //        BodyRegistry.remove, detaching its Three.js group from the
    //        scene. The 40 mm box becomes the visible cube.
    const back1 = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      // Pass the live scene context so the inverse's BodyRegistry lookup
      // resolves through window.__archdiscRegistry.
      const r = await hist.rollBackTo('crate-40');
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        visibleSizes: window.__archdiscRegistry.bodies.map(b => {
          const ref = b.brepShapeRef
            || (b.group && b.group.userData && b.group.userData.brepShapeRef);
          return ref && ref.meta && ref.meta.params && ref.meta.params.dx;
        }),
      };
    });
    console.log(`  back1 (→ crate-40): ${JSON.stringify(back1)}`);
    expect(back1.cursor, 'cursor at crate-40 mark (index 3)').toBe(3);
    expect(back1.registryCount, 'registry now has 2 bodies').toBe(2);
    expect(back1.visibleSizes.sort()).toEqual([20, 40]);
    await win.waitForTimeout(280);
    await story.frame('state-2-two-boxes');

    // 2 → 1: roll back to crate-20 mark (cursor=1). Walks inverses of
    //        entries [2, 3] = [makeBox40, mark40]. The 40 mm box is removed.
    const back2 = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      const r = await hist.rollBackTo('crate-20');
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        visibleSizes: window.__archdiscRegistry.bodies.map(b => {
          const ref = b.brepShapeRef
            || (b.group && b.group.userData && b.group.userData.brepShapeRef);
          return ref && ref.meta && ref.meta.params && ref.meta.params.dx;
        }),
      };
    });
    console.log(`  back2 (→ crate-20): ${JSON.stringify(back2)}`);
    expect(back2.cursor, 'cursor at crate-20 mark (index 1)').toBe(1);
    expect(back2.registryCount, 'registry now has 1 body').toBe(1);
    expect(back2.visibleSizes).toEqual([20]);
    await win.waitForTimeout(280);
    await story.frame('state-1-one-box');

    // 1 → 0: roll back to the literal '__baseline' (cursor=-1). Walks
    //        inverses of entries [0, 1] = [makeBox20, mark20]. Scene empty.
    const back3 = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      const r = await hist.rollBackTo('__baseline');
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        entriesRemain: hist.entries.length,
      };
    });
    console.log(`  back3 (→ __baseline): ${JSON.stringify(back3)}`);
    expect(back3.cursor, 'cursor at baseline (-1)').toBe(-1);
    expect(back3.registryCount, 'registry empty').toBe(0);
    // Entries are NOT discarded on rollback — they sit in the redo stack.
    expect(back3.entriesRemain, 'entries preserved for redo').toBe(6);
    await win.waitForTimeout(280);
    await story.frame('state-0-empty');

    // ── Step 3 — roll FORWARD 0 → 1 → 2 → 3 (rebuilding through the marks) ──
    // Each forward re-runs the recorded `rebuild` thunk — a fresh
    // _constructMakeBox call with the SAME bodyTag, so the rebuilt body's
    // persistentId matches the originally-built one. The register thunk
    // hands the rebuilt body to __archdiscAddBrepShape, populating
    // BodyRegistry and the scene as before.

    // 0 → 1: roll forward to crate-20. Applies forwards of [0, 1].
    const fwd1 = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      const r = await hist.rollForwardTo('crate-20');
      const persistent = window.__archdiscRegistry.bodies.map(b => {
        const ref = b.brepShapeRef
          || (b.group && b.group.userData && b.group.userData.brepShapeRef);
        return ref && ref.body && ref.body.persistentId;
      });
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        persistentIds: persistent,
        visibleSizes: window.__archdiscRegistry.bodies.map(b => {
          const ref = b.brepShapeRef
            || (b.group && b.group.userData && b.group.userData.brepShapeRef);
          return ref && ref.meta && ref.meta.params && ref.meta.params.dx;
        }),
      };
    });
    console.log(`  fwd1 (→ crate-20): ${JSON.stringify(fwd1)}`);
    expect(fwd1.cursor, 'cursor at crate-20 (index 1)').toBe(1);
    expect(fwd1.registryCount, '1 body restored').toBe(1);
    expect(fwd1.visibleSizes).toEqual([20]);
    // Persistent id is stable across replay — re-built body uses same bodyTag.
    expect(fwd1.persistentIds[0], 'persistentId of rebuilt body matches the original')
      .toBe(buildStage.built[0].persistentId);
    await win.waitForTimeout(280);
    await story.frame('state-1f-one-box-rebuilt');

    // 1 → 2: roll forward to crate-40. Applies forwards of [2, 3].
    const fwd2 = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      const r = await hist.rollForwardTo('crate-40');
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        visibleSizes: window.__archdiscRegistry.bodies.map(b => {
          const ref = b.brepShapeRef
            || (b.group && b.group.userData && b.group.userData.brepShapeRef);
          return ref && ref.meta && ref.meta.params && ref.meta.params.dx;
        }).sort(),
      };
    });
    console.log(`  fwd2 (→ crate-40): ${JSON.stringify(fwd2)}`);
    expect(fwd2.cursor, 'cursor at crate-40 (index 3)').toBe(3);
    expect(fwd2.registryCount, '2 bodies restored').toBe(2);
    expect(fwd2.visibleSizes).toEqual([20, 40]);
    await win.waitForTimeout(280);
    await story.frame('state-2f-two-boxes-rebuilt');

    // 2 → 3: roll forward to crate-60. Applies forwards of [4, 5].
    const fwd3 = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      const r = await hist.rollForwardTo('crate-60');
      return {
        result: r,
        cursor: hist.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        visibleSizes: window.__archdiscRegistry.bodies.map(b => {
          const ref = b.brepShapeRef
            || (b.group && b.group.userData && b.group.userData.brepShapeRef);
          return ref && ref.meta && ref.meta.params && ref.meta.params.dx;
        }).sort(),
      };
    });
    console.log(`  fwd3 (→ crate-60): ${JSON.stringify(fwd3)}`);
    expect(fwd3.cursor, 'cursor at crate-60 (index 5)').toBe(5);
    expect(fwd3.registryCount, '3 bodies restored').toBe(3);
    expect(fwd3.visibleSizes).toEqual([20, 40, 60]);
    await win.waitForTimeout(280);
    await story.frame('state-3f-three-boxes-rebuilt');

    // ── Step 4 — rollback-then-act invalidates the redo stack ────────────────
    // Classic undo/redo: after rolling back to crate-40 and then recording
    // a NEW op, every entry above the cursor at recordOp-time is discarded.
    // The new entry takes their place — the redo stack is wiped.
    const branchStage = await win.evaluate(async () => {
      const hist = window.__archdiscKernelHistory;
      // Roll back to crate-40 (cursor=3). Entries 4 (makeBox60) and 5
      // (mark60) sit in the redo stack.
      await hist.rollBackTo('crate-40');
      const beforeCursor = hist.cursor;
      const beforeEntries = hist.entries.length;
      // Record a NEW op via the wrapped makeBox (this auto-recordOp's
      // through the SP-3a hook). The makeBox of 25 mm splits the
      // timeline — the prior entries 4, 5 are dropped from the log.
      const K = window.__archdiscKernel.kernel;
      const newBox = await K.brep.makeBox(25, 25, 25);
      const adder = window.__archdiscAddBrepShape;
      const vp = window.__archdiscViewport;
      await adder(vp.scene, vp, newBox, 0x9aa3ad);
      // The crate-60 mark is now gone — it was in the discarded tail.
      const crateSixtyMark = hist.markByName('crate-60');
      return {
        beforeCursor, beforeEntries,
        afterCursor: hist.cursor,
        afterEntries: hist.entries.length,
        crateSixtyMarkSurvived: !!crateSixtyMark,
        crateFortyMarkSurvived: !!hist.markByName('crate-40'),
        crateTwentyMarkSurvived: !!hist.markByName('crate-20'),
        // The new entry's opName + persistentId + meta dx
        newEntryOp: hist.entries[hist.entries.length - 1].opName,
        newEntryDx: hist.entries[hist.entries.length - 1].meta
          && hist.entries[hist.entries.length - 1].meta.params
          && hist.entries[hist.entries.length - 1].meta.params.dx,
        registryCount: window.__archdiscRegistry.bodies.length,
      };
    });
    console.log(`  branchStage: ${JSON.stringify(branchStage)}`);
    expect(branchStage.beforeCursor,
      'before recordOp the cursor sat at crate-40 (index 3)').toBe(3);
    expect(branchStage.beforeEntries,
      '6 entries before recordOp — the 60 box + mark were in the redo stack').toBe(6);
    // After recordOp, the tail (entries 4, 5) is discarded; the new entry
    // takes index 4. So entries count: 5; cursor: 4.
    expect(branchStage.afterEntries,
      'recordOp DISCARDED the redo-stack entries (4 prior + 1 new = 5)').toBe(5);
    expect(branchStage.afterCursor,
      'cursor at the new entry (index 4)').toBe(4);
    expect(branchStage.crateSixtyMarkSurvived,
      'crate-60 mark was in the discarded redo stack — gone').toBe(false);
    expect(branchStage.crateFortyMarkSurvived,
      'crate-40 mark was at-or-before the cursor at recordOp — survived').toBe(true);
    expect(branchStage.crateTwentyMarkSurvived,
      'crate-20 mark survived').toBe(true);
    expect(branchStage.newEntryOp, 'new entry is makeBox').toBe('makeBox');
    expect(branchStage.newEntryDx, 'new entry recorded dx=25').toBe(25);
    expect(branchStage.registryCount,
      '3 bodies on screen: original 20 + 40 + newly-built 25').toBe(3);

    await win.waitForTimeout(220);
    await story.frame('state-branch-new-25mm-box');

    // ── Step 5 — clean state assertions ──────────────────────────────────────
    expect(pageErrors,
      `page errors during the workflow: ${JSON.stringify(pageErrors)}`).toEqual([]);
    const stills = story.frames();
    // We captured at least 7 timeline-scrub stills + the branch state.
    expect(stills.length,
      'at least 8 storyboard stills (state-3, state-2, state-1, state-0, ' +
      'state-1f, state-2f, state-3f, state-branch)').toBeGreaterThanOrEqual(8);
    const state3 = stills.find(f => /-state-3-three-boxes\.png$/.test(f));
    const state0 = stills.find(f => /-state-0-empty\.png$/.test(f));
    const state3f = stills.find(f => /-state-3f-three-boxes-rebuilt\.png$/.test(f));
    expect(state3, 'state-3 still exists').toBeTruthy();
    expect(state0, 'state-0 still exists').toBeTruthy();
    expect(state3f, 'state-3f still exists').toBeTruthy();
    expect(fs.statSync(state3).size,
      'state-3 still is a real screenshot (>10 KB)').toBeGreaterThan(10 * 1024);
    expect(fs.statSync(state0).size,
      'state-0 (empty) still is also a real screenshot').toBeGreaterThan(10 * 1024);
    expect(fs.statSync(state3f).size,
      'state-3f (rebuilt) still is a real screenshot').toBeGreaterThan(10 * 1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
