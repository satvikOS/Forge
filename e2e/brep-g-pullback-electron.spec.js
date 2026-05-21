/**
 * brep-g-pullback-electron.spec.js
 *
 * "Operation in motion" test for surface pull-back in retopology.
 *
 * ── MOTION-CAPTURE PATTERN (see brep-g-catmullclark-electron.spec.js) ────────
 * - launchWithCapture() records the whole workflow as a .webm video.
 * - clickBody() — REAL viewport mouse click — selects the sphere body.
 * - story.frame(label) drops NN-<label>.png stills at each meaningful beat.
 * - dragOrbit() shows the model in 3D with real drag gestures.
 * - captureAllAngles() does real drag-orbits for the closing orbit sweep.
 * Artifacts: test-results/motion/brep-g-pullback/ (00-session.webm + NN-*.png)
 *
 * Artifact: sphere (Primitive, default R=25 mm).
 * Workflow: Part tab → Sphere → select → Retopo Surface (targetEdgeLength=3,
 *           iterations=5, pullBackToSurface=1).
 *
 * Assertions (all original ones kept — video/stills are ADDITIVE):
 *   - Vertex count > 0
 *   - Average radius of retopo'd vertices within [24.0, 26.0] mm (±4%)
 *   - max–min radius spread < 2 mm (pull-back keeps vertices on-sphere)
 *   - window.__lastRetopoProjection.projections > 0 (pull-back was active)
 *   - captureAllAngles blanks empty, pageErrors empty
 *   - NEW: the 'input' still and the 'after-retopo' still both exist
 *     and are non-trivial in size (> 1 KB).
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool, buildPrimitive, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, clickBody, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

// ─── Main gate test ───────────────────────────────────────────────────────────

test('Retopo with surface pull-back: sphere retopo keeps vertices on surface', async () => {
  const { app, win, pageErrors, story } = await launchWithCapture('brep-g-pullback');
  try {
    // ── Step 1: Build a sphere (default R=25 mm) ──────────────────────────────
    // Note: the default sphere radius in the schema is 25 mm; the assertions
    // below check against R=25 (expected range 24–26 mm).
    const sphereId = await buildPrimitive(win, 'Sphere');
    console.log(`  Sphere built: id=${sphereId}`);

    // Key-frame: the input sphere, then a real drag-orbit to show it in 3D.
    await story.frame('input');
    await dragOrbit(win, { dx: 200, dy: 80 });
    await story.frame('input-3d');

    // ── Step 2: Clear introspection slots before retopo ───────────────────────
    await win.evaluate(() => {
      window.__lastRetopoMesh = null;
      window.__lastRetopoProjection = null;
    });

    // ── Step 3: Select sphere (REAL viewport click) and run Retopo Surface ────
    await clickBody(win, sphereId);
    await injectToolParams(win, 'Retopo Surface', {
      targetEdgeLength:  3,
      iterations:        5,
      pullBackToSurface: 1,
    });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('retopo-dialog');
    await clickRibbonTool(win, 'Retopo Surface');

    // Wait for retopo to complete — can take up to 3 min on sphere at L=3mm.
    await win.waitForFunction(() => !!window.__lastRetopoMesh, null, { timeout: 180000 });
    console.log('  Retopo complete');
    await win.waitForTimeout(400);
    await story.frame('after-retopo');

    // Drag-orbit to show the retopologised surface from a different angle.
    await dragOrbit(win, { dx: -180, dy: 80 });
    await story.frame('after-retopo-3d');

    // ── Step 4: Read back mesh stats ──────────────────────────────────────────
    const stats = await win.evaluate(() => window.__lastRetopoMesh.stats);
    console.log(
      `  Stats: baseTris=${stats.baseTris}, retopoTris=${stats.retopoTris}, ` +
      `retopoVerts=${stats.retopoVerts}, projections=${stats.projections}, ` +
      `maxProjectionDelta=${stats.maxProjectionDelta != null ? stats.maxProjectionDelta.toFixed(4) : 'n/a'} mm`,
    );

    expect(stats.retopoTris).toBeGreaterThan(0);
    expect(stats.retopoVerts).toBeGreaterThan(0);

    // ── Step 5: Radius distribution — all vertices should lie on the sphere ───
    const radii = await win.evaluate(() => {
      const p = window.__lastRetopoMesh.positions;
      const out = { count: 0, minR: Infinity, maxR: -Infinity, sumR: 0 };
      for (let i = 0; i < p.length; i += 3) {
        const r = Math.hypot(p[i], p[i + 1], p[i + 2]);
        if (r < out.minR) out.minR = r;
        if (r > out.maxR) out.maxR = r;
        out.sumR += r;
        out.count++;
      }
      out.avgR = out.sumR / out.count;
      return out;
    });
    console.log(
      `  Radius: count=${radii.count}, avg=${radii.avgR.toFixed(3)}, ` +
      `min=${radii.minR.toFixed(3)}, max=${radii.maxR.toFixed(3)}, ` +
      `spread=${(radii.maxR - radii.minR).toFixed(3)} mm`,
    );

    expect(radii.count).toBeGreaterThan(0);
    // Average radius within ±4% of R=25mm.
    expect(radii.avgR).toBeGreaterThan(24.0);
    expect(radii.avgR).toBeLessThan(26.0);
    // Pull-back should keep spread tight (< 2 mm on R=25 sphere).
    expect(radii.maxR - radii.minR).toBeLessThan(2);

    // ── Step 6: Projection stats — pull-back must have fired ─────────────────
    const proj = await win.evaluate(() => window.__lastRetopoProjection);
    console.log(
      `  Projection: projections=${proj.projections}, ` +
      `maxProjectionDelta=${proj.maxProjectionDelta != null ? proj.maxProjectionDelta.toFixed(4) : 'n/a'} mm`,
    );
    expect(proj).not.toBeNull();
    expect(proj.projections).toBeGreaterThan(0);

    // ── Step 7: Multi-angle, multi-zoom visual capture via REAL drag-orbits ───
    const cap = await captureAllAngles(win, 'retopo-pullback-sphere', {
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
    const inputStill  = stills.find(f => /-input\.png$/.test(f));
    const outputStill = stills.find(f => /-after-retopo\.png$/.test(f));
    expect(inputStill,  'an input still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-retopo still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-retopo still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    // The session video must exist and be non-trivial.
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
