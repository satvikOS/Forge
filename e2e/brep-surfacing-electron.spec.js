/**
 * brep-surfacing-electron.spec.js
 *
 * "Operation in motion" retrofit — surfacing operations on real engineering artifacts.
 * Drives everything via real ribbon clicks and drag-orbits.
 * Records the whole workflow as a .webm video with key-frame stills at each beat.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ─────────────────────
 *
 * Arity-0 (no body selection, dialog defines geometry):
 *   Sweep Boss : pipe (circular profile swept along axis) — r=8, 60 mm path
 *                → V = π×64×60 ≈ 12 064 mm³
 *   Loft Boss  : transition fitting (square-to-square loft) — 40→16 over 50 mm
 *                → V ≈ 41 600 mm³
 *
 * Artifacts land in:  test-results/motion/brep-surfacing-<op>/
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { captureAllAngles } from './helpers/orbitCapture.js';
import { buildPrimitive } from './helpers/uiWorkflow.js';
import {
  launchWithCapture, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

// ─── Sweep Boss ───────────────────────────────────────────────────────────────

test('Sweep Boss: pipe (circular profile swept along axis) — ribbon click + dialog defaults → r=8 disk swept 60 mm, V in (10858, 13270)', async () => {
  // Artifact: pipe (circular profile swept along axis)
  // Arity-0: no body selection. Dialog defaults: radius=8, length=60.
  // A circular cross-section (r=8 mm) swept along a 60 mm straight axis produces
  // a solid pipe segment — as used in hydraulic lines, structural tube members,
  // or conduit runs.
  // sweep(r=8, 60) → π×64×60 = 12 063.72 mm³, ±10%
  const { app, win, pageErrors, story } = await launchWithCapture('brep-surfacing-sweep');
  try {
    // Click Part tab → Sweep Boss → accept dialog defaults.
    const pipeId = await buildPrimitive(win, 'Sweep Boss');
    console.log(`  Sweep Boss (pipe) id: ${pipeId}`);

    // Key-frame: the produced pipe, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Sweep Boss (pipe): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // π×64×60 = 12 063.72 mm³, ±10%
    expect(m.volume).toBeGreaterThan(10858);
    expect(m.volume).toBeLessThan(13270);

    await story.frame('after-sweep-boss');

    const cap = await captureAllAngles(win, 'sweep-boss', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-sweep-boss\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-sweep-boss still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-sweep-boss still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});

// ─── Loft Boss ────────────────────────────────────────────────────────────────

test('Loft Boss: transition fitting (square-to-square loft) — ribbon click + dialog defaults → 40→16 squares over 50 mm, V in (37440, 45760)', async () => {
  // Artifact: transition fitting (square-to-square loft)
  // Arity-0: no body selection. Dialog defaults: bottomSize=40, topSize=16, height=50.
  // A square-to-square loft over 50 mm produces a transition fitting — as used in
  // HVAC ductwork reducers, pressure vessel nozzle transitions, or casting sprue gates.
  // V = h/3×(A1+A2+√(A1×A2)) = 50/3×(1600+256+640) = 50/3×2496 ≈ 41 600 mm³, ±10%
  const { app, win, pageErrors, story } = await launchWithCapture('brep-surfacing-loft');
  try {
    // Click Part tab → Loft Boss → accept dialog defaults.
    const loftId = await buildPrimitive(win, 'Loft Boss');
    console.log(`  Loft Boss (transition fitting) id: ${loftId}`);

    // Key-frame: the produced loft fitting, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-3d');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Loft Boss (transition fitting): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // ±10% around 41 600 mm³
    expect(m.volume).toBeGreaterThan(37440);
    expect(m.volume).toBeLessThan(45760);

    await story.frame('after-loft-boss');

    const cap = await captureAllAngles(win, 'loft-boss', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ───────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-loft-boss\.png$/.test(f));
    expect(inputStill, 'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-loft-boss still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-loft-boss still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
