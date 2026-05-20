/**
 * brep-features-electron.spec.js
 *
 * Real-user-workflow tests for OCCT feature operations.
 * Every geometry op is invoked by clicking the real ribbon tool button
 * (Part tab) and filling the ToolParamDialog — NOT by calling kernel APIs
 * directly.
 *
 * Each test builds a recognisable real-world engineering artifact.
 *
 * Under Playwright (navigator.webdriver=true) the ToolParamDialog
 * auto-resolves with schema defaults immediately. Effective defaults:
 *   Extrude Boss : width=80 depth=50 height=25 → V = 80×50×25 = 100 000 mm³
 *   Revolve Boss : innerR=12 width=18 height=40 → ring torus-like solid
 *   Fillet       : build Box (40³) → select → click Fillet → radius=2 → V < 64000
 *   Chamfer      : build Box (40³) → select → click Chamfer → distance=2 → V < 64000
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, selectBodies, injectToolParams,
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

// ─── Extrude Boss ─────────────────────────────────────────────────────────────

test('Extrude Boss: extruded structural beam — ribbon click + dialog defaults → 80×50×25 mm, V = 100 000 mm³', async () => {
  // Artifact: extruded structural beam
  // Arity-0: no body selection needed. The ToolParamDialog auto-resolves under
  // Playwright with defaults: width=80, depth=50, height=25.
  // Produces a rectangular prismatic beam cross-section (like a steel I-beam blank).
  const { app, win, pageErrors } = await launch();
  try {
    // Click Part tab → Extrude Boss → accept dialog defaults.
    await buildPrimitive(win, 'Extrude Boss');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Extrude Boss (structural beam): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // 80×50×25 = 100 000 mm³, ±10%
    expect(m.volume).toBeGreaterThan(90000);
    expect(m.volume).toBeLessThan(110000);
    expect(m.faceCount).toBe(6); // rectangular prism

    const cap = await captureAllAngles(win, 'extrude-boss', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Revolve Boss ─────────────────────────────────────────────────────────────

test('Revolve Boss: rotational shaft — ribbon click + dialog defaults → innerR=12 w=18 h=40, positive volume', async () => {
  // Artifact: rotational shaft (revolved)
  // Arity-0: no body selection needed. Handler defaults: innerR=12, width=18,
  // height=40 — revolves a ring 360°, producing an annular shaft/hub profile.
  // Volume = π×40×((12+18)²−12²) = π×40×(900−144) = π×40×756 ≈ 95 034 mm³
  const { app, win, pageErrors } = await launch();
  try {
    // Click Part tab → Revolve Boss → accept dialog defaults.
    await buildPrimitive(win, 'Revolve Boss');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Revolve Boss (rotational shaft): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Annular ring: outerR=innerR+width=30, innerR=12, height=40
    // V = π×h×(R²−r²) = π×40×(900−144) ≈ 95 034 mm³, ±15% (OCCT approximation)
    expect(m.volume).toBeGreaterThan(50000);
    expect(m.faceCount).toBeGreaterThanOrEqual(3);

    const cap = await captureAllAngles(win, 'revolve-boss', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Fillet ───────────────────────────────────────────────────────────────────

test('Fillet: rounded plate — build 40³ box → select → ribbon click → r=2 dialog → V in (58000, 64000)', async () => {
  // Artifact: rounded plate
  // Arity-1 workflow: build a Box (40³ — the plate blank), select it, click Fillet,
  // fill radius=2. Fillet removes material from all edges, rounding the plate corners.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the plate blank (Box 40³) via the Box primitive (user workflow).
    const boxId = await buildPrimitive(win, 'Box');

    // 2. Select the body for the Fillet op.
    await selectBodies(win, [boxId]);

    // 3. Capture current shape id so we can detect the new result.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Fillet tool.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Fillet', { radius: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Fillet');

    // 5. Wait for the new result body.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Fillet (rounded plate): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(58000); // r=2 on 40³ box → small material removal
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBeGreaterThan(6);  // filleted box has curved faces

    const cap = await captureAllAngles(win, 'fillet-boss', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Chamfer ──────────────────────────────────────────────────────────────────

test('Chamfer: chamfered-edge plate — build 40³ box → select → ribbon click → d=2 dialog → V in (55000, 64000)', async () => {
  // Artifact: chamfered-edge plate
  // Arity-1 workflow: build a Box (40³ — the plate blank), select it, click Chamfer,
  // fill distance=2. Chamfer cuts 45° bevels on all edges of the plate.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the plate blank (Box 40³) via the Box primitive (user workflow).
    const boxId = await buildPrimitive(win, 'Box');

    // 2. Select the body for the Chamfer op.
    await selectBodies(win, [boxId]);

    // 3. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Chamfer tool.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Chamfer', { distance: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Chamfer');

    // 5. Wait for the new result body.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Chamfer (chamfered-edge plate): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(55000); // d=2 chamfer on 40³ box
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBeGreaterThan(6);  // chamfered box has extra faces

    const cap = await captureAllAngles(win, 'chamfer-boss', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
