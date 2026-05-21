/**
 * brep-check-electron.spec.js
 *
 * A3 gate: geometry checking and interference detection.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ──────────────────
 * Records the whole workflow as a .webm video with key-frame stills at each
 * beat. REAL viewport clicks + drag-orbits show the operation in motion.
 *
 * ONE consolidated test — all checks in a single session:
 *
 * USER-WORKFLOW tests (ribbon clicks with real-world artifacts):
 *   - Check Geometry (Manufacture tab): Box→Fillet(r=2) → rounded plate → validate
 *     Asserts window.__lastGeometryCheck.selfIntersects===false, valid===true
 *   - Interference (Assembly tab): Box [bracket] + Cylinder [shaft] → clash check
 *     Asserts window.__lastInterferenceResult.clash===true, interferenceVolume>0
 *
 * KERNEL-DIRECT tests (EXEMPT — no ribbon workflow produces these inputs):
 *   - self-intersection POSITIVE: overlapping-compound via translate+makeCompound
 *   - clash POSITIVE: two translated overlapping solids
 *   - clash NEGATIVE (disjoint): two solids with 30mm clearance gap
 *   - leak guard: checkSelfIntersection 25× — WASM lifecycle
 *
 * Artifacts land in:  test-results/motion/brep-check/
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, addToSelection, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

test('Check + Interference suite: rounded-plate geometry check, bracket-shaft clash, kernel-direct diagnostics', async () => {
  // Single-session recording: all geometry checks + interference + kernel-direct tests.
  // The ribbon-workflow tests capture full REAL click/orbit motion; kernel-direct
  // tests are exempt from user-workflow requirements (WASM lifecycle probes).
  const { app, win, pageErrors, story } = await launchWithCapture('brep-check');
  try {

    // ── Part 1: Check Geometry via ribbon (Manufacture tab) ───────────────────
    // Artifact: validly-modelled rounded plate (Box + Fillet)
    // User workflow: Part tab → Box → REAL click select → Fillet(radius:2)
    //   → Manufacture tab → Check Geometry.
    console.log('  [1] Building rounded plate for Check Geometry...');
    const boxId = await buildPrimitive(win, 'Box');

    // Key-frame: input box before fillet.
    await story.frame('input-box');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-box-3d');

    // REAL viewport click to select the box for Fillet.
    await clickBody(win, boxId);
    const idBeforeFillet = await win.evaluate(
      () => window.__lastBrepShape && window.__lastBrepShape.id,
    );
    await injectToolParams(win, 'Fillet', { radius: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('before-fillet');
    await clickRibbonTool(win, 'Fillet');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet,
      { timeout: 60000 },
    );
    // Get the registry body ID (body-NNN format) for clickBody — NOT the brep shape id.
    const filletedId = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      if (reg && reg.bodies && reg.bodies.length > 0) {
        return reg.bodies[reg.bodies.length - 1].id;
      }
      return window.__lastBrepShape && window.__lastBrepShape.id;
    });

    await win.waitForTimeout(300);
    await story.frame('after-fillet');

    // Pre-clear stale result.
    await win.evaluate(() => { window.__lastGeometryCheck = null; });

    // REAL viewport click to select the filleted body before Check Geometry.
    await clickBody(win, filletedId);

    // Switch to Manufacture tab.
    const mfgTab = win.locator('button.ribbon-tab').filter({ hasText: /^Manufacture$/ });
    await expect(mfgTab).toBeVisible({ timeout: 30000 });
    await mfgTab.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // Click Check Geometry ribbon tool.
    const checkBtn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
      has: win.locator('.ribbon-tool-label', { hasText: /^Check Geometry$/ }),
    }).first();
    await expect(checkBtn).toBeVisible({ timeout: 30000 });
    await story.frame('before-check-geometry');
    await checkBtn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    await win.waitForFunction(() => !!window.__lastGeometryCheck, null, { timeout: 120000 });

    await win.waitForTimeout(300);
    await story.frame('after-check-geometry');

    const checkR = await win.evaluate(() => window.__lastGeometryCheck);
    console.log(`  Check Geometry (rounded plate): selfIntersects=${checkR.selfIntersects}, valid=${checkR.valid}`);
    // A Box + Fillet must report clean geometry.
    expect(checkR.selfIntersects).toBe(false);
    expect(checkR.valid).toBe(true);

    // ── Part 2: Interference via ribbon (Assembly tab) — §3.6 parity gap P6 ───
    // Artifact: bracket-vs-shaft assembly clash check.
    // User workflow: build Box(40³) [bracket mounting plate] + Cylinder(r=20,h=40)
    // [shaft] via ribbon → REAL click select BOTH bodies → Assembly tab →
    // Interference. Both solids start at origin so they necessarily overlap.
    //
    // P6 gap-closure: the Interference handler is now SELECTION-DRIVEN — it
    // runs ArchDiscKernel.brep.checkClash on the two USER-SELECTED scene
    // bodies (no hardcoded demo geometry), renders the interfering zone, and
    // is a NON-CONSUMING analysis op (both selected bodies stay in the scene).
    console.log('  [2] Building bracket + shaft for Interference check...');
    const bracketId = await buildPrimitive(win, 'Box');
    const shaftId = await buildPrimitive(win, 'Cylinder');

    // Key-frame: both input bodies.
    await story.frame('input-bracket-shaft');
    await dragOrbit(win, { dx: 180, dy: 70 });
    await story.frame('input-bracket-shaft-3d');

    // REAL viewport click on bracket, then add shaft to selection — the two
    // bodies the clash check will operate on.
    await clickBody(win, bracketId);
    await addToSelection(win, shaftId);

    // Confirm BOTH user-built bodies are really selected (selection-driven).
    const selBefore = await win.evaluate(() => window.__archdiscRegistry.selectedIds());
    console.log(`  Selected for Interference: ${JSON.stringify(selBefore)}`);
    expect(selBefore).toContain(bracketId);
    expect(selBefore).toContain(shaftId);

    // Body count before the analysis — to prove the op is non-consuming.
    const bodyCountBefore = await win.evaluate(
      () => window.__archdiscRegistry.bodies.length);

    // Pre-clear stale results (both the legacy slot and the new e2e slot).
    await win.evaluate(() => {
      window.__lastInterferenceResult = null;
      window.__lastClashCheck = null;
    });

    // Switch to Assembly tab.
    const asmTab = win.locator('button.ribbon-tab').filter({ hasText: /^Assembly$/ });
    await expect(asmTab).toBeVisible({ timeout: 30000 });
    await asmTab.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // Click Interference ribbon tool.
    const intBtn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
      has: win.locator('.ribbon-tool-label', { hasText: /^Interference$/ }),
    }).first();
    await expect(intBtn).toBeVisible({ timeout: 30000 });
    await story.frame('before-interference');
    await intBtn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    await win.waitForFunction(() => !!window.__lastClashCheck, null, { timeout: 120000 });

    await win.waitForTimeout(300);
    await story.frame('after-interference');

    // GAP-CLOSURE assertion — the new selection-driven e2e slot is populated
    // with a REAL clash verdict from the two selected bodies.
    const clashR = await win.evaluate(() => window.__lastClashCheck);
    console.log(`  Interference (bracket vs shaft): clash=${clashR.clash}, ` +
      `vol=${clashR.interferenceVolume?.toFixed(0)}, zones=${clashR.zoneCount}, ` +
      `zoneRendered=${clashR.zoneRendered}`);
    expect(clashR.error, 'clash check must not error').toBeFalsy();
    // Box(40³) and Cylinder(r=20,h=40) both at origin → they overlap.
    expect(clashR.clash).toBe(true);
    expect(clashR.interferenceVolume).toBeGreaterThan(0);
    // The interfering region must be reported as ≥ 1 disjoint zone.
    expect(clashR.zoneCount).toBeGreaterThanOrEqual(1);
    // The interfering zone must have been rendered into the scene.
    expect(clashR.zoneRendered,
      'the interfering zone must be rendered as a highlighted body').toBe(true);
    // Legacy slot kept in sync for back-compat.
    const intR = await win.evaluate(() => window.__lastInterferenceResult);
    expect(intR.clash).toBe(true);

    // NON-CONSUMING op: both user-selected bodies must still exist; the only
    // body-count change is the +1 clash-zone body that was rendered.
    const bodyCountAfter = await win.evaluate(
      () => window.__archdiscRegistry.bodies.length);
    const survivingIds = await win.evaluate(
      () => window.__archdiscRegistry.bodies.map(b => b.id));
    console.log(`  Bodies: ${bodyCountBefore} → ${bodyCountAfter}; ids=${JSON.stringify(survivingIds)}`);
    expect(survivingIds, 'the bracket body must NOT be consumed').toContain(bracketId);
    expect(survivingIds, 'the shaft body must NOT be consumed').toContain(shaftId);
    // +1 for the rendered clash zone.
    expect(bodyCountAfter).toBe(bodyCountBefore + 1);

    // ── Part 3: Kernel-direct — self-intersection POSITIVE ────────────────────
    // EXEMPT: no ribbon workflow produces a self-intersecting compound.
    // Documented as a kernel WASM lifecycle test, not a user-workflow test.
    console.log('  [3] Kernel-direct self-intersection positive test...');
    const siR = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel.brep;
      const a = await K.makeBox(20, 20, 20);
      const bRaw = await K.makeBox(20, 20, 20);
      const b = await K.translate(bRaw, 10, 0, 0);   // overlaps `a`
      const compound = await K.makeCompound([a, b]);
      return K.checkSelfIntersection(compound);
    });
    expect(siR.selfIntersects).toBe(true);
    expect(siR.count).toBeGreaterThan(0);

    // ── Part 4: Kernel-direct — clash POSITIVE (overlapping) ─────────────────
    // EXEMPT: no ribbon workflow builds a disjoint-positioned pair.
    console.log('  [4] Kernel-direct clash positive test...');
    const clashPosR = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel.brep;
      const a = await K.makeBox(20, 20, 20);
      const bRaw = await K.makeBox(20, 20, 20);
      const b = await K.translate(bRaw, 10, 0, 0);   // overlaps `a` by 10mm
      return K.checkClash(a, b);
    });
    expect(clashPosR.clash).toBe(true);
    expect(clashPosR.interferenceVolume).toBeGreaterThan(3600);  // ~4000 (10×20×20), −10%
    expect(clashPosR.interferenceVolume).toBeLessThan(4400);
    expect(clashPosR.minDistance).toBeLessThan(0.001);

    // ── Part 5: Kernel-direct — clash NEGATIVE (disjoint) ────────────────────
    // EXEMPT: no ribbon workflow builds a disjoint-positioned pair.
    console.log('  [5] Kernel-direct clash negative (disjoint) test...');
    const clashNegR = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel.brep;
      const a = await K.makeBox(20, 20, 20);
      const bRaw = await K.makeBox(20, 20, 20);
      const b = await K.translate(bRaw, 50, 0, 0);   // gap: box a ends x=20, b starts x=50
      return K.checkClash(a, b);
    });
    expect(clashNegR.clash).toBe(false);
    expect(clashNegR.interferenceVolume).toBeLessThan(0.001);
    expect(clashNegR.minDistance).toBeGreaterThan(27);   // ~30mm gap, ±10%
    expect(clashNegR.minDistance).toBeLessThan(33);

    // ── Part 6: Leak guard — 25× checkSelfIntersection ───────────────────────
    // EXEMPT: heap-leak guard bypasses user workflow on purpose to probe WASM lifecycle.
    console.log('  [6] Leak guard: 25x checkSelfIntersection...');
    const heap = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel.brep;
      const oc = await window.__archdiscKernel.getOCCT();

      const a = await K.makeBox(20, 20, 20);
      const bRaw = await K.makeBox(20, 20, 20);
      const b = await K.translate(bRaw, 10, 0, 0);
      const compound = await K.makeCompound([a, b]);

      function getHeapSize(oc) {
        if (oc.HEAPU8 && oc.HEAPU8.buffer) return oc.HEAPU8.buffer.byteLength;
        if (oc.HEAP8 && oc.HEAP8.buffer) return oc.HEAP8.buffer.byteLength;
        const heapKeys = Object.keys(oc).filter(k => /^HEAP/.test(k));
        for (const k of heapKeys) {
          const v = oc[k];
          if (v && v.buffer) return v.buffer.byteLength;
        }
        return 0;
      }

      const before = getHeapSize(oc);
      for (let i = 0; i < 25; i++) {
        await K.checkSelfIntersection(compound);
      }
      const after = getHeapSize(oc);
      return { before, after, heapExposed: before > 0 };
    });
    if (heap.heapExposed) {
      // If heap is exposed, growth must be bounded (< 8 MB) — proves no per-call leak
      expect(heap.after - heap.before).toBeLessThan(8 * 1024 * 1024);
    }
    console.log(`  Leak guard: heap ${heap.before} -> ${heap.after} (exposed: ${heap.heapExposed})`);

    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ────────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input-box\.png$/.test(f));
    const outputStill = stills.find(f => /-after-check-geometry\.png$/.test(f));
    expect(inputStill, 'an input-box still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-check-geometry still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-check-geometry still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
