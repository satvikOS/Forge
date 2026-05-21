/**
 * brep-g-ssi-electron.spec.js
 *
 * Real-world-artifact test for NURBS Surface-Surface Intersection (SSI):
 * a cylinder piercing a box. Drives everything via real ribbon clicks + dialogs.
 *
 * Artifact: Box (default 40×40×40) + Cylinder (default r=20, h=40).
 * Focal op: Part tab → Surface-Surface Intersection (samples=64, tolerance=1e-6, lineWidth=2).
 *
 * Assertions:
 *   - stats.nbLines >= 1     (at least one intersection curve produced)
 *   - stats.totalPoints > 8  (sampled points exist)
 *   - captureAllAngles blanks empty, pageErrors empty
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildPrimitive, selectBodies, clickRibbonTab, clickRibbonTool,
  injectToolParams,
} from './helpers/uiWorkflow.js';
import { captureAllAngles } from './helpers/orbitCapture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

test('NURBS SSI: piercing cylinder x box via ribbon produces real intersection curves', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    // ── Step 1: Build Box (40×40×40 default) ─────────────────────────────────
    const boxId = await buildPrimitive(win, 'Box');
    console.log(`  Box id: ${boxId}`);

    // ── Step 2: Build Cylinder (r=20 h=40 default) ───────────────────────────
    const cylId = await buildPrimitive(win, 'Cylinder');
    console.log(`  Cylinder id: ${cylId}`);

    // ── Step 3: Select both bodies ───────────────────────────────────────────
    await selectBodies(win, [boxId, cylId]);

    // ── Step 4: Clear __lastSSI before triggering the tool ───────────────────
    await win.evaluate(() => { window.__lastSSI = null; });

    // ── Step 5: Inject SSI params (Playwright webdriver bypass) ─────────────
    await injectToolParams(win, 'Surface-Surface Intersection', {
      samples: 64,
      tolerance: 1e-6,
      lineWidth: 2,
    });

    // ── Step 6: Click Surface-Surface Intersection on the Part tab ──────────
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Surface-Surface Intersection');

    // ── Step 7: Wait for __lastSSI to be populated ───────────────────────────
    await win.waitForFunction(() => !!window.__lastSSI, null, { timeout: 120000 });

    // ── Step 8: Verify intersection statistics ───────────────────────────────
    const stats = await win.evaluate(() => window.__lastSSI.stats);
    console.log(`  SSI stats: nbLines=${stats.nbLines}, totalPoints=${stats.totalPoints}, totalLength=${stats.totalLength.toFixed(3)}`);

    expect(stats.nbLines).toBeGreaterThanOrEqual(1);
    expect(stats.totalPoints).toBeGreaterThan(8);

    // ── Step 9: Verify curves array integrity ────────────────────────────────
    const curveCount = await win.evaluate(() => window.__lastSSI.curves.length);
    expect(curveCount).toEqual(stats.nbLines);

    // ── Step 10: Multi-angle render — no blank frames ────────────────────────
    const cap = await captureAllAngles(win, 'ssi-box-cyl', {
      azimuths:   [0, 60, 120, 180, 240, 300],
      elevations: [-30, 30],
      zooms:      [0.6, 1.0, 1.8],
    });
    console.log(`  Render: ${cap.total} frames, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
