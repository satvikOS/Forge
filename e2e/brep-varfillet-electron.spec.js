/**
 * brep-varfillet-electron.spec.js
 *
 * "Operation in motion" retrofit — variable-radius fillet on a real engineering artifact.
 * Drives everything via real ribbon clicks, REAL viewport body clicks, and drag-orbits.
 * Records the whole workflow as a .webm video with key-frame stills at each beat.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ─────────────────────
 *
 * Artifact: phone-case edge (variable radius)
 *
 * Arity-1 workflow:
 *   1. Build Box (40³) via ribbon + dialog — the case blank.
 *   2. Select the Box body (REAL viewport click).
 *   3. Click Variable Radius Fillet → fill dialog (r1=1, r2=4).
 *   4. Measure: V in (50000, 63900), faceCount > 6.
 *
 * Variable-radius fillet simulates the ergonomic edge treatment on a
 * consumer electronics housing — tight radius (r1=1) at corners,
 * looser radius (r2=4) along the long edges.
 *
 * Artifacts land in:  test-results/motion/brep-varfillet/
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

// ─── Variable Radius Fillet ───────────────────────────────────────────────────

test('Variable Radius Fillet: phone-case edge (variable radius) — build 40³ box → select → ribbon click → r1=1→r2=4 dialog → V in (50000, 63900), faceCount > 6', async () => {
  // Artifact: phone-case edge (variable radius)
  // A 40×40×40 mm case blank (Box) with variable-radius edge treatment:
  // tight radius (r1=1 mm) at the tight corners, flowing to a larger radius
  // (r2=4 mm) along the long edges — mimicking the ergonomic edge of a
  // consumer electronics housing or hand-held device body.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-varfillet');
  try {
    // 1. Build the case blank (Box 40³) via the Box primitive (user workflow).
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // Key-frame: the input box, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    // 2. Select the body for the Variable Radius Fillet op with a REAL viewport click.
    await clickBody(win, boxId);

    // 3. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Variable Radius Fillet.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Variable Radius Fillet', { r1: 1, r2: 4 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await story.frame('varfillet-dialog');
    await clickRibbonTool(win, 'Variable Radius Fillet');

    // 5. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-varfillet');

    // 6. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Variable Radius Fillet (phone-case edge): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(50000);
    expect(m.volume).toBeLessThan(63900);
    expect(m.faceCount).toBeGreaterThan(6);

    const cap = await captureAllAngles(win, 'varfillet', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-varfillet\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-varfillet still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-varfillet still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
