/**
 * brep-check-electron.spec.js
 *
 * A3 gate: geometry checking and interference detection.
 *
 * User-workflow tests (ribbon clicks with real-world artifacts):
 *   - Check Geometry (Manufacture tab): Box→Fillet → "rounded plate" → validate
 *     Asserts window.__lastGeometryCheck.selfIntersects===false, valid===true
 *   - Interference (Assembly tab): Box [bracket] + Cylinder [shaft] → clash check
 *     Asserts window.__lastInterferenceResult.clash===true, interferenceVolume>0
 *
 * Kernel-direct tests (EXEMPT — no ribbon workflow can produce these inputs):
 *   - self-intersection POSITIVE: overlapping-compound via translate+makeCompound
 *   - clash POSITIVE: two translated overlapping solids
 *   - clash NEGATIVE (disjoint): two solids with 30mm clearance gap
 *   - leak guard: checkSelfIntersection 25× — WASM lifecycle
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, selectBodies, injectToolParams,
} from './helpers/uiWorkflow.js';

test.setTimeout(600000);

async function launch() {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });
  return { app, win, pageErrors };
}

// ─── Check Geometry via ribbon (Manufacture tab) ──────────────────────────────

test('ribbon: Check Geometry tool (Manufacture tab) reports no self-intersection on rounded plate', async () => {
  // Artifact: validly-modelled rounded plate (Box + Fillet)
  // User workflow: Part tab → Box → select → Fillet(radius:2) → Manufacture tab → Check Geometry.
  // Checks a properly-modelled part (not a default internal box).
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build a 40³ box via ribbon.
    const boxId = await buildPrimitive(win, 'Box');

    // 2. Select the box and apply Fillet (radius=2) → rounded plate.
    await selectBodies(win, [boxId]);
    const idBeforeFillet = await win.evaluate(
      () => window.__lastBrepShape && window.__lastBrepShape.id,
    );
    await injectToolParams(win, 'Fillet', { radius: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Fillet');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet,
      { timeout: 60000 },
    );
    const filletedId = await win.evaluate(
      () => window.__lastBrepShape && window.__lastBrepShape.id,
    );

    // 3. Pre-clear stale result.
    await win.evaluate(() => { window.__lastGeometryCheck = null; });

    // 4. Select the filleted body and run Check Geometry (Manufacture tab).
    const regLen = await win.evaluate(
      () => window.__archdiscRegistry ? window.__archdiscRegistry.bodies.length : 0,
    );
    if (regLen > 0) {
      await selectBodies(win, [
        await win.evaluate(
          () => window.__archdiscRegistry.bodies[window.__archdiscRegistry.bodies.length - 1].id,
        ),
      ]);
    }

    // 5. Switch to Manufacture tab.
    const mfgTab = win.locator('button.ribbon-tab').filter({ hasText: /^Manufacture$/ });
    await expect(mfgTab).toBeVisible({ timeout: 30000 });
    await mfgTab.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // 6. Click Check Geometry ribbon tool.
    const re = /^Check Geometry$/;
    const btn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
      has: win.locator('.ribbon-tool-label', { hasText: re }),
    }).first();
    await expect(btn).toBeVisible({ timeout: 30000 });
    await btn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // 7. Wait for the handler to set window.__lastGeometryCheck.
    await win.waitForFunction(() => !!window.__lastGeometryCheck, null, { timeout: 120000 });

    const r = await win.evaluate(() => window.__lastGeometryCheck);
    console.log(`  Check Geometry (rounded plate): selfIntersects=${r.selfIntersects}, valid=${r.valid}`);
    // A Box + Fillet must report clean geometry.
    expect(r.selfIntersects).toBe(false);
    expect(r.valid).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Interference via ribbon (Assembly tab) ───────────────────────────────────

test('ribbon: Interference tool (Assembly tab) detects clash between bracket (box) and shaft (cylinder)', async () => {
  // Artifact: bracket-vs-shaft assembly clash check
  // User workflow: build Box(40³) [bracket mounting plate] + Cylinder(r=20,h=40) [shaft]
  // via ribbon → select both → Assembly tab → Interference.
  // Both solids start at origin so they necessarily overlap.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the bracket (box) via ribbon.
    const bracketId = await buildPrimitive(win, 'Box');

    // 2. Build the shaft (cylinder) via ribbon.
    const shaftId = await buildPrimitive(win, 'Cylinder');

    // 3. Select both bodies.
    await selectBodies(win, [bracketId, shaftId]);

    // 4. Pre-clear stale result.
    await win.evaluate(() => { window.__lastInterferenceResult = null; });

    // 5. Switch to Assembly tab.
    const asmTab = win.locator('button.ribbon-tab').filter({ hasText: /^Assembly$/ });
    await expect(asmTab).toBeVisible({ timeout: 30000 });
    await asmTab.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // 6. Click Interference ribbon tool.
    const re = /^Interference$/;
    const btn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
      has: win.locator('.ribbon-tool-label', { hasText: re }),
    }).first();
    await expect(btn).toBeVisible({ timeout: 30000 });
    await btn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // 7. Wait for the handler to set window.__lastInterferenceResult.
    await win.waitForFunction(() => !!window.__lastInterferenceResult, null, { timeout: 120000 });

    const r = await win.evaluate(() => window.__lastInterferenceResult);
    console.log(`  Interference (bracket vs shaft): clash=${r.clash}, vol=${r.interferenceVolume?.toFixed(0)}`);
    // Box(40³) and Cylinder(r=20,h=40) both at origin → they overlap.
    expect(r.clash).toBe(true);
    expect(r.interferenceVolume).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Kernel-direct: self-intersection POSITIVE test ──────────────────────────
// EXEMPT: there is no ribbon workflow that builds a self-intersecting compound /
// a disjoint-positioned pair; use the kernel-direct translate + makeCompound path.
// Documented as kernel-API tests, not user-workflow tests.

test('self-intersection: a compound of two overlapping boxes is detected (kernel-direct)', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const bRaw = await K.makeBox(20, 20, 20);
    const b = await K.translate(bRaw, 10, 0, 0);   // overlaps `a`
    const compound = await K.makeCompound([a, b]);
    return K.checkSelfIntersection(compound);
  });
  expect(r.selfIntersects).toBe(true);
  expect(r.count).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  await app.close();
});

// ─── Kernel-direct: clash POSITIVE (overlapping) ─────────────────────────────
// EXEMPT: there is no ribbon workflow that builds a self-intersecting compound /
// a disjoint-positioned pair; use the kernel-direct translate + makeCompound path.
// Documented as kernel-API tests, not user-workflow tests.

test('clash: two overlapping solids clash with positive interference volume (kernel-direct)', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const bRaw = await K.makeBox(20, 20, 20);
    const b = await K.translate(bRaw, 10, 0, 0);   // overlaps `a` by 10mm
    return K.checkClash(a, b);
  });
  expect(r.clash).toBe(true);
  expect(r.interferenceVolume).toBeGreaterThan(3600);  // ~4000 (10×20×20), −10%
  expect(r.interferenceVolume).toBeLessThan(4400);
  expect(r.minDistance).toBeLessThan(0.001);
  expect(pageErrors).toEqual([]);
  await app.close();
});

// ─── Kernel-direct: clash NEGATIVE (disjoint) ────────────────────────────────
// EXEMPT: there is no ribbon workflow that builds a self-intersecting compound /
// a disjoint-positioned pair; use the kernel-direct translate + makeCompound path.
// Documented as kernel-API tests, not user-workflow tests.

test('clash: two disjoint solids report no clash with a real clearance (kernel-direct)', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const bRaw = await K.makeBox(20, 20, 20);
    const b = await K.translate(bRaw, 50, 0, 0);   // gap: box a ends x=20, b starts x=50
    return K.checkClash(a, b);
  });
  expect(r.clash).toBe(false);
  expect(r.interferenceVolume).toBeLessThan(0.001);
  expect(r.minDistance).toBeGreaterThan(27);   // ~30mm gap, ±10%
  expect(r.minDistance).toBeLessThan(33);
  expect(pageErrors).toEqual([]);
  await app.close();
});

// ─── Leak guard ───────────────────────────────────────────────────────────────
// Heap leak guard — bypasses user workflow on purpose to probe WASM heap behaviour. Exempt from the user-workflow rule.

test('leak guard: checkSelfIntersection called 25x does not grow the WASM heap (C1)', async () => {
  const { app, win, pageErrors } = await launch();
  const heap = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const oc = await window.__archdiscKernel.getOCCT();

    // Build a compound of two overlapping boxes once (reused across all calls)
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
  expect(pageErrors).toEqual([]);
  await app.close();
});
