/**
 * subdivide-surface-electron.spec.js
 *
 * Sub-project C — e2e gate for piecewise-smooth Loop subdivision.
 *
 * Verifies:
 *   1. Triangle count growth after 2 Loop steps (>8× base).
 *   2. Vertex welding (weldedVerts < baseVerts — OCCT per-face duplicates merged).
 *   3. Crease detection (≥12 edges for a cube at 30° threshold).
 *   4. No pinching: cube bbox ≥ 19.5 mm in each axis after subdivision.
 *   5. Render from all angles + zooms: no blank frames, no page errors.
 *
 * Driven entirely by real ribbon clicks (no kernel calls in spec body).
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';

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

async function clickRibbonTab(win, label) {
  await win.locator('button.ribbon-tab')
    .filter({ hasText: new RegExp('^' + label + '$') })
    .first()
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function clickRibbonTool(win, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await win.locator('button.ribbon-tool:has(.ribbon-tool-label)')
    .filter({ has: win.locator('.ribbon-tool-label', { hasText: new RegExp('^' + escaped + '$') }) })
    .first()
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

// ─── Main gate test ──────────────────────────────────────────────────────────

test('Subdivide Surface: clicking ribbon subdivides cleanly — no pinching, all angles render', async () => {
  const { app, win, pageErrors } = await launch();

  // 1. Create a body via the Part-tab Box tool.
  await clickRibbonTab(win, 'Part');
  await win.waitForTimeout(120);
  await clickRibbonTool(win, 'Box');
  await win.waitForFunction(() => !!window.__lastBrepShape, null, { timeout: 60000 });

  // 2. Clear any stale subdivision result, then subdivide.
  //    'Subdivide Surface' has key:'surface' so it lives in the Surface GROUP
  //    within the Part tab (not a separate tab). Stay on the Part tab.
  await win.evaluate(() => { window.__lastSubdivMesh = null; });
  await clickRibbonTool(win, 'Subdivide Surface');
  await win.waitForFunction(() => !!window.__lastSubdivMesh, null, { timeout: 60000 });

  // 3. Quantitative assertions on subdivision statistics.
  const stats = await win.evaluate(() => window.__lastSubdivMesh.stats);

  // Triangle count must grow by at least 8× after 2 Loop steps
  // (each step is ×4; two steps = ×16 theoretical; ≥8× is a conservative floor).
  expect(stats.refinedTris).toBeGreaterThan(stats.baseTris * 8);

  // OCCT per-face duplication: welded vertex count must be less than base.
  expect(stats.weldedVerts).toBeLessThan(stats.baseVerts);

  // A cube has 12 sharp edges; all must be detected at 30° dihedral threshold
  // (cube face normals are perpendicular: cos 90° = 0 < cos 30° ≈ 0.866).
  expect(stats.creaseEdges).toBeGreaterThanOrEqual(12);

  // 4. Pinching check: bbox of the subdivided cube must span ≥ 19.5 mm in
  //    each axis.  With no creases the corners collapse 4+ mm inward (recon
  //    measured 4.42 mm); with the k≥3 corner rule they stay fixed.
  const bbox = await win.evaluate(() => {
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

  // 19.5 mm = 97.5% of 20 mm — aggressive gate that catches real pinching.
  expect(bbox.dx).toBeGreaterThan(19.5);
  expect(bbox.dy).toBeGreaterThan(19.5);
  expect(bbox.dz).toBeGreaterThan(19.5);

  // 5. Multi-angle render check — no blank frames, no page errors.
  const cap = await captureAllAngles(win, 'subdivide', {
    azimuths:   [0, 60, 120, 180, 240, 300],
    elevations: [-30, 30],
    zooms:      [0.6, 1.0, 1.8],
  });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);

  await app.close();
});
