/**
 * brep-blend-electron.spec.js
 *
 * Real-user-workflow tests for hard-blending operations.
 * Every geometry op is invoked by clicking the real ribbon tool button and
 * filling the ToolParamDialog — NOT by calling kernel APIs directly.
 *
 * Each test builds a recognisable real-world engineering artifact.
 *
 * Test A — Face Fillet (G2 blend, arity 0):
 *   Artifact: smooth fairing patch (C2 fill face)
 *   Face Fillet is arity-0; builds its own 6mm wire boundary internally.
 *
 * Test B — Full Round Fillet (cliff blend, arity 1):
 *   Artifact: softened keycap (cliff blend)
 *   Box (40³) → Full Round Fillet r=8
 *
 * Test C — Corner Mitre (arity 1):
 *   Artifact: mitred die (cube with rounded corners)
 *   Box (40³) → Corner Mitre r=3
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

/**
 * Apply a ribbon op that takes arity ≥ 1 bodies (boolean or feature).
 * - Selects the given bodies.
 * - Injects params (if provided).
 * - Clicks the tab + tool.
 * - Waits for a new __lastBrepShape.id.
 * - Returns the new body-registry id.
 */
async function applyOp(win, tabLabel, toolLabel, bodyIds, params) {
  const before = await win.evaluate(() =>
    window.__lastBrepShape && window.__lastBrepShape.id
  );
  if (bodyIds && bodyIds.length > 0) {
    await selectBodies(win, bodyIds);
  }
  if (params && Object.keys(params).length > 0) {
    await injectToolParams(win, toolLabel, params);
  }
  await clickRibbonTab(win, tabLabel);
  await win.waitForTimeout(120);
  await clickRibbonTool(win, toolLabel);
  await win.waitForFunction(
    (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
    before,
    { timeout: 60000 },
  );
  return getLastRegistryId(win);
}

// ─── Test A — Face Fillet (G2 blend, arity 0) ────────────────────────────────

test('Face Fillet: smooth fairing patch (C2 fill face) — arity-0 → area in (20, 70) mm², faceCount ≥ 1', async () => {
  // Artifact: smooth fairing patch (C2 fill face)
  // Face Fillet is arity-0: it builds its own 6mm internal wire boundary and
  // fills it with a G2 (C2) continuity surface. Used in aerospace fairing,
  // automotive A-surface blending, and turbine blade root fillets where
  // tangent continuity across a patch boundary is required.
  // No input body construction is needed — the op creates its own geometry.
  const { app, win, pageErrors } = await launch();
  try {
    // Face Fillet (arity 0 — no body selection needed)
    // Builds a G2/C2 fill face on a 6mm internal wire regardless of scene content.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );
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
    console.log(`  Face Fillet (fairing patch): area=${m.area?.toFixed(1)}, faces=${m.faceCount}`);
    // G2 fill on 6mm box wire: area ≈ 36 mm² ±35% (curvature variation in C2 surface)
    expect(m.area).toBeGreaterThan(20);
    expect(m.area).toBeLessThan(70);
    expect(m.faceCount).toBeGreaterThanOrEqual(1);

    const cap = await captureAllAngles(win, 'blend-facefillet', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Test B — Full Round Fillet on Box ───────────────────────────────────────

test('Full Round Fillet: softened keycap (cliff blend) — Extrude Boss beam blank → ribbon click → r=8 → V < pre, faceCount > 6', async () => {
  // Artifact: softened keycap (cliff blend)
  // An Extrude Boss (80×50×25 mm — the beam/keycap blank) with a Full Round
  // Fillet (r=8) applied to all convex edges — producing the rounded, ergonomic
  // keycap shape used on mechanical keyboard keycaps, button caps, or soft-touch
  // covers moulded over a prismatic core.
  // Cliff threshold: 0.20 × minDim(25mm) = 5mm. r=8 > 5 → cliff blend accepted.
  // Cliff-edge blend rounds all convex edges → volume shrinks from corner removal.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the keycap blank (Extrude Boss, 80×50×25 mm — arity-0).
    const beamId = await buildPrimitive(win, 'Extrude Boss');

    // Baseline volume of the Extrude Boss.
    const mPre = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Extrude Boss (keycap blank): vol=${mPre.volume.toFixed(0)}, faces=${mPre.faceCount}`);
    expect(mPre.volume).toBeGreaterThan(0);

    // 2. Apply Full Round Fillet (r=8) to the keycap blank.
    await applyOp(win, 'Part', 'Full Round Fillet', [beamId], { radius: 8 });

    const mPost = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Full Round Fillet (softened keycap): vol=${mPost.volume.toFixed(0)}, faces=${mPost.faceCount}`);

    // Cliff-edge blend rounds all convex edges — volume shrinks from corner removal.
    expect(mPost.volume).toBeGreaterThan(0);
    expect(mPost.volume).toBeLessThan(mPre.volume);
    // Blending adds curved edge-fillet faces → faceCount > 6.
    expect(mPost.faceCount).toBeGreaterThan(6);

    const cap = await captureAllAngles(win, 'blend-fullround', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Test C — Corner Mitre on Box ────────────────────────────────────────────

test('Corner Mitre: mitred die (cube with rounded corners) — build 40³ Box → ribbon click → r=3 → V < pre, faceCount ≥ 20', async () => {
  // Artifact: mitred die (cube with rounded corners)
  // A 40×40×40 mm die blank (Box) with Corner Mitre (r=3) applied to all
  // corners and edges — producing the spherical-corner rounded cube used in
  // precision die blanks, block gauges, and corner-rounded packaging molds.
  // Corner Mitre uses BRepFilletAPI on all edges → spherical corner patches.
  // Expected: volume < box (corners removed), faceCount ≥ 20 (6 sides + edge/corner faces).
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the die blank (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');

    // Baseline volume.
    const mPre = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Box (die blank): vol=${mPre.volume.toFixed(0)}, faces=${mPre.faceCount}`);
    expect(mPre.volume).toBeGreaterThan(0);

    // 2. Apply Corner Mitre (r=3) to the die blank.
    await applyOp(win, 'Part', 'Corner Mitre', [boxId], { radius: 3 });

    const mPost = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Corner Mitre (mitred die): vol=${mPost.volume.toFixed(0)}, faces=${mPost.faceCount}`);

    // Mitre removes corner/edge material → volume < box.
    expect(mPost.volume).toBeGreaterThan(0);
    expect(mPost.volume).toBeLessThan(mPre.volume);
    // Spherical corner patches + edge cylinders: ≥ 20 faces.
    expect(mPost.faceCount).toBeGreaterThanOrEqual(20);

    const cap = await captureAllAngles(win, 'blend-cornermitre', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
