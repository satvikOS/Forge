/**
 * brep-g-trim-electron.spec.js
 *
 * Sub-project G Task 5 e2e gate — auto-trimming NURBS B-rep face.
 *
 * Real-world artifact: a "windowed sail panel" — a curved bicubic NURBS sail
 * with a rectangular window opening (the trim). Composed with a reference Box
 * so the scene reads as a panel in-context.
 *
 * Workflow:
 *   1. Part tab → Box (context body, default 40×40×40 mm).
 *   2. Part tab → Trimmed NURBS Patch (sizeX=120, sizeY=90, bulge=18,
 *      trimMin=0.3, trimMax=0.7) — the climactic auto-trim op.
 *
 * Assertions:
 *   - trimStats.trimmedAreaMm2 > 0  (a non-degenerate trimmed face was produced)
 *   - trimStats.trimRatio in an honest range around the curved-patch measurement
 *     (trim window 0.3..0.7 in both U and V = 0.16 parametric fraction;
 *      area ratio on a bulged patch differs from parametric fraction — measured
 *      bounds are set at [0.10, 0.25] to bracket the real curved-patch result)
 *   - Multi-angle render: all frames non-blank
 *   - No page errors
 *
 * Pattern: injectToolParams + clickRibbonTool (Playwright navigator.webdriver
 * bypass fires; the dialog never appears on screen).
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, injectToolParams,
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

test('Auto-trimming NURBS: windowed sail panel via ribbon trims the parametric domain', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    // ── Step 1: Build a Box as the context body ──────────────────────────────
    // The scene reads as a panel in-context (complex-models directive).
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Context Box built: id=${boxId}`);

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
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Trimmed NURBS Patch');

    // ── Step 5: Wait for trimStats to be populated ───────────────────────────
    await win.waitForFunction(() => !!window.__lastTrimmedPatch, null, { timeout: 120000 });
    console.log('  Trimmed NURBS Patch complete');

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

    // ── Step 7: Multi-angle, multi-zoom visual capture ────────────────────────
    const cap = await captureAllAngles(win, 'trim-windowed-sail', {
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
