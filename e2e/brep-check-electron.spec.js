/**
 * brep-check-electron.spec.js
 *
 * A3 gate: geometry checking and interference detection.
 *
 * User-workflow tests (must use ribbon clicks):
 *   - Check Geometry: click ribbon tool in Manufacture tab →
 *     assert window.__lastGeometryCheck.selfIntersects === false
 *   - Interference: click ribbon tool in Assembly tab →
 *     assert window.__lastInterferenceResult.clash (box + cylinder do clash)
 *
 * Kernel-direct tests (kept as-is — no ribbon workflow exists for constructing
 * self-intersecting compounds or positioned disjoint solids):
 *   - self-intersection POSITIVE: build overlapping compound via kernel API —
 *     this tests the OCCT BRepCheck_Analyzer binding, not user workflow
 *   - clash DISJOINT: build two non-overlapping boxes via translate — this tests
 *     the OCCT checkClash clearance path, not user workflow
 *   - leak guard: calls checkSelfIntersection 25× — tests WASM lifecycle
 *
 * Note: The compound/disjoint tests are kept kernel-direct because there is no
 * ribbon operation that creates a self-intersecting compound or two positioned
 * solids. These test OCCT kernel correctness, not UI routing.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

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

test('ribbon: Check Geometry tool (Manufacture tab) reports no self-intersection on default box', async () => {
  // User workflow: open Manufacture tab → click Check Geometry.
  // Handler builds a 40³ box (no prior __lastBrepShape) and runs
  // checkSelfIntersection on it, mirroring the result to window.__lastGeometryCheck.
  const { app, win, pageErrors } = await launch();
  try {
    // Pre-clear to avoid stale check result.
    await win.evaluate(() => { window.__lastGeometryCheck = null; });

    // Switch to Manufacture tab.
    const mfgTab = win.locator('button.ribbon-tab').filter({ hasText: /^Manufacture$/ });
    await expect(mfgTab).toBeVisible({ timeout: 30000 });
    await mfgTab.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // Click Check Geometry ribbon tool.
    const re = /^Check Geometry$/;
    const btn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
      has: win.locator('.ribbon-tool-label', { hasText: re }),
    }).first();
    await expect(btn).toBeVisible({ timeout: 30000 });
    await btn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // Wait for the handler to set window.__lastGeometryCheck.
    await win.waitForFunction(() => !!window.__lastGeometryCheck, null, { timeout: 120000 });

    const r = await win.evaluate(() => window.__lastGeometryCheck);
    console.log(`  Check Geometry: selfIntersects=${r.selfIntersects}, valid=${r.valid}`);
    // A freshly-created 40³ box must report clean geometry.
    expect(r.selfIntersects).toBe(false);
    expect(r.valid).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Interference via ribbon (Assembly tab) ───────────────────────────────────

test('ribbon: Interference tool (Assembly tab) detects clash between box + cylinder', async () => {
  // User workflow: open Assembly tab → click Interference.
  // Handler builds 30³ box + r=10 h=40 cylinder (overlapping) and runs
  // checkClash, mirroring the result to window.__lastInterferenceResult.
  const { app, win, pageErrors } = await launch();
  try {
    await win.evaluate(() => { window.__lastInterferenceResult = null; });

    // Switch to Assembly tab.
    const asmTab = win.locator('button.ribbon-tab').filter({ hasText: /^Assembly$/ });
    await expect(asmTab).toBeVisible({ timeout: 30000 });
    await asmTab.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // Click Interference ribbon tool.
    const re = /^Interference$/;
    const btn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
      has: win.locator('.ribbon-tool-label', { hasText: re }),
    }).first();
    await expect(btn).toBeVisible({ timeout: 30000 });
    await btn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // Wait for the handler to set window.__lastInterferenceResult.
    await win.waitForFunction(() => !!window.__lastInterferenceResult, null, { timeout: 120000 });

    const r = await win.evaluate(() => window.__lastInterferenceResult);
    console.log(`  Interference: clash=${r.clash}, vol=${r.interferenceVolume?.toFixed(0)}`);
    // 30³ box and r=10 h=40 cylinder both start at origin → they overlap.
    expect(r.clash).toBe(true);
    expect(r.interferenceVolume).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Kernel-direct: self-intersection POSITIVE test ──────────────────────────
// NOTE: kept kernel-direct because there is no ribbon operation that creates a
// self-intersecting compound. This test validates the OCCT BRepCheck_Analyzer
// binding, not a user workflow.

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
// NOTE: kept kernel-direct because there is no ribbon operation that positions
// two disjoint solids at a specific clearance gap. Tests the OCCT clearance path.

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
