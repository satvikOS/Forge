/**
 * brep-primitives-electron.spec.js
 *
 * "Operation in motion" test for solid primitives — all four in one workflow.
 * Every geometry op is invoked by clicking the real ribbon tool button
 * (Part tab, Solid Primitives group) and filling the ToolParamDialog.
 *
 * ── MOTION-CAPTURE PATTERN (see brep-g-catmullclark-electron.spec.js) ────────
 * - launchWithCapture() records the whole workflow as a .webm video.
 * - story.frame(label) drops NN-<label>.png stills at each meaningful beat.
 * - dragOrbit() shows each model in 3D with real drag gestures.
 * - captureAllAngles() does real drag-orbits for the closing orbit sweep.
 * - NOTE: no clickBody() is used here. All four primitives are arity-0
 *   creation ops — they construct geometry from scratch with no input body
 *   selection. A user simply picks the Part tab and clicks the tool.
 *
 * All four primitives are exercised in a single session to avoid the
 * Playwright Electron recordVideo teardown race that affects back-to-back
 * multi-test files (each would launch its own Electron instance and the
 * second app's screenshots would silently not write).
 *
 * Artifacts: test-results/motion/brep-primitives/ (00-session.webm + NN-*.png)
 *
 * Under Playwright (navigator.webdriver=true) the ToolParamDialog
 * auto-resolves with schema defaults immediately. Effective defaults:
 *   Cylinder  : r=20 mm, h=40 mm  → V = π×400×40 ≈ 50 265 mm³
 *   Sphere    : r=25 mm           → V = (4/3)π×15625 ≈ 65 450 mm³
 *   Cone      : r1=25 r2=8 h=45   → V = π×(45/3)×(625+200+64) ≈ 41 900 mm³
 *   Torus     : R=30 r=10         → V = 2π²×30×100 ≈ 59 218 mm³
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { captureAllAngles } from './helpers/orbitCapture.js';
import { buildPrimitive } from './helpers/uiWorkflow.js';
import { launchWithCapture, dragOrbit } from './helpers/motionCapture.js';

test.setTimeout(600000);

// ─── All four primitives in one motion-capture session ───────────────────────

test('primitives: Cylinder, Sphere, Cone, Torus — ribbon clicks build all four primitives with correct volumes', async () => {
  // Arity-0: no clickBody needed for any primitive — each is a creation op.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-primitives');
  try {

    // ── Cylinder (pin/shaft stub) ─────────────────────────────────────────────
    await buildPrimitive(win, 'Cylinder');
    await story.frame('input-cylinder');
    await dragOrbit(win, { dx: 200, dy: 80 });
    await story.frame('cylinder-3d');

    const cyl = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Cylinder (pin/shaft stub): vol=${cyl.volume.toFixed(0)}, faces=${cyl.faceCount}`);
    // r=20 h=40 → π×400×40 = 50 265.48 mm³, ±10 %
    expect(cyl.volume).toBeGreaterThan(45239);
    expect(cyl.volume).toBeLessThan(55292);
    expect(cyl.faceCount).toBeGreaterThanOrEqual(3); // top, bottom, lateral

    // ── Sphere (ball joint / bearing ball) ───────────────────────────────────
    await buildPrimitive(win, 'Sphere');
    await story.frame('input-sphere');
    await dragOrbit(win, { dx: -180, dy: 80 });
    await story.frame('sphere-3d');

    const sph = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Sphere (ball joint/bearing ball): vol=${sph.volume.toFixed(0)}, faces=${sph.faceCount}`);
    // r=25 → (4/3)π×15625 = 65 449.85 mm³, ±10 %
    expect(sph.volume).toBeGreaterThan(58905);
    expect(sph.volume).toBeLessThan(71995);
    expect(sph.faceCount).toBeGreaterThanOrEqual(1);

    // ── Cone (tapered locator / cone insert) ──────────────────────────────────
    await buildPrimitive(win, 'Cone');
    await story.frame('input-cone');
    await dragOrbit(win, { dx: 200, dy: -80 });
    await story.frame('cone-3d');

    const con = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Cone (tapered locator): vol=${con.volume.toFixed(0)}, faces=${con.faceCount}`);
    // r1=25 r2=8 h=45 → π×15×(625+200+64) ≈ 41 918 mm³, ±10 %
    expect(con.volume).toBeGreaterThan(37726);
    expect(con.volume).toBeLessThan(46110);
    expect(con.faceCount).toBeGreaterThanOrEqual(2); // cone lateral + caps

    // ── Torus (O-ring / wheel rim) ────────────────────────────────────────────
    await buildPrimitive(win, 'Torus');
    await story.frame('input-torus');
    await dragOrbit(win, { dx: -200, dy: -80 });
    await story.frame('torus-3d');

    const tor = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Torus (O-ring/wheel rim): vol=${tor.volume.toFixed(0)}, faces=${tor.faceCount}`);
    // R=30 r=10 → 2π²×30×100 = 59 217.61 mm³, ±10 %
    expect(tor.volume).toBeGreaterThan(53296);
    expect(tor.volume).toBeLessThan(65139);
    expect(tor.faceCount).toBeGreaterThanOrEqual(1);

    // ── Closing orbit sweep of the torus (last built) ─────────────────────────
    const cap = await captureAllAngles(win, 'primitives-torus', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify the storyboard stills exist and are non-trivial ────────────────
    const stills = story.frames();
    const cylStill = stills.find(f => /-input-cylinder\.png$/.test(f));
    const torStill = stills.find(f => /-input-torus\.png$/.test(f));
    expect(cylStill,  'a cylinder input still must have been captured').toBeTruthy();
    expect(torStill,  'a torus input still must have been captured').toBeTruthy();
    expect(fs.statSync(cylStill).size,
      'cylinder still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(torStill).size,
      'torus still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    // The session video must exist and be non-trivial.
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
