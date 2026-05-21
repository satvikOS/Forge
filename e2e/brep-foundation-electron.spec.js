/**
 * brep-foundation-electron.spec.js
 *
 * A0 gate: ArchDisc B-rep kernel wiring + WASM heap lifecycle.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ──────────────────
 * Records the whole workflow as a .webm video with key-frame stills at each
 * beat. REAL drag-orbits show the geometry in motion.
 *
 * Box build: driven by buildPrimitive('Box') helper (clicks real ribbon
 * tool + dialog bypass via __archdiscPlanParams) — NOT a direct kernel call.
 *
 * WASM heap leak guard: intentionally calls makeBox/brepToMesh/dispose
 * 20× via the kernel API directly. There is no ribbon workflow that probes
 * WASM heap behaviour — this test validates the kernel WASM lifecycle, not
 * user-visible geometry building.
 *
 * Artifacts land in:  test-results/motion/brep-foundation/
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { buildPrimitive } from './helpers/uiWorkflow.js';
import {
  launchWithCapture, dragOrbit,
} from './helpers/motionCapture.js';

const SHOT = path.resolve(__dirname, 'screenshots');

test.setTimeout(600000); // Kernel WASM is 50 MB; allow up to 10 min for full pipeline

test('A0 gate: B-rep box builds, measures, renders, and leak-guards via ribbon in the Electron app', async () => {
  // Artifact: test cube (the platform's foundational primitive — proves the kernel pipeline)
  fs.mkdirSync(SHOT, { recursive: true });

  const { app, win, pageErrors, story } = await launchWithCapture('brep-foundation');
  const consoleLogs = [];
  win.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  try {
    // ── Pre-warm kernel WASM load ─────────────────────────────────────────────
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
    console.log('  kernel pre-warm:', JSON.stringify(occtReady));
    expect(occtReady.ok, `Kernel load failed: ${occtReady.error}`).toBe(true);
    expect(occtReady.hasBox).toBe(true);

    // Key-frame: the app before any geometry (empty viewport).
    await story.frame('app-ready');

    // ── Drive the op via the real ribbon Box button (UI wiring check) ─────────
    // buildPrimitive clicks the Part-tab ribbon tool and accepts dialog defaults
    // (40×40×40 mm) via __archdiscPlanParams bypass — no direct kernel call.
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // Key-frame: the box after build, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // ── Assert geometry metrics: 40mm box → volume ~64000 mm³, 6 faces, 12 edges ──
    const metrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    expect(metrics.volume).toBeGreaterThan(63000);
    expect(metrics.volume).toBeLessThan(65000);
    expect(metrics.faceCount).toBe(6);
    expect(metrics.edgeCount).toBe(12);
    console.log(`  A0 box metrics: vol ${metrics.volume.toFixed(2)} mm³, ` +
      `${metrics.faceCount} faces, ${metrics.edgeCount} edges`);

    await story.frame('after-box');

    // ── Assert the viewport is non-blank (geometry actually rendered) ─────────
    await win.waitForTimeout(500);
    const shot = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'brep-ribbon-box.png'),
    });
    expect(shot.length).toBeGreaterThan(2000); // a blank canvas PNG is tiny

    // ── Drag-orbit to show the box from different angles ──────────────────────
    await dragOrbit(win, { dx: -180, dy: -60 });
    await story.frame('box-angle-2');
    await dragOrbit(win, { dx: 90, dy: 120 });
    await story.frame('box-angle-3');

    // Heap leak guard — bypasses user workflow on purpose to probe WASM heap behaviour.
    // EXEMPT from the user-workflow rule: probes the WASM lifecycle, not geometry.
    // There is no ribbon operation that creates 20 temporary shapes, measures them,
    // and disposes them in a loop.
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

    // ── Verify storyboard stills exist and are non-trivial ────────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-box\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-box still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-box still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
