import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SHOT = path.resolve(__dirname, 'screenshots');

test.setTimeout(600000); // OCCT WASM is 50 MB; allow up to 10 min for full pipeline

test('A0 gate: OCCT box builds, measures, renders, and leak-guards in the Electron app', async () => {
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

  // ── Pre-warm OCCT WASM load before clicking the button ──────────────────
  // getOCCT() is cached; calling it here lets us see load errors early and
  // ensures the 50 MB WASM is fully instantiated before the button pipeline.
  // waitForFunction with 5-min timeout to cover the 50 MB WASM load
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

  // ── Diagnostic: call renderBox directly to surface any error ───────────
  const boxDiag = await win.evaluate(async () => {
    try {
      const metrics = await window.__archdiscKernel.renderBox(10, 10, 10);
      return { ok: true, metrics };
    } catch (e) {
      return { ok: false, error: String(e), stack: e.stack };
    }
  });
  console.log('  renderBox direct result:', JSON.stringify(boxDiag));
  expect(boxDiag.ok, `renderBox failed: ${boxDiag.error}\n${boxDiag.stack}`).toBe(true);

  // ── Drive the op via the real B-rep Lab button (UI wiring check) ──
  // __lastBrepMetrics was set by the direct renderBox call above; the button
  // click confirms UI wiring works end-to-end.
  const boxBtn = win.locator('[data-testid="brep-lab-box"]');
  await expect(boxBtn).toBeVisible({ timeout: 30000 });
  // Clear metrics so we can verify the button also sets them.
  await win.evaluate(() => { window.__lastBrepMetrics = null; });
  await boxBtn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await win.waitForFunction(() => !!window.__lastBrepMetrics, null, { timeout: 120000 });

  // ── Assert geometry metrics: 10mm box -> volume ~1000 mm3, 6 faces, 12 unique edges ──
  const metrics = await win.evaluate(() => window.__lastBrepMetrics);
  expect(metrics.volume).toBeGreaterThan(990);
  expect(metrics.volume).toBeLessThan(1010);
  expect(metrics.faceCount).toBe(6);
  expect(metrics.edgeCount).toBe(12);
  console.log(`  A0 box metrics: vol ${metrics.volume.toFixed(2)} mm3, ` +
    `${metrics.faceCount} faces, ${metrics.edgeCount} edges`);

  // ── Assert the viewport is non-blank (geometry actually rendered) ──
  await win.waitForTimeout(500);
  const shot = await win.locator('canvas').first().screenshot({
    path: path.join(SHOT, 'brep-a0-box.png'),
  });
  expect(shot.length).toBeGreaterThan(2000); // a blank canvas PNG is tiny

  // ── Leak guard: build the box 20x and assert the WASM heap is bounded ──
  const heap = await win.evaluate(async () => {
    const oc = await window.__archdiscKernel.getOCCT();
    // Find the heap view — Emscripten exposes it under various names
    // depending on the build. Check HEAPU8 on the oc object itself, or
    // on oc.FS, or look for any HEAP* key.
    function getHeapSize(oc) {
      if (oc.HEAPU8 && oc.HEAPU8.buffer) return oc.HEAPU8.buffer.byteLength;
      if (oc.HEAP8 && oc.HEAP8.buffer) return oc.HEAP8.buffer.byteLength;
      // Walk known aliases
      const heapKeys = Object.keys(oc).filter(k => /^HEAP/.test(k));
      for (const k of heapKeys) {
        const v = oc[k];
        if (v && v.buffer) return v.buffer.byteLength;
      }
      // fallback: no heap view exposed — return 0 (skip size check)
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
  // Emscripten heap may grow once, but must not grow per-iteration.
  // If heapExposed is false the binding doesn't expose HEAPU8 — skip the
  // size check but still confirm the loop ran without throwing.
  if (heap.heapExposed) {
    expect(heap.after - heap.before).toBeLessThan(8 * 1024 * 1024);
  }
  console.log(`  Leak guard: heap ${heap.before} -> ${heap.after} (exposed: ${heap.heapExposed})`);

  expect(pageErrors).toEqual([]);
  await app.close();
});
