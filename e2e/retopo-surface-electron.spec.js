/**
 * retopo-surface-electron.spec.js
 *
 * "Operation in motion" retrofit — isotropic retopology on a real engineering artifact.
 * Drives everything via real ribbon clicks, REAL viewport body clicks, and drag-orbits.
 * Records the whole workflow as a .webm video with key-frame stills at each beat.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ─────────────────────
 *
 * Artifact: rounded bracket plate (Box 40³ → Fillet r=2 mm).
 * Op: Part tab → Retopo Surface (targetEdgeLength=0 auto, iterations=5).
 *
 * NOTE: the op INPUT is a B-rep body (clickBody works on it); the op RESULT is a
 * raw THREE mesh (window.__lastRetopoMesh), NOT a registry body — do NOT clickBody
 * the result; story.frame + dragOrbit show it instead.
 *
 * Assertions (all original ones kept — video/stills are ADDITIVE):
 *   - retopoTris > 0, retopoVerts > 0 (mesh produced)
 *   - Bounding box of retopo'd mesh ≈ input fillet bbox (within ~5 mm per axis)
 *   - captureAllAngles blanks empty, pageErrors empty
 *   - NEW: the 'input-plate' still and the 'after-retopo' still both exist
 *     and are non-trivial in size (> 1 KB).
 *
 * Artifacts land in:  test-results/motion/retopo-surface/
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

// ─── Main gate test ───────────────────────────────────────────────────────────

test('Retopo Surface: clicking ribbon retopologises a real-world artifact (rounded plate)', async () => {
  // Artifact: rounded bracket plate — Box(40³) → Fillet(r=2) → isotropic retopo.
  const { app, win, pageErrors, story } = await launchWithCapture('retopo-surface');
  try {
    // ── Step 1: Build Box (40×40×40 mm³ — rounded plate blank) ────────────────
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box built: id=${boxId}`);

    // Key-frame: the input box, then a real drag-orbit to show it in 3D.
    await story.frame('input-box');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-box-3d');

    // ── Step 2: Select box with REAL click, then apply Fillet (r=2) ──────────
    await clickBody(win, boxId);

    const idBeforeFillet = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    await injectToolParams(win, 'Fillet', { radius: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('fillet-dialog');
    await clickRibbonTool(win, 'Fillet');

    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBeforeFillet,
      { timeout: 60000 },
    );
    await win.waitForTimeout(300);
    await story.frame('after-fillet');

    // Get the filleted body's registry id.
    const filletedId = await win.evaluate(() => {
      const reg = window.__archdiscRegistry;
      if (reg && reg.bodies && reg.bodies.length > 0) {
        return reg.bodies[reg.bodies.length - 1].id;
      }
      return window.__lastBrepShape && window.__lastBrepShape.id;
    });
    console.log(`  Fillet applied: id=${filletedId}`);

    // ── Step 3: Measure the filleted plate bbox for preservation assertions ───
    const filletedStats = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    const fBBox = filletedStats.boundingBox;
    const fDx = fBBox.max[0] - fBBox.min[0];
    const fDy = fBBox.max[1] - fBBox.min[1];
    const fDz = fBBox.max[2] - fBBox.min[2];
    console.log(`  Filleted plate bbox: dx=${fDx.toFixed(2)}, dy=${fDy.toFixed(2)}, dz=${fDz.toFixed(2)}`);

    // Key-frame: the filleted plate is the retopo input — capture it before the op.
    await story.frame('input-plate');
    await dragOrbit(win, { dx: -180, dy: 80 });
    await story.frame('input-plate-3d');

    // ── Step 4: Select the filleted plate with a REAL viewport click ──────────
    // The Fillet op removed the box — only the filleted body remains, so no
    // origin-crowding risk.
    await clickBody(win, filletedId);

    // ── Step 5: Clear stale retopo result, inject params, run Retopo Surface ──
    await win.evaluate(() => { window.__lastRetopoMesh = null; });
    await injectToolParams(win, 'Retopo Surface', { targetEdgeLength: 0, iterations: 5 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('retopo-dialog');
    await clickRibbonTool(win, 'Retopo Surface');

    // ── Step 6: Wait for __lastRetopoMesh ────────────────────────────────────
    // The result is a raw THREE mesh — NOT a registry body. Do NOT clickBody it.
    await win.waitForFunction(() => !!window.__lastRetopoMesh, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    // Show the retopo'd mesh with drag-orbits (rendered in the viewport).
    await story.frame('after-retopo');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('after-retopo-3d');

    // ── Step 7: Mesh validity assertions ──────────────────────────────────────
    const r = await win.evaluate(() => window.__lastRetopoMesh.stats);
    console.log(`  Retopo stats: baseTris=${r.baseTris}, retopoTris=${r.retopoTris}, retopoVerts=${r.retopoVerts}, weldedVerts=${r.weldedVerts}`);

    expect(r.retopoTris).toBeGreaterThan(0);
    expect(r.retopoVerts).toBeGreaterThan(0);

    // ── Step 8: Bounding-box preservation (within ~5 mm per axis) ─────────────
    const bbox = await win.evaluate(() => {
      const p = window.__lastRetopoMesh.positions;
      const mn = [Infinity, Infinity, Infinity];
      const mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          if (p[i + a] < mn[a]) mn[a] = p[i + a];
          if (p[i + a] > mx[a]) mx[a] = p[i + a];
        }
      }
      return { dx: mx[0] - mn[0], dy: mx[1] - mn[1], dz: mx[2] - mn[2] };
    });
    console.log(`  Retopo bbox: dx=${bbox.dx.toFixed(2)}, dy=${bbox.dy.toFixed(2)}, dz=${bbox.dz.toFixed(2)}`);

    // Retopo'd mesh must span at least (inputDim - 5 mm) per axis.
    expect(bbox.dx).toBeGreaterThan(fDx - 5);
    expect(bbox.dy).toBeGreaterThan(fDy - 5);
    expect(bbox.dz).toBeGreaterThan(fDz - 5);

    // ── Step 9: Multi-angle render via REAL drag-orbits — no blank frames ──────
    const cap = await captureAllAngles(win, 'retopo', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Step 10: Verify storyboard stills exist and are non-trivial ───────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input-plate\.png$/.test(f));
    const outputStill = stills.find(f => /-after-retopo\.png$/.test(f));
    expect(inputStill, 'an input-plate still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-retopo still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-retopo still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);

  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
