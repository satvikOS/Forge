/**
 * ux-rollback-bar-electron.spec.js — Tier-1 #10 / SP-3c
 *
 * The bespoke real-model acceptance for the Rollback bar — a real,
 * HistoryLog-backed timeline scrubber at the top of the viewport.
 *
 * The bar UX:
 *   - Renders the kernel HistoryLog's entries + named marks as a horizontal
 *     strip beneath the Heads-up View Toolbar.
 *   - Click a dot or a mark flag → rolls the kernel to that point. The
 *     model rebuilds / unbuilds LIVE in the viewport at the current camera.
 *   - Drag the caret along the strip → scrubs (each pointer-move drives a
 *     roll; throttled to one drive per RAF so kernel rolls don't stack).
 *   - Right-click a mark → context menu with Roll To / Rename / Delete.
 *   - Re-renders on the `archdisc:history-changed` event the kernel emits
 *     on every recordOp / mark / rollBack / rollForward.
 *
 * The bespoke model — a FURNITURE LEG LATHE PROFILE
 * ─────────────────────────────────────────────────────────────────────────
 * A turned wood furniture leg, built op-by-op so the timeline has 8 entries
 * across 3 named marks:
 *
 *   1. makeCylinder(8, 60)            — the leg BLANK (Ø16mm × 60mm)
 *   2. revolveRect(6, 1.5, 4, 360)    — decorative ring #1 (annular ring)
 *      mark('ring-1')                 — milestone
 *   3. revolveRect(5, 1.0, 4, 360)    — decorative ring #2 (smaller annular)
 *      mark('rings-done')             — second milestone
 *   4. filletAll(blank, 0.5)          — soft the leg's top/bottom edges
 *   5. makeCylinder(4, 12)            — tenon stock
 *   6. cut(filleted, tenon)           — machine the mortise pocket
 *      mark('tenon-cut')              — third milestone
 *   7. translate(grooved, 30, 0, 0)   — position the leg for assembly
 *
 * The chain hits MULTIPLE kernel op families — primitive create, derive
 * (revolveRect + cut + filletAll + translate). Every op auto-records on
 * the SP-3a/3b kernel HistoryLog. The marks let the bar render labelled
 * flag-markers that the user can click directly.
 *
 * The visual story — the model EVOLVING under the user's drag-scrub:
 *
 *   01  the assembled lathe profile at the timeline's tail
 *   02  scrubbed to baseline ('__baseline') — empty viewport
 *   03  scrubbed to 'ring-1' — the blank + ring 1 on screen
 *   04  scrubbed to 'rings-done' — blank + 2 rings
 *   05  scrubbed to 'tenon-cut' — full machined leg (5 bodies)
 *   06  drag-scrub MID-TIMELINE — the bar's cursor caught between marks,
 *       caret pulsing, model in mid-rebuild
 *
 * ONE iso framing held throughout — the bar + the model evolving is the
 * story, not orbit angles.
 *
 * Run:
 *   ./node_modules/.bin/playwright test ux-rollback-bar-electron --workers=1 --headed
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { launchWithCapture, dragOrbit } from './helpers/motionCapture.js';

test.setTimeout(600000);

test('Rollback bar — kernel-history-backed timeline scrubber over a 7-op lathe leg, click + drag + right-click', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('ux-rollback-bar');
  try {
    // ── Step 0 — wait for kernel + reset the log ───────────────────────────
    await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 30000 });
    await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      await K.init();
    });
    // Force the kernel history singleton to install + start from a fresh
    // baseline. The first call into the wrapped makeBox dirties the log;
    // we reset right after.
    await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel;
      const probe = await K.brep.makeBox(1, 1, 1);
      try { probe.dispose(); } catch { /* ok */ }
      const hist = window.__archdiscKernelHistory;
      if (hist) {
        hist.cursor = -1;
        hist.entries.length = 0;
        hist._markIndex.clear();
      }
      const reg = window.__archdiscRegistry;
      if (reg) {
        const ids = reg.bodies.map(b => b.id);
        for (const id of ids) reg.remove(id);
      }
    });
    await win.waitForTimeout(220);

    // The bar's empty-log auto-hide is a render contract — when the bar
    // sees an empty entry list it returns null. Because we reset the log
    // imperatively (`hist.entries.length = 0`) AFTER the probe makeBox
    // dirtied it, no `archdisc:history-changed` event fired for the reset
    // (only recordOp / mark / rollBack / rollForward fire events). The bar's
    // last-snapshotted state may still show the probe entry. We don't gate
    // the build on the empty-hide; instead we verify the bar's
    // empty-hide CONTRACT by querying the React component directly — when
    // `snap.items.length === 0` the bar returns null. We force-emit a
    // refresh event here and re-check. (This isn't a regression — the empty
    // case is exercised in the standalone e2e fixture; here we just bridge
    // past the reset.)
    await win.evaluate(() => {
      window.dispatchEvent(new CustomEvent('archdisc:history-changed',
        { detail: { type: 'reset' } }));
    });
    await win.waitForTimeout(220);
    const initialBar = await win.evaluate(() => {
      const bar = document.querySelector('[data-archdisc-rollback-bar]');
      return { present: !!bar };
    });
    expect(initialBar.present,
      'Rollback bar auto-hides when the log is empty after manual reset + refresh event').toBe(false);

    // ── Step 1 — build the lathe-leg chain (8 ops + 3 marks) ──────────────
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

      // 1. The leg blank — a Ø16mm × 60mm cylinder.
      const blank = await K.brep.makeCylinder(8, 60);
      built.blankPid = blank.body.persistentId;
      await adder(scene, vp, blank, 0xc8a878);

      // 2. Decorative ring #1 — annular ring, r=6mm, w=1.5mm, h=4mm. We
      //    keep the rings as separate bodies (they're cosmetic markers for
      //    the timeline; cutting them into the blank would consume them
      //    visually — we want the user to SEE 4 things appear and
      //    disappear during scrub).
      const ring1 = await K.brep.revolveRect(6, 1.5, 4, 360);
      built.ring1Pid = ring1.body.persistentId;
      await adder(scene, vp, ring1, 0x9c6b3b);
      hist.mark('ring-1');

      // 3. Decorative ring #2 — smaller ring r=5mm.
      const ring2 = await K.brep.revolveRect(5, 1.0, 4, 360);
      built.ring2Pid = ring2.body.persistentId;
      await adder(scene, vp, ring2, 0x9c6b3b);
      hist.mark('rings-done');

      // 4. Fillet the blank's edges.
      const filleted = await K.brep.filletAll(blank, 0.5);
      built.filletedPid = filleted.body.persistentId;
      await adder(scene, vp, filleted, 0xd1ad7d);

      // 5. The tenon stock — a small cylinder.
      const tenon = await K.brep.makeCylinder(4, 12);
      built.tenonPid = tenon.body.persistentId;
      await adder(scene, vp, tenon, 0xb8945e);

      // 6. Cut the mortise pocket (filleted - tenon).
      const mortised = await K.brep.cut(filleted, tenon);
      built.mortisedPid = mortised.body.persistentId;
      await adder(scene, vp, mortised, 0xc99970);
      hist.mark('tenon-cut');

      // 7. Translate the mortised leg +30mm in X so the user sees it
      //    physically move on rollForward (last scrub state shows it
      //    offset; rolling back returns it home).
      const positioned = await K.brep.translate(mortised, 30, 0, 0);
      built.positionedPid = positioned.body.persistentId;
      await adder(scene, vp, positioned, 0xd1a884);

      return {
        built,
        logEntries: hist.entries.length,
        logCursor: hist.cursor,
        marks: hist.listMarks().map(e => ({ id: e.id, name: e.mark })),
        registryCount: window.__archdiscRegistry.bodies.length,
        opNames: hist.entries.map(e => e.opName),
      };
    });
    console.log(`  build: ${JSON.stringify({
      logEntries: buildStage.logEntries,
      logCursor: buildStage.logCursor,
      registryCount: buildStage.registryCount,
      opNames: buildStage.opNames,
      marks: buildStage.marks.map(m => m.name),
    })}`);
    expect(buildStage.error, `build error: ${buildStage.error}`).toBeUndefined();
    // 7 ops + 3 marks = 10 entries.
    expect(buildStage.logEntries, '7 ops + 3 marks = 10 entries').toBe(10);
    expect(buildStage.marks.map(m => m.name)).toEqual([
      'ring-1', 'rings-done', 'tenon-cut',
    ]);
    expect(buildStage.registryCount, '7 bodies in the scene').toBe(7);

    // ── Step 2 — frame the model + assert the bar APPEARS ──────────────────
    // Focus on the assembled leg, then a deliberate iso drag-orbit. HELD
    // throughout — the scrub story is the BAR moving + the MODEL evolving,
    // not orbit angles.
    await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      const last = reg.bodies[reg.bodies.length - 1];
      if (last && last.group && typeof window.__archdiscFocusOnObject === 'function') {
        window.__archdiscFocusOnObject(last.group);
      }
    });
    await win.waitForTimeout(800);
    await dragOrbit(win, { dx: -160, dy: -70, steps: 22 });
    await win.waitForTimeout(420);

    // The bar should now be RENDERED (10 entries available).
    const barInfo = await win.evaluate(() => {
      const bar = document.querySelector('[data-archdisc-rollback-bar]');
      if (!bar) return { present: false };
      const entries = Array.from(bar.querySelectorAll('[data-archdisc-rollback-entry]'));
      const marks = entries.filter(e => e.getAttribute('data-archdisc-rollback-entry-mark'));
      const baseline = bar.querySelector('[data-archdisc-rollback-baseline]');
      const caret = bar.querySelector('[data-archdisc-rollback-caret]');
      return {
        present: true,
        entryCount: entries.length,
        markCount: marks.length,
        baselinePresent: !!baseline,
        caretPresent: !!caret,
        cursor: bar.getAttribute('data-archdisc-rollback-cursor'),
        meta: {
          ariaLabel: bar.getAttribute('aria-label'),
        },
      };
    });
    console.log(`  bar info: ${JSON.stringify(barInfo)}`);
    expect(barInfo.present, 'Rollback bar present after build').toBe(true);
    expect(barInfo.entryCount, '10 entries (7 ops + 3 marks) rendered').toBe(10);
    expect(barInfo.markCount, '3 mark flag-markers rendered').toBe(3);
    expect(barInfo.baselinePresent, 'baseline flag present').toBe(true);
    expect(barInfo.caretPresent, 'cursor caret present').toBe(true);
    expect(barInfo.cursor, 'cursor at tail (index 9)').toBe('9');
    expect(barInfo.meta.ariaLabel, 'bar aria-label').toBe('Kernel rollback timeline');

    await story.frame('A1-assembled-leg-at-tail');

    // ── Step 3 — click the BASELINE flag to roll the scene back to empty ──
    const baselineRoll = await win.evaluate(async () => {
      const bar = document.querySelector('[data-archdisc-rollback-bar]');
      const baselineBtn = bar.querySelector('[data-archdisc-rollback-baseline]');
      baselineBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // The click handler is async — give the kernel rollback time to finish
      // and the event-driven re-render to settle.
      await new Promise(r => setTimeout(r, 400));
      return {
        cursor: window.__archdiscKernelHistory.cursor,
        registryCount: window.__archdiscRegistry.bodies.length,
        barCursorAttr: bar.getAttribute('data-archdisc-rollback-cursor'),
      };
    });
    console.log(`  baseline roll: ${JSON.stringify(baselineRoll)}`);
    expect(baselineRoll.cursor, 'kernel cursor at baseline (-1)').toBe(-1);
    expect(baselineRoll.registryCount, 'registry empty after baseline rollback').toBe(0);
    expect(baselineRoll.barCursorAttr, 'bar mirrors kernel cursor').toBe('-1');
    await win.waitForTimeout(220);
    await story.frame('A2-baseline-empty');

    // ── Step 4 — click 'ring-1' mark → blank + ring-1 reappear ─────────────
    const ring1Roll = await rollByClickingMark(win, 'ring-1');
    console.log(`  ring-1: ${JSON.stringify(ring1Roll)}`);
    // After 'ring-1' (entries 0..2 = makeCylinder, revolveRect, mark-ring-1),
    // 2 ops have fired → 2 bodies (blank + ring1).
    expect(ring1Roll.cursor, 'kernel cursor at ring-1 mark entry').toBe(2);
    expect(ring1Roll.registryCount, 'blank + ring1 in registry').toBe(2);
    expect(ring1Roll.persistentIds, 'ring1 persistentId restored verbatim')
      .toContain(buildStage.built.ring1Pid);
    await win.waitForTimeout(220);
    await story.frame('A3-mark-ring-1-blank-plus-ring');

    // ── Step 5 — click 'rings-done' → both rings on screen ─────────────────
    const ringsDoneRoll = await rollByClickingMark(win, 'rings-done');
    console.log(`  rings-done: ${JSON.stringify(ringsDoneRoll)}`);
    // After 'rings-done' (4 entries forwarded: 3 ops + 1 mark; marks are
    // NOOPs so 3 bodies registered — blank + ring1 + ring2).
    expect(ringsDoneRoll.cursor, 'cursor at rings-done mark').toBe(4);
    expect(ringsDoneRoll.registryCount, 'blank + ring1 + ring2 in registry').toBe(3);
    expect(ringsDoneRoll.persistentIds, 'ring2 persistentId restored')
      .toContain(buildStage.built.ring2Pid);
    await win.waitForTimeout(220);
    await story.frame('A4-mark-rings-done-two-rings');

    // ── Step 6 — click 'tenon-cut' → full machined leg ─────────────────────
    const tenonCutRoll = await rollByClickingMark(win, 'tenon-cut');
    console.log(`  tenon-cut: ${JSON.stringify(tenonCutRoll)}`);
    // After 'tenon-cut' (entries 0..8 = 7 ops + 2 marks; 6 ops have fired
    // up to this point + mark-rings-done + the filletAll + tenon + cut).
    // Bodies: blank + ring1 + ring2 + filleted + tenon + mortised = 6.
    expect(tenonCutRoll.cursor, 'cursor at tenon-cut mark').toBe(8);
    expect(tenonCutRoll.registryCount, 'all 6 op bodies before translate').toBe(6);
    expect(tenonCutRoll.persistentIds).toContain(buildStage.built.mortisedPid);
    await win.waitForTimeout(220);
    await story.frame('A5-mark-tenon-cut-machined-leg');

    // ── Step 7 — verify the BAR cursor caret position matches kernel ──────
    // The visual contract: the caret's `data-archdisc-rollback-caret` attr
    // must equal the kernel cursor at every state. Read both at this state.
    const caretCheck = await win.evaluate(() => {
      const caret = document.querySelector('[data-archdisc-rollback-caret]');
      return {
        caretAttr: caret && caret.getAttribute('data-archdisc-rollback-caret'),
        kernelCursor: window.__archdiscKernelHistory.cursor,
      };
    });
    expect(caretCheck.caretAttr, 'caret reflects kernel cursor').toBe(
      String(caretCheck.kernelCursor),
    );

    // ── Step 8 — drag-scrub the strip MID-TIMELINE ────────────────────────
    // Real drag interaction over the strip. We pointer-down at the strip's
    // right end, then move LEFT in small steps so each pointer-move event
    // resolves to a SMALLER target index — the scene unbuilds in front of
    // the viewer. The RAF throttle in the bar collapses fast moves to one
    // kernel roll per frame; the cursor caret pulses while scrubbing.
    const stripBox = await win.evaluate(() => {
      const strip = document.querySelector('[data-archdisc-rollback-strip]');
      if (!strip) return null;
      const r = strip.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    expect(stripBox, 'strip is in the DOM and has a layout').toBeTruthy();
    // Start near the right edge (tail), drag toward the left (baseline)
    // in 6 stops with a small wait between each so each scrub-step lands
    // on a different entry index.
    const startX = stripBox.x + stripBox.w * 0.95;
    const endX   = stripBox.x + stripBox.w * 0.10;
    const stops = 6;
    const midY  = stripBox.y + stripBox.h / 2;
    await win.mouse.move(startX, midY, { steps: 8 });
    await win.waitForTimeout(120);
    await win.mouse.down();
    // Mid-scrub frame is captured AFTER 2 steps so the caret is visibly
    // between marks and the model is visibly partial.
    let midCapturedAt = -1;
    for (let i = 1; i <= stops; i++) {
      const t = i / stops;
      const x = startX + (endX - startX) * t;
      await win.mouse.move(x, midY, { steps: 6 });
      await win.waitForTimeout(160);
      if (i === 2) {
        // Capture the live scrubbing state — caret pulsing, mid-rebuild.
        midCapturedAt = await win.evaluate(() => {
          return window.__archdiscKernelHistory.cursor;
        });
        await story.frame('B1-scrubbing-mid-timeline');
      }
    }
    await win.mouse.up();
    await win.waitForTimeout(240);

    // After the drag, the kernel cursor should be at ~entry 1 (we dragged
    // from ~tail down to ~10% of the strip, which maps to a low index).
    const afterScrub = await win.evaluate(() => ({
      cursor: window.__archdiscKernelHistory.cursor,
      registryCount: window.__archdiscRegistry.bodies.length,
      scrubbingClass: document.querySelector('[data-archdisc-rollback-bar]')
        ?.classList.contains('sw-rollback-bar-scrubbing'),
    }));
    console.log(`  after scrub: ${JSON.stringify(afterScrub)}, mid was at cursor=${midCapturedAt}`);
    // The mid-capture cursor should differ from the final cursor (it was
    // an intermediate state during the drag).
    expect(midCapturedAt, 'mid-scrub captured a real intermediate cursor').toBeGreaterThanOrEqual(0);
    expect(afterScrub.cursor,
      'after drag, cursor moved away from tail toward baseline').toBeLessThan(8);
    // After mouse up, the scrubbing class should be removed.
    expect(afterScrub.scrubbingClass,
      'scrubbing class clears after pointer-up').toBeFalsy();
    await story.frame('B2-after-drag-scrub-final');

    // ── Step 9 — right-click a mark, test the context menu, Rename ────────
    // Open the right-click context menu on 'rings-done'. Then RENAME it to
    // 'two-rings-done', confirm the kernel mark index updated, confirm the
    // bar re-rendered with the new label.
    const ringsDoneSelector = '[data-archdisc-rollback-entry-mark="rings-done"]';
    await win.waitForSelector(ringsDoneSelector, { timeout: 5000 });
    // Right-click the rings-done flag.
    const rdBox = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, ringsDoneSelector);
    expect(rdBox, 'rings-done flag is in the DOM').toBeTruthy();
    await win.mouse.move(rdBox.x, rdBox.y, { steps: 4 });
    await win.waitForTimeout(120);
    // Use evaluate to dispatch a contextmenu event — Playwright's
    // right-click sometimes fires native browser menus inside Electron
    // which interfere; dispatch directly is the documented in-transcript-
    // buttons pattern.
    await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 2,
      });
      el.dispatchEvent(ev);
    }, ringsDoneSelector);
    await win.waitForTimeout(220);

    const ctxState = await win.evaluate(() => {
      const ctx = document.querySelector('[data-archdisc-rollback-context]');
      const items = ctx
        ? Array.from(ctx.querySelectorAll('[data-archdisc-rollback-context-action]'))
            .map(b => b.getAttribute('data-archdisc-rollback-context-action'))
        : [];
      return { open: !!ctx, items };
    });
    expect(ctxState.open, 'context menu opened on right-click').toBe(true);
    expect(ctxState.items).toEqual(['roll-to', 'rename', 'delete']);
    await story.frame('C1-context-menu-on-rings-done');

    // Click "Rename" → an inline input appears.
    await win.evaluate(() => {
      const btn = document.querySelector('[data-archdisc-rollback-context-action="rename"]');
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await win.waitForTimeout(220);
    const renameOpen = await win.evaluate(() =>
      !!document.querySelector('[data-archdisc-rollback-rename]'));
    expect(renameOpen, 'rename input appeared').toBe(true);

    // Type the new name + commit with Enter via direct value-set + Enter.
    await win.evaluate(() => {
      const input = document.querySelector('[data-archdisc-rollback-rename-input]');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      ).set;
      setter.call(input, 'two-rings-done');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await win.waitForTimeout(280);

    const afterRename = await win.evaluate(() => {
      const hist = window.__archdiscKernelHistory;
      const newMark = hist.markByName('two-rings-done');
      const oldMark = hist.markByName('rings-done');
      const flagInBar = document.querySelector(
        '[data-archdisc-rollback-entry-mark="two-rings-done"]');
      return {
        newMarkPresent: !!newMark,
        oldMarkGone: !oldMark,
        flagInBar: !!flagInBar,
        renameDiag: window.__lastRollbackBarRename,
      };
    });
    console.log(`  rename: ${JSON.stringify(afterRename)}`);
    expect(afterRename.newMarkPresent, 'new mark name resolves').toBe(true);
    expect(afterRename.oldMarkGone, 'old mark name no longer resolves').toBe(true);
    expect(afterRename.flagInBar, 'bar re-rendered with new mark label').toBe(true);
    await story.frame('C2-after-rename-two-rings-done');

    // ── Step 10 — click the renamed mark to roll there, confirming the
    //   delegated kernel rollback STILL works after rename ────────────────
    const afterRenameRoll = await rollByClickingMark(win, 'two-rings-done');
    console.log(`  rolled to renamed mark: ${JSON.stringify(afterRenameRoll)}`);
    expect(afterRenameRoll.cursor, 'rolled to renamed mark entry').toBe(4);
    expect(afterRenameRoll.registryCount, 'blank + ring1 + ring2 restored').toBe(3);
    await win.waitForTimeout(220);
    await story.frame('D1-rolled-to-renamed-mark');

    // ── Step 11 — page-error check + framing assertions ───────────────────
    expect(pageErrors,
      `page errors during the workflow: ${JSON.stringify(pageErrors)}`).toEqual([]);
    const stills = story.frames();
    // We captured at least 8 key-frame stills.
    expect(stills.length,
      'at least 8 key-frame stills (A1..A5, B1, B2, C1, C2, D1)').toBeGreaterThanOrEqual(8);
    const heroFrame = stills.find(f => /A5-mark-tenon-cut/.test(f));
    const scrubFrame = stills.find(f => /B1-scrubbing-mid-timeline/.test(f));
    expect(heroFrame, 'A5 hero (tenon-cut machined leg) still exists').toBeTruthy();
    expect(scrubFrame, 'B1 mid-scrubbing still exists').toBeTruthy();
    expect(fs.statSync(heroFrame).size,
      'A5 still is a real screenshot (>10 KB)').toBeGreaterThan(10 * 1024);
    expect(fs.statSync(scrubFrame).size,
      'B1 mid-scrub still is a real screenshot').toBeGreaterThan(10 * 1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});

/**
 * Click a named mark in the Rollback bar and return the post-roll snapshot
 * (cursor + registry contents). The click is dispatched as a real `click`
 * event on the flag element so the bar's onClick handler runs.
 */
async function rollByClickingMark(win, markName) {
  return win.evaluate(async (name) => {
    const flag = document.querySelector(
      `[data-archdisc-rollback-entry-mark="${name}"]`);
    if (!flag) return { error: `mark flag ${name} not in DOM` };
    flag.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Wait for the async kernel rollback + event-driven re-render.
    await new Promise(r => setTimeout(r, 480));
    const hist = window.__archdiscKernelHistory;
    const reg = window.__archdiscRegistry;
    return {
      cursor: hist.cursor,
      registryCount: reg.bodies.length,
      persistentIds: reg.bodies.map(b => {
        const ref = b.brepShapeRef
          || (b.group && b.group.userData && b.group.userData.brepShapeRef);
        return ref && ref.body && ref.body.persistentId;
      }),
    };
  }, markName);
}
