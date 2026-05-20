/**
 * brep-simplify-electron.spec.js
 *
 * A4 gate — headed Electron e2e tests for geometry simplification.
 * Op under test: Simplify Geometry ribbon tool (Direct Edit tab).
 *
 * All three tests drive the op via the ribbon tool using real user workflow:
 *   1. buildPrimitive Box (40³) → select → clickRibbonTool 'Simplify Geometry'
 *   2. Same as Test 1, verifies renders correctly from all angles.
 *   3. Same pattern, end-to-end smoke test.
 *
 * Simplify Geometry merges coplanar/coaxial faces. On a clean 40³ box
 * the faces are already merged → the tool preserves the shape unchanged
 * (volume ≈ 64 000 mm³, faceCount = 6). This confirms the ribbon op
 * is correctly wired and produces a valid result.
 *
 * Handler: Simplify Geometry uses _pickBodies(1) — it reads the currently
 * selected or last-created body. buildPrimitive + selectBodies ensures
 * the correct body is presented.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, selectBodies,
} from './helpers/uiWorkflow.js';

test.setTimeout(600000);

const SWEEP_OPTS = {
  azimuths: [0, 60, 120, 180, 240, 300], elevations: [-30, 30], zooms: [0.6, 1.0, 1.8],
};

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

// ─── Test 1 — simplify preserves a clean box unchanged ────────────────────────

test('simplify: build 40³ box → select → Direct Edit tab → Simplify Geometry → volume preserved, faceCount = 6', async () => {
  // Simplify Geometry merges coplanar/coaxial faces. On a clean 40³ box the
  // faces are already merged → shape is returned unchanged: V ≈ 64000 mm³, 6 faces.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build a Box via ribbon + dialog.
    const boxId = await buildPrimitive(win, 'Box');

    // 2. Select it.
    await selectBodies(win, [boxId]);

    // 3. Capture current id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Switch to Direct Edit tab → Simplify Geometry.
    //    Simplify has no parameters (zero-field schema); bypass auto-resolves.
    await clickRibbonTab(win, 'Direct Edit');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Simplify Geometry');

    // 5. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    // 6. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(
      `  Simplify (result): vol=${m.volume.toFixed(0)},` +
      ` faces=${m.faceCount}, edges=${m.edgeCount}`
    );
    // Volume preserved ≈ 64000 mm³ (40³ box), ±1%.
    expect(m.volume).toBeGreaterThan(63000);
    expect(m.volume).toBeLessThan(65000);
    // Clean box has 6 faces / 12 edges — already simplified.
    expect(m.faceCount).toBe(6);
    expect(m.edgeCount).toBe(12);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Test 2 — simplified geometry renders correctly from all angles ────────────

test('simplify: ribbon result renders correctly from all camera angles and zooms', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    const boxId = await buildPrimitive(win, 'Box');
    await selectBodies(win, [boxId]);

    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    await clickRibbonTab(win, 'Direct Edit');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Simplify Geometry');

    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    const cap = await captureAllAngles(win, 'simplify', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Test 3 — the Simplify Geometry ribbon tool works (end-to-end) ────────────

test('ribbon: Simplify Geometry tool (Direct Edit tab) runs end-to-end via user workflow', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    const boxId = await buildPrimitive(win, 'Box');
    await selectBodies(win, [boxId]);

    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    await clickRibbonTab(win, 'Direct Edit');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Simplify Geometry');

    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    const metrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(
      `  Simplify Geometry: vol=${metrics.volume.toFixed(0)},` +
      ` faces=${metrics.faceCount}, edges=${metrics.edgeCount}`
    );
    expect(metrics.volume).toBeGreaterThan(0);
    expect(metrics.faceCount).toBeGreaterThanOrEqual(6);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
