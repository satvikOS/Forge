/**
 * brep-foundation-electron.spec.js
 *
 * A0 gate: OCCT B-rep kernel wiring + WASM heap lifecycle.
 *
 * Box build: driven by buildPrimitive('Box') helper (clicks real ribbon
 * tool + dialog bypass via __archdiscPlanParams) — NOT a direct kernel call.
 *
 * WASM heap leak guard: intentionally calls makeBox/brepToMesh/dispose
 * 20× via the kernel API directly. There is no ribbon workflow that probes
 * WASM heap behaviour — this test validates the OCCT WASM lifecycle, not
 * user-visible geometry building.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { buildPrimitive } from './helpers/uiWorkflow.js';

const SHOT = path.resolve(__dirname, 'screenshots');

test.setTimeout(600000); // OCCT WASM is 50 MB; allow up to 10 min for full pipeline

test('A0 gate: OCCT box builds, measures, renders, and leak-guards via ribbon in the Electron app', async () => {
  // Artifact: test cube (the platform's foundational primitive — proves the OCCT pipeline)
  fs.mkdirSync(SHOT, { recursive: true });
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const consoleLogs = [];
  const pageErrors = [];
  const win = await app.firstWindow();
  win.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });

  // ── Pre-warm OCCT WASM load ──────────────────────────────────────────────
  // getOCCT() is cached; calling it here lets us see load errors early and
  // ensures the 50 MB WASM is fully instantiated before the ribbon click.
  await win.waitForFunction(async () => {
    try {
      const oc = await window.__archdiscKernel.getOCCT();
      window.__occtPreWarmed = { ok: true, hasBox: typeof oc.BRepPrimAPI_MakeBox_2 === 'function' };
    } catch (e) {
      window.__occtPreWarmed = { ok: false, error: String(e) };
    }
    return !!window.__occtPreWarmed;
  }, null, { timeout: 300000 });
  const occtReady = await win.evaluate(() => window.__occtPreWarmed);
  console.log('  OCCT pre-warm:', JSON.stringify(occtReady));
  expect(occtReady.ok, `OCCT load failed: ${occtReady.error}`).toBe(true);
  expect(occtReady.hasBox).toBe(true);

  // ── Drive the op via the real ribbon Box button (UI wiring check) ────────
  // buildPrimitive clicks the Part-tab ribbon tool and accepts dialog defaults
  // (40×40×40 mm) via __archdiscPlanParams bypass — no direct kernel call.
  await buildPrimitive(win, 'Box');

  // ── Assert geometry metrics: 40mm box -> volume ~64000 mm³, 6 faces, 12 edges ──
  const metrics = await win.evaluate(async () =>
    window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
  );
  expect(metrics.volume).toBeGreaterThan(63000);
  expect(metrics.volume).toBeLessThan(65000);
  expect(metrics.faceCount).toBe(6);
  expect(metrics.edgeCount).toBe(12);
  console.log(`  A0 box metrics: vol ${metrics.volume.toFixed(2)} mm³, ` +
    `${metrics.faceCount} faces, ${metrics.edgeCount} edges`);

  // ── Assert the viewport is non-blank (geometry actually rendered) ──
  await win.waitForTimeout(500);
  const shot = await win.locator('canvas').first().screenshot({
    path: path.join(SHOT, 'brep-ribbon-box.png'),
  });
  expect(shot.length).toBeGreaterThan(2000); // a blank canvas PNG is tiny

  // Heap leak guard — bypasses user workflow on purpose to probe WASM heap behaviour. Exempt from the user-workflow rule.
  // This loop intentionally bypasses user workflow to probe WASM heap
  // behaviour. There is no ribbon operation that creates 20 temporary shapes,
  // measures them, and disposes them in a loop — that is a WASM lifecycle test,
  // not a geometry test.
  const heap = await win.evaluate(async () => {
    const oc = await window.__archdiscKernel.getOCCT();
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
    for (let i = 0; i < 20; i++) {
      const s = await window.__archdiscKernel.kernel.brep.makeBox(5, 5, 5);
      await window.__archdiscKernel.kernel.brep.brepToMesh(s);
      s.dispose();
    }
    const after = getHeapSize(oc);
    return { before, after, heapExposed: before > 0 };
  });
  if (heap.heapExposed) {
    expect(heap.after - heap.before).toBeLessThan(8 * 1024 * 1024);
  }
  console.log(`  Leak guard: heap ${heap.before} -> ${heap.after} (exposed: ${heap.heapExposed})`);

  expect(pageErrors).toEqual([]);
  await app.close();
});
