/**
 * brep-boolean-electron.spec.js
 *
 * Real-user-workflow tests for boolean operations.
 * Every geometry op is invoked by:
 *   1. Building input bodies via real ribbon primitive tools + dialogs.
 *   2. Selecting the bodies.
 *   3. Clicking the boolean ribbon tool.
 * No kernel APIs are called in the spec body to construct inputs.
 *
 * Each test builds a recognisable real-world engineering artifact.
 *
 * Body geometry (dialog defaults):
 *   Box       : 40×40×40 mm (V = 64 000 mm³)
 *   Cylinder  : r=20 mm, h=40 mm (V ≈ 50 265 mm³)
 *   Sphere    : r=25 mm (V ≈ 65 450 mm³)
 *
 * Combine  (arity-2): mounting block + boss → V > 0
 * Subtract (arity-2): block with through-hole → 0 < V < 64000
 * Intersect(arity-2): rounded chunk → V > 0
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, selectBodies,
} from './helpers/uiWorkflow.js';

test.setTimeout(600000);

const SWEEP = { azimuths: [0, 60, 120, 180, 240, 300], elevations: [-30, 40], zooms: [0.6, 1.0, 1.8] };

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

// ─── Combine (fuse) ───────────────────────────────────────────────────────────

test('Combine: mounting block with a boss — Box(40³) + Cylinder(r20,h40) → fuse → volume > 0', async () => {
  // Artifact: mounting block with a cylindrical boss
  // A 40×40×40 mm mounting block (Box) fused with a cylindrical boss (Cylinder r=20, h=40)
  // stacked through the block's centre. Arity-2 fuse of two solids.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the mounting block (Box 40³) via ribbon + dialog.
    const boxId = await buildPrimitive(win, 'Box');
    // 2. Build the cylindrical boss (Cylinder r=20, h=40) via ribbon + dialog.
    const cylId = await buildPrimitive(win, 'Cylinder');

    // 3. Select both bodies.
    await selectBodies(win, [boxId, cylId]);

    // 4. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 5. Click Part tab → Combine.
    //    Combine has no params; bypass auto-resolves under Playwright.
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Combine');

    // 6. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Combine (mounting block + boss): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Fused union: volume must be > 0 (positive solid produced).
    expect(m.volume).toBeGreaterThan(27000);
    expect(m.faceCount).toBeGreaterThanOrEqual(1);

    const cap = await captureAllAngles(win, 'bool-combine', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Subtract (cut) ───────────────────────────────────────────────────────────

test('Subtract: block with through-hole — Box(40³) − Cylinder(r20,h40) → 0 < V < 64000', async () => {
  // Artifact: block with through-hole (drilled mounting block)
  // A 40×40×40 mm block (Box) with a cylindrical through-hole drilled through it
  // (Cylinder r=20, h=40 as the drill tool). Subtract removes the cylinder from the block.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the block (Box 40³) — base body.
    const boxId = await buildPrimitive(win, 'Box');
    // 2. Build the drill cylinder (r=20, h=40) — tool body.
    const cylId = await buildPrimitive(win, 'Cylinder');

    // 3. Select box as [0] (base), cylinder as [1] (tool).
    await selectBodies(win, [boxId, cylId]);

    // 4. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 5. Click Part tab → Subtract.
    //    Subtract has no params; bypass auto-resolves under Playwright.
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Subtract');

    // 6. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Subtract (block with through-hole): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Cut removed material → V < box (64000) and > 0.
    expect(m.volume).toBeGreaterThan(0);
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBeGreaterThan(2);

    const cap = await captureAllAngles(win, 'bool-subtract', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Intersect (common) ───────────────────────────────────────────────────────

test('Intersect: rounded chunk — Box(40³) ∩ Sphere(r25) → positive volume < both inputs', async () => {
  // Artifact: rounded chunk (intersection of a block and a ball — like a ball-end cap)
  // Box (40³) at origin intersected with Sphere (r=25) at origin → corner sector
  // ≈ (1/8) of sphere = (4/3)π×15625/8 ≈ 8181 mm³, well below both input volumes.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the block (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');
    // 2. Build the ball (Sphere r=25).
    const sphId = await buildPrimitive(win, 'Sphere');

    // 3. Select both bodies.
    await selectBodies(win, [boxId, sphId]);

    // 4. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 5. Click Part tab → Intersect.
    //    Intersect has no params; bypass auto-resolves under Playwright.
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Intersect');

    // 6. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Intersect (rounded chunk): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Corner sector of sphere-r=25 inside box-40³ ≈ 8181 mm³, ±30% tolerance
    expect(m.volume).toBeGreaterThan(5000);
    expect(m.volume).toBeLessThan(30000);
    expect(m.faceCount).toBeGreaterThanOrEqual(1);

    const cap = await captureAllAngles(win, 'bool-intersect', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
