/**
 * brep-step-electron.spec.js
 *
 * STEP round-trip: export a box, re-import it, metrics match.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ──────────────────
 * Records the whole workflow as a .webm video with key-frame stills at each
 * beat. dragOrbit shows the model in 3D motion.
 *
 * NOTE on arity-0 / import-driven ops:
 *   This spec tests exportStep + importStep — these are kernel-direct B-rep I/O
 *   operations invoked via win.evaluate(), not ribbon tools. There is no ribbon
 *   workflow that round-trips a STEP file within the kernel: the export/import
 *   pipeline requires direct kernel API access (exportStep returns a text string
 *   that is then fed back to importStep in the same evaluate call).
 *   Therefore NO clickBody is called — the test uses launchWithCapture for the
 *   video + story.frame beats, but the round-trip itself happens in-kernel.
 *   This is documented as a kernel WASM I/O test, not a user-workflow test.
 *
 * Pre-warms the kernel WASM (50 MB) before running.
 *
 * Artifacts land in:  test-results/motion/brep-step/
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { buildPrimitive } from './helpers/uiWorkflow.js';
import {
  launchWithCapture, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

test('STEP round-trip: export a box, re-import it, metrics match', async () => {
  // Artifact: box exported to STEP text and re-imported — proves the kernel's
  // exportStep + importStep pipeline is lossless (volume + face count preserved).
  // The box is also built via the real ribbon (buildPrimitive) so the
  // user-workflow path is exercised before the kernel I/O step.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-step');
  try {
    // Pre-warm the kernel WASM so the 50 MB bundle is fully instantiated
    // before attempting the STEP round-trip.
    await win.waitForFunction(async () => {
      try {
        const oc = await window.__archdiscKernel.getOCCT();
        return typeof oc.BRepPrimAPI_MakeBox_2 === 'function';
      } catch { return false; }
    }, null, { timeout: 300000 });

    // Key-frame: app ready, before any geometry.
    await story.frame('app-ready');

    // Build a Box via the real ribbon tool to exercise the user-workflow path.
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Ribbon box id: ${boxId}`);

    await story.frame('input-ribbon-box');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-ribbon-box-3d');

    // STEP round-trip via kernel API (kernel-direct; no ribbon STEP import/export UI exists).
    // Documented as a kernel WASM I/O test, not a user-workflow test.
    await story.frame('before-step-roundtrip');

    const result = await win.evaluate(async () => {
      const K = window.__archdiscKernel.kernel.brep;
      const box = await K.makeBox(10, 10, 10);
      const before = await K.measure(box);
      const stepText = await K.exportStep(box);
      const reimported = await K.importStep(stepText);
      const after = await K.measure(reimported);
      return { before, after, stepHead: stepText.slice(0, 24), stepLen: stepText.length };
    });

    await win.waitForTimeout(300);
    await story.frame('after-step-roundtrip');

    console.log(`  STEP round-trip: head=${result.stepHead}, len=${result.stepLen}`);
    console.log(`  Before: vol=${result.before.volume?.toFixed(2)}, faces=${result.before.faceCount}`);
    console.log(`  After:  vol=${result.after.volume?.toFixed(2)}, faces=${result.after.faceCount}`);

    expect(result.stepHead).toContain('ISO-10303-21');
    expect(result.stepLen).toBeGreaterThan(200);
    expect(Math.abs(result.after.volume - result.before.volume)).toBeLessThan(1);
    expect(result.after.faceCount).toBe(result.before.faceCount);

    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ────────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input-ribbon-box\.png$/.test(f));
    const outputStill = stills.find(f => /-after-step-roundtrip\.png$/.test(f));
    expect(inputStill, 'an input-ribbon-box still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-step-roundtrip still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-step-roundtrip still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
