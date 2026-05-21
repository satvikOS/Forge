/**
 * brep-g-trim-electron.spec.js
 *
 * "Operation in motion" test for auto-trimming NURBS B-rep face —
 * a "windowed sail panel": curved bicubic NURBS sail with a rectangular
 * window opening (the trim), composed with a reference Box.
 *
 * ── MOTION-CAPTURE PATTERN (see brep-g-catmullclark-electron.spec.js) ────────
 * - launchWithCapture() records the whole workflow as a .webm video.
 * - story.frame(label) drops NN-<label>.png stills at each meaningful beat.
 * - dragOrbit() shows the model in 3D with real drag gestures.
 * - captureAllAngles() does real drag-orbits for the closing orbit sweep.
 * - NOTE: no clickBody() here — the Trimmed NURBS Patch is an arity-0 creation
 *   op (it does not consume an existing body; it constructs its own geometry
 *   from scratch via injectToolParams). The Box is a context body that was also
 *   built by a creation op. Neither op requires a prior body selection.
 * Artifacts: test-results/motion/brep-g-trim/ (00-session.webm + NN-*.png)
 *
 * Workflow:
 *   1. Part tab → Box (context body, default 40×40×40 mm).
 *   2. Part tab → Trimmed NURBS Patch (sizeX=120, sizeY=90, bulge=18,
 *      trimMin=0.3, trimMax=0.7) — the climactic auto-trim op.
 *
 * Assertions (all original ones kept — video/stills are ADDITIVE):
 *   - trimStats.trimmedAreaMm2 > 0  (a non-degenerate trimmed face was produced)
 *   - trimStats.trimRatio in [0.10, 0.25]
 *   - fullAreaMm2 > trimmedAreaMm2
 *   - Multi-angle render: all frames non-blank
 *   - No page errors
 *   - NEW: the 'input-box' still and the 'after-trim' still both exist
 *     and are non-trivial in size (> 1 KB).
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool, buildPrimitive, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

// ─── Main gate test ───────────────────────────────────────────────────────────

test('Auto-trimming NURBS: windowed sail panel via ribbon trims the parametric domain', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-g-trim');
  try {
    // ── Step 1: Build a Box as the context body ──────────────────────────────
    // The scene reads as a panel in-context (complex-models directive).
    // No clickBody needed — Box is a creation op with no input body.
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Context Box built: id=${boxId}`);

    // Key-frame: the context box, then a real drag-orbit to show it in 3D.
    await story.frame('input-box');
    await dragOrbit(win, { dx: 200, dy: 80 });
    await story.frame('input-box-3d');

    // ── Step 2: Clear introspection slot before running the trim ─────────────
    await win.evaluate(() => { window.__lastTrimmedPatch = null; });

    // ── Step 3: Inject Trimmed NURBS Patch params ────────────────────────────
    // sizeX=120, sizeY=90, bulge=18, trimMin=0.3, trimMax=0.7
    // Trim window [0.3, 0.7] in both U and V → 0.4×0.4 = 0.16 of param domain.
    // On a bulged NURBS surface the area ratio differs from the param ratio.
    await injectToolParams(win, 'Trimmed NURBS Patch', {
      sizeX:   120,
      sizeY:   90,
      bulge:   18,
      trimMin: 0.3,
      trimMax: 0.7,
    });

    // ── Step 4: Switch to Part tab and click Trimmed NURBS Patch ─────────────
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    // The ToolParamDialog auto-bypasses under Playwright (navigator.webdriver=true).
    // Capture the "before trim" frame as the effective dialog beat.
    await story.frame('trim-dialog');
    await clickRibbonTool(win, 'Trimmed NURBS Patch');

    // ── Step 5: Wait for trimStats to be populated ───────────────────────────
    await win.waitForFunction(() => !!window.__lastTrimmedPatch, null, { timeout: 120000 });
    console.log('  Trimmed NURBS Patch complete');
    await win.waitForTimeout(400);
    await story.frame('after-trim');

    // Drag-orbit to show the windowed sail panel from a fresh angle.
    await dragOrbit(win, { dx: -160, dy: 100 });
    await story.frame('after-trim-3d');

    // ── Step 6: Verify trim statistics ───────────────────────────────────────
    const trim = await win.evaluate(() => window.__lastTrimmedPatch.trimStats);
    console.log(
      `  trimStats: fullArea=${trim.fullAreaMm2.toFixed(2)} mm², ` +
      `trimmedArea=${trim.trimmedAreaMm2.toFixed(2)} mm², ` +
      `trimRatio=${trim.trimRatio.toFixed(4)}`,
    );

    // The trimmed face must have positive area.
    expect(trim.trimmedAreaMm2).toBeGreaterThan(0);

    // Full area must be positive and larger than trimmed area.
    expect(trim.fullAreaMm2).toBeGreaterThan(0);
    expect(trim.fullAreaMm2).toBeGreaterThan(trim.trimmedAreaMm2);

    // Trim ratio: the parametric window is 0.4×0.4 = 0.16 of the domain.
    // On a doubly-curved sail (bulge=18 on a 120×90 patch), the surface-area
    // ratio is near the parametric ratio. Bounds [0.10, 0.25] bracket the
    // measured curved-patch result with ample margin.
    expect(trim.trimRatio).toBeGreaterThan(0.10);
    expect(trim.trimRatio).toBeLessThan(0.25);

    // ── Step 7: Multi-angle, multi-zoom visual capture via REAL drag-orbits ───
    const cap = await captureAllAngles(win, 'trim-windowed-sail', {
      azimuths:   [0, 60, 120, 180, 240, 300],
      elevations: [-30, 30],
      zooms:      [0.6, 1.0, 1.8],
      story,
    });
    console.log(`  Captured ${cap.total} angles, blanks: ${cap.blanks.length}`);

    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Step 8: Verify the storyboard stills exist and are non-trivial ────────
    const stills = story.frames();
    const inputStill  = stills.find(f => /-input-box\.png$/.test(f));
    const outputStill = stills.find(f => /-after-trim\.png$/.test(f));
    expect(inputStill,  'an input-box still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-trim still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input-box still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-trim still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    // The session video must exist and be non-trivial.
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
