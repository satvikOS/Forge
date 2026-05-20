/**
 * brep-blend-electron.spec.js
 *
 * A5 gate — Real-user-workflow tests for OCCT hard-blending operations.
 * Every geometry op is invoked by clicking the real ribbon tool button
 * (Part tab, Modify group) — NOT by calling kernel APIs directly.
 *
 * Face Fillet (arity 0):
 *   Builds its own 6mm wire boundary internally. No body selection needed.
 *
 * Full Round Fillet (arity 1):
 *   buildPrimitive Box 20×20×20 → select → click tool → injectToolParams r=8
 *   cliffEdgeBlend → V in (2000, 8000), faceCount > 6
 *
 * Corner Mitre (arity 1):
 *   buildPrimitive Box 20×20×20 → select → click tool → injectToolParams r=3
 *   mitreCorner → V in (7200, 7900), faceCount = 26
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, selectBodies, injectToolParams,
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

// ─── Face Fillet (G2 blend, arity 0) ────────────────────────────────────────

test('Face Fillet: ribbon click builds G2 C2 fill face, area in (28, 60) mm²', async () => {
  // Arity-0: handler builds its own 6mm wire boundary internally.
  // No body selection needed. Schema default: holeBoxSize=6.
  const { app, win, pageErrors } = await launch();
  try {
    // Capture current id so we can detect the new result.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
    // Inject params (schema default holeBoxSize=6 is fine; explicit for clarity).
    await injectToolParams(win, 'Face Fillet', { holeBoxSize: 6 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Face Fillet');
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Face Fillet: area=${m.area?.toFixed(1)}, faces=${m.faceCount}`);
    // Handler: blendG2(6) → planar 6×6 wire filled with C2 continuity.
    // area ≈ 36 mm² (±20% tolerance for curvature in the fill surface).
    expect(m.area).toBeGreaterThan(28);
    expect(m.area).toBeLessThan(60);
    expect(m.faceCount).toBeGreaterThanOrEqual(1);

    const cap = await captureAllAngles(win, 'a5-blendG2', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Full Round Fillet (cliff-edge blend, arity 1) ──────────────────────────

test('Full Round Fillet: build 20³ box → select → ribbon click → r=8 cliff blend → V in (2000, 8000), faceCount > 6', async () => {
  // Arity-1 workflow: build a 20×20×20 box, select it, click Full Round Fillet.
  // Large-radius blend (40% of face width) rounds all edges heavily.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build a 20³ box via ribbon + dialog.
    const boxId = await buildPrimitive(win, 'Box', { dx: 20, dy: 20, dz: 20 });

    // 2. Select the box.
    await selectBodies(win, [boxId]);

    // 3. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Inject params + click Full Round Fillet.
    //    Under Playwright (navigator.webdriver=true), ToolParamDialog auto-bypasses;
    //    planParams is the correct injection path.
    await injectToolParams(win, 'Full Round Fillet', { radius: 8 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Full Round Fillet');

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
    console.log(`  Full Round Fillet: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Large-radius blend on 20³ box — removes significant material from corners.
    expect(m.volume).toBeGreaterThan(2000);
    expect(m.volume).toBeLessThan(8000);
    expect(m.faceCount).toBeGreaterThan(6);

    const cap = await captureAllAngles(win, 'a5-cliff', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Corner Mitre (arity 1) ─────────────────────────────────────────────────

test('Corner Mitre: build 20³ box → select → ribbon click → r=3 mitre → V in (7200, 7900), faceCount = 26', async () => {
  // Arity-1 workflow: build a 20×20×20 box, select it, click Corner Mitre.
  // Empirically verified: volume ≈ 7572, faceCount = 26.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build a 20³ box via ribbon + dialog.
    const boxId = await buildPrimitive(win, 'Box', { dx: 20, dy: 20, dz: 20 });

    // 2. Select the box.
    await selectBodies(win, [boxId]);

    // 3. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Inject params + click Corner Mitre.
    //    Under Playwright (navigator.webdriver=true), ToolParamDialog auto-bypasses;
    //    planParams is the correct injection path.
    await injectToolParams(win, 'Corner Mitre', { radius: 3 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Corner Mitre');

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
    console.log(`  Corner Mitre: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Empirically measured: volume ≈ 7572, faceCount = 26.
    expect(m.volume).toBeGreaterThan(7200);
    expect(m.volume).toBeLessThan(7900);
    expect(m.faceCount).toBe(26);

    const cap = await captureAllAngles(win, 'a5-mitre', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
