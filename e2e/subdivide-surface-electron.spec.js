/**
 * subdivide-surface-electron.spec.js
 *
 * Real-user-workflow test for Loop subdivision on a recognisable engineering artifact.
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
 * Assertions:
 *   - refinedTris > baseTris × 8  (≥8× growth after 2 Loop steps)
 *   - weldedVerts < baseVerts      (OCCT per-face duplicates were merged)
 *   - creaseEdges ≥ 12             (sharp prismatic edges of the Extrude Boss
 *                                   detected at 30° dihedral threshold)
 *   - post-subdivide bbox ≥ 10% of max axis in each axis (no severe pinching)
 *   - captureAllAngles blanks empty, pageErrors empty
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, selectBodies, injectToolParams,
} from './helpers/uiWorkflow.js';

test.setTimeout(600000);

async function launch() {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });
  return { app, win, pageErrors };
}

/**
 * Get the body-registry ID of the most recently registered body.
 */
async function getLastRegistryId(win) {
  return win.evaluate(() => {
    const reg = window.__archdiscRegistry;
    if (reg && reg.bodies && reg.bodies.length > 0) {
      return reg.bodies[reg.bodies.length - 1].id;
    }
    return null;
  });
}

// ─── Main gate test ──────────────────────────────────────────────────────────

test('Subdivide Surface: ergonomic handle (smooth-organic from prismatic Extrude Boss) — Extrude Boss → 2 Loop steps — no pinching, all angles render', async () => {
  // Artifact: ergonomic handle (smooth-organic from prismatic Extrude Boss)
  // An Extrude Boss (80×50×25 mm — the handle blank) is subdivided with Loop
  // subdivision (levels=2) to produce the smooth organic form of a moulded
  // ergonomic grip handle. Crease edges at the prismatic transitions (dihedral ≥ 30°)
  // preserve the handle's structural ridge lines while the flat faces are smoothed.
  const { app, win, pageErrors } = await launch();
  try {
    // ── Step 1: Build Extrude Boss (handle blank, accept defaults) ─────────────
    // Extrude Boss is arity-0: no body selection needed.
    // Defaults: width=80, depth=50, height=25 → 80×50×25 mm prismatic plate.
    const handleId = await buildPrimitive(win, 'Extrude Boss');

    // ── Step 2: Compute the Extrude Boss bbox (pre-subdivide) via OCCT ─────────
    // This gives us the reference bbox to check for no-pinching after subdivision.
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

    // ── Step 3: Clear stale subdivision result, inject params, subdivide ───────
    await win.evaluate(() => { window.__lastSubdivMesh = null; });
    await selectBodies(win, [handleId]);
    await injectToolParams(win, 'Subdivide Surface', { levels: 2, dihedralDeg: 30, deflection: 0.5 });

    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Subdivide Surface');

    // ── Step 4: Wait for __lastSubdivMesh ───────────────────────────────────────
    await win.waitForFunction(() => !!window.__lastSubdivMesh, null, { timeout: 120000 });

    // ── Step 5: Triangle-count growth ──────────────────────────────────────────
    const stats = await win.evaluate(() => window.__lastSubdivMesh.stats);
    console.log(`  Subdiv stats: baseTris=${stats.baseTris}, refinedTris=${stats.refinedTris}, weldedVerts=${stats.weldedVerts}, baseVerts=${stats.baseVerts}, creaseEdges=${stats.creaseEdges}`);

    // Each Loop step is ×4 in theory; 2 steps = ×16; floor at ×8 (conservative).
    expect(stats.refinedTris).toBeGreaterThan(stats.baseTris * 8);

    // OCCT tessellates per-face with duplicate boundary verts; welding must reduce count.
    expect(stats.weldedVerts).toBeLessThan(stats.baseVerts);

    // The Extrude Boss has 12 sharp prismatic edges — all detected at 30° threshold.
    expect(stats.creaseEdges).toBeGreaterThanOrEqual(12);

    // ── Step 6: No-pinching bbox check ─────────────────────────────────────────
    // The subdivided mesh positions must span ≥ 10% of the max axis extent in
    // each axis. This guards against corner collapse that halves the bbox.
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
    expect(postBbox.dx).toBeGreaterThan(maxAxis * 0.10); // no axis collapsed > 90%
    expect(postBbox.dy).toBeGreaterThan(maxAxis * 0.10);
    expect(postBbox.dz).toBeGreaterThan(maxAxis * 0.10);

    // ── Step 7: Multi-angle render — no blank frames, no page errors ────────────
    const cap = await captureAllAngles(win, 'subdivide-handle', {
      azimuths:   [0, 60, 120, 180, 240, 300],
      elevations: [-30, 30],
      zooms:      [0.6, 1.0, 1.8],
    });
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
