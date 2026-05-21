/**
 * subdivide-surface-electron.spec.js
 *
 * "Operation in motion" retrofit — Loop subdivision on a real engineering artifact.
 * Drives everything via real ribbon clicks, REAL viewport body clicks, and drag-orbits.
 * Records the whole workflow as a .webm video with key-frame stills at each beat.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ─────────────────────
 *
 * Artifact: ergonomic handle (smooth-organic from prismatic Extrude Boss)
 *
 * Input: Extrude Boss (accept dialog defaults → 80×50×25 mm prismatic plate/beam)
 *   The Extrude Boss produces a prismatic solid — a structural beam cross-section
 *   that serves as the blank for an ergonomic handle grip. Subdivision smooths
 *   the prismatic blank into the organic curved form of a moulded handle.
 *
 * Focal op: Part tab → Subdivide Surface (levels=2, dihedralDeg=30, deflection=0.5)
 *
 * NOTE: the op INPUT is a B-rep body (clickBody works on it); the op RESULT is a
 * raw THREE mesh (window.__lastSubdivMesh), NOT a registry body — do NOT clickBody
 * the result; story.frame + dragOrbit show it instead.
 *
 * Assertions (all original ones kept — video/stills are ADDITIVE):
 *   - refinedTris > baseTris × 8  (≥8× growth after 2 Loop steps)
 *   - weldedVerts < baseVerts      (per-face duplicates were merged)
 *   - creaseEdges ≥ 12             (sharp prismatic edges of the Extrude Boss
 *                                   detected at 30° dihedral threshold)
 *   - post-subdivide bbox ≥ 10% of max axis in each axis (no severe pinching)
 *   - captureAllAngles blanks empty, pageErrors empty
 *   - NEW: the 'input-handle' still and the 'after-subdivide' still both exist
 *     and are non-trivial in size (> 1 KB).
 *
 * Artifacts land in:  test-results/motion/subdivide-surface/
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

test('Subdivide Surface: ergonomic handle (smooth-organic from prismatic Extrude Boss) — Extrude Boss → 2 Loop steps — no pinching, all angles render', async () => {
  // Artifact: ergonomic handle (smooth-organic from prismatic Extrude Boss)
  // An Extrude Boss (80×50×25 mm — the handle blank) is subdivided with Loop
  // subdivision (levels=2) to produce the smooth organic form of a moulded
  // ergonomic grip handle. Crease edges at the prismatic transitions (dihedral ≥ 30°)
  // preserve the handle's structural ridge lines while the flat faces are smoothed.
  const { app, win, pageErrors, story } = await launchWithCapture('subdivide-surface');
  try {
    // ── Step 1: Build Extrude Boss (handle blank, accept defaults) ─────────────
    // Extrude Boss is arity-0: no body selection needed.
    // Defaults: width=80, depth=50, height=25 → 80×50×25 mm prismatic plate.
    const handleId = await buildPrimitive(win, 'Extrude Boss');
    console.log(`  Extrude Boss (handle blank) id: ${handleId}`);

    // Key-frame: the input handle blank, then a real drag-orbit to show it in 3D.
    await story.frame('input-handle');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('input-handle-3d');

    // ── Step 2: Compute the Extrude Boss bbox (pre-subdivide) via kernel ──────
    const preBbox = await win.evaluate(async () => {
      const m = await window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape);
      // measure() may return {volume, area, faceCount, edgeCount, bbox: {xmin,xmax,...}}
      const bb = m.bbox;
      if (bb) {
        return {
          dx: bb.xmax - bb.xmin,
          dy: bb.ymax - bb.ymin,
          dz: bb.zmax - bb.zmin,
        };
      }
      // Extrude Boss defaults: 80×50×25mm → fallback expected bbox.
      return { dx: 80, dy: 50, dz: 25 };
    });
    console.log(`  Extrude Boss bbox: dx=${preBbox.dx.toFixed(1)}, dy=${preBbox.dy.toFixed(1)}, dz=${preBbox.dz.toFixed(1)}`);

    // ── Step 3: Select the handle blank with a REAL viewport click ────────────
    await clickBody(win, handleId);

    // ── Step 4: Clear stale subdivision result, inject params, subdivide ──────
    await win.evaluate(() => { window.__lastSubdivMesh = null; });
    await injectToolParams(win, 'Subdivide Surface', { levels: 2, dihedralDeg: 30, deflection: 0.5 });

    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(150);
    await story.frame('subdivide-dialog');
    await clickRibbonTool(win, 'Subdivide Surface');

    // ── Step 5: Wait for __lastSubdivMesh ─────────────────────────────────────
    // The result is a raw THREE mesh — NOT a registry body. Do NOT clickBody it.
    await win.waitForFunction(() => !!window.__lastSubdivMesh, null, { timeout: 120000 });
    await win.waitForTimeout(400);
    // Show the subdivided mesh with a drag-orbit (it is rendered in the viewport).
    await story.frame('after-subdivide');
    await dragOrbit(win, { dx: -200, dy: 80 });
    await story.frame('after-subdivide-3d');

    // ── Step 6: Triangle-count growth assertions ───────────────────────────────
    const stats = await win.evaluate(() => window.__lastSubdivMesh.stats);
    console.log(`  Subdiv stats: baseTris=${stats.baseTris}, refinedTris=${stats.refinedTris}, weldedVerts=${stats.weldedVerts}, baseVerts=${stats.baseVerts}, creaseEdges=${stats.creaseEdges}`);

    // Each Loop step is ×4 in theory; 2 steps = ×16; floor at ×8 (conservative).
    expect(stats.refinedTris).toBeGreaterThan(stats.baseTris * 8);

    // Tessellation gives per-face duplicate boundary verts; welding must reduce count.
    expect(stats.weldedVerts).toBeLessThan(stats.baseVerts);

    // The Extrude Boss has 12 sharp prismatic edges — all detected at 30° threshold.
    expect(stats.creaseEdges).toBeGreaterThanOrEqual(12);

    // ── Step 7: No-pinching bbox check ────────────────────────────────────────
    const postBbox = await win.evaluate(() => {
      const p = window.__lastSubdivMesh.positions;
      const mn = [Infinity,  Infinity,  Infinity];
      const mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          if (p[i + a] < mn[a]) mn[a] = p[i + a];
          if (p[i + a] > mx[a]) mx[a] = p[i + a];
        }
      }
      return { dx: mx[0] - mn[0], dy: mx[1] - mn[1], dz: mx[2] - mn[2] };
    });
    console.log(`  Post-subdiv bbox: dx=${postBbox.dx.toFixed(3)}, dy=${postBbox.dy.toFixed(3)}, dz=${postBbox.dz.toFixed(3)}`);

    // Each axis must be > 0 (non-degenerate) and ≥ 10% of the max axis
    // (no severe pinching in any single direction).
    const maxAxis = Math.max(postBbox.dx, postBbox.dy, postBbox.dz);
    expect(postBbox.dx).toBeGreaterThan(maxAxis * 0.10);
    expect(postBbox.dy).toBeGreaterThan(maxAxis * 0.10);
    expect(postBbox.dz).toBeGreaterThan(maxAxis * 0.10);

    // ── Step 8: Multi-angle render via REAL drag-orbits — no blank frames ──────
    const cap = await captureAllAngles(win, 'subdivide-handle', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Step 9: Verify the storyboard stills exist and are non-trivial ────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-input-handle\.png$/.test(f));
    const outputStill = stills.find(f => /-after-subdivide\.png$/.test(f));
    expect(inputStill, 'an input-handle still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-subdivide still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-subdivide still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);

  } finally {
    await app.close();
    // finish() resolves + renames the recorded video — MUST run after close.
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
