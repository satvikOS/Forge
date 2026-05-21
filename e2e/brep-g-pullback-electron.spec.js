/**
 * brep-g-pullback-electron.spec.js
 *
 * Sub-project G Task 4 e2e gate — surface pull-back in retopology.
 *
 * Artifact: sphere (Primitive, default R=25 mm).
 * Workflow: Part tab → Sphere → select → Retopo Surface (targetEdgeLength=3,
 *           iterations=5, pullBackToSurface=1).
 *
 * Assertions:
 *   - Vertex count > 0
 *   - Average radius of retopo'd vertices within [24.0, 26.0] mm (±4%)
 *   - max–min radius spread < 2 mm (pull-back keeps vertices on-sphere)
 *   - window.__lastRetopoProjection.projections > 0 (pull-back was active)
 *   - captureAllAngles blanks empty, pageErrors empty
 *
 * Uses real ribbon clicks + dialog injection (injectToolParams) per
 * the established e2e pattern in existing specs. Under Playwright
 * navigator.webdriver=true the dialog bypass fires and picks up
 * window.__archdiscPlanParams['Retopo Surface'] injected by injectToolParams.
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

// ─── Main gate test ───────────────────────────────────────────────────────────

test('Retopo with surface pull-back: sphere retopo keeps vertices on surface', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    // ── Step 1: Build a sphere (default R=25 mm) ──────────────────────────────
    // Note: the default sphere radius in the schema is 25 mm; the assertions
    // below check against R=25 (expected range 24–26 mm).
    const sphereId = await buildPrimitive(win, 'Sphere');
    console.log(`  Sphere built: id=${sphereId}`);

    // ── Step 2: Clear introspection slots before retopo ───────────────────────
    await win.evaluate(() => {
      window.__lastRetopoMesh = null;
      window.__lastRetopoProjection = null;
    });

    // ── Step 3: Select sphere and run Retopo Surface with pull-back ───────────
    await selectBodies(win, [sphereId]);
    await injectToolParams(win, 'Retopo Surface', {
      targetEdgeLength:  3,
      iterations:        5,
      pullBackToSurface: 1,
    });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Retopo Surface');

    // Wait for retopo to complete — can take up to 3 min on sphere at L=3mm.
    await win.waitForFunction(() => !!window.__lastRetopoMesh, null, { timeout: 180000 });
    console.log('  Retopo complete');

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

    // ── Step 7: Multi-angle, multi-zoom visual capture ────────────────────────
    const cap = await captureAllAngles(win, 'retopo-pullback-sphere', {
      azimuths:   [0, 60, 120, 180, 240, 300],
      elevations: [-30, 30],
      zooms:      [0.6, 1.0, 1.8],
    });
    console.log(`  Captured ${cap.total} angles, blanks: ${cap.blanks.length}`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
