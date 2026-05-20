/**
 * brep-simplify-electron.spec.js
 *
 * Real-user-workflow tests for Simplify Geometry (Direct Edit tab).
 *
 * Each test builds a recognisable real-world engineering artifact before
 * applying Simplify Geometry as the climactic step. The focal op merges
 * coplanar/coaxial faces; volume must be preserved within 0.5% and
 * face count must not increase.
 *
 * Test A — welded plate seam:
 *   Artifact: welded plate (seam cleanup)
 *   Extrude Boss (plate, accept defaults) → Simplify Geometry
 *
 * Test B — bottle-cap profile:
 *   Artifact: bottle cap blank (cleanup)
 *   Cylinder (r=20, h=40 — cap blank) → select → Simplify Geometry
 *
 * Test C — block with through-hole simplify:
 *   Artifact: block with through-hole (simplification cleanup)
 *   Box (40³) + Cylinder (r=20, h=40) → Subtract → select result → Simplify Geometry
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
 * Apply a ribbon op that takes bodies.
 * Selects bodies, injects params, clicks the tab+tool, waits for new shape.
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

// ─── Test A — welded plate seam ──────────────────────────────────────────────

test('simplify: welded plate (seam cleanup) — Extrude Boss plate → Simplify Geometry → volume preserved ±0.5%, faceCount ≤ pre', async () => {
  // Artifact: welded plate (seam cleanup)
  // An extruded structural plate (Extrude Boss, accept defaults → 80×50×25 mm)
  // is passed through Simplify Geometry to merge coplanar face seams left over
  // from the NURBS-to-BRep conversion — the same cleanup step run after
  // welding flat sheet metal to remove redundant seam edges.
  const { app, win, pageErrors } = await launch();
  try {
    // Step 1: Build the plate via Extrude Boss (arity-0, accept defaults).
    const plateId = await buildPrimitive(win, 'Extrude Boss');

    // Step 2: Baseline measurements of the plate.
    const mPre = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Extrude Boss plate: vol=${mPre.volume.toFixed(0)}, faces=${mPre.faceCount}`);
    expect(mPre.volume).toBeGreaterThan(0);

    // Step 3: Simplify Geometry on the plate (seam cleanup).
    await applyOp(win, 'Direct Edit', 'Simplify Geometry', [plateId]);

    // Step 4: Post-simplify measurements.
    const mPost = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Simplified (welded plate): vol=${mPost.volume.toFixed(0)}, faces=${mPost.faceCount}`);

    // Volume preserved within 0.5%.
    expect(mPost.volume).toBeGreaterThan(mPre.volume * 0.995);
    expect(mPost.volume).toBeLessThan(mPre.volume * 1.005);
    // Simplify merges faces — face count must not increase.
    expect(mPost.faceCount).toBeLessThanOrEqual(mPre.faceCount);

    const cap = await captureAllAngles(win, 'simplify-weldedplate', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Test B — bottle-cap profile ─────────────────────────────────────────────

test('simplify: bottle cap blank (cleanup) — Cylinder(r=20,h=40) → select → Simplify Geometry → volume preserved ±0.5%', async () => {
  // Artifact: bottle cap blank (cleanup)
  // A solid cylinder (r=20 mm, h=40 mm — the cap blank) passed through
  // Simplify Geometry to merge the cylindrical body seam edges — the standard
  // post-import cleanup applied to turned bottle cap blanks from STEP files.
  const { app, win, pageErrors } = await launch();
  try {
    // Step 1: Build the cap blank (Cylinder r=20, h=40).
    const capId = await buildPrimitive(win, 'Cylinder');

    // Step 2: Baseline measurements.
    const mPre = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Cylinder (bottle cap blank): vol=${mPre.volume.toFixed(0)}, faces=${mPre.faceCount}`);
    expect(mPre.volume).toBeGreaterThan(0);

    // Step 3: Simplify Geometry on the cap blank.
    await applyOp(win, 'Direct Edit', 'Simplify Geometry', [capId]);

    const mPost = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Simplified (bottle cap blank): vol=${mPost.volume.toFixed(0)}, faces=${mPost.faceCount}`);

    // Volume preserved within 0.5%.
    expect(mPost.volume).toBeGreaterThan(mPre.volume * 0.995);
    expect(mPost.volume).toBeLessThan(mPre.volume * 1.005);
    // Simplify must not increase face count.
    expect(mPost.faceCount).toBeLessThanOrEqual(mPre.faceCount);

    const cap = await captureAllAngles(win, 'simplify-bottlecap', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Test C — block with through-hole simplify ───────────────────────────────

test('simplify: block with through-hole (simplification cleanup) — Box−Cylinder Subtract → select → Simplify → positive volume preserved', async () => {
  // Artifact: block with through-hole (simplification cleanup)
  // A 40×40×40 mm mounting block (Box) with a cylindrical through-hole
  // (Cylinder r=20, h=40 — Subtract) is passed through Simplify Geometry
  // to clean up the seam topology left by the boolean subtraction — the
  // same post-operation cleanup step run on machined blocks after EDM drilling.
  const { app, win, pageErrors } = await launch();
  try {
    // Step 1: Build the block (Box 40³) and the drill (Cylinder r=20, h=40).
    const boxId = await buildPrimitive(win, 'Box');
    const cylId = await buildPrimitive(win, 'Cylinder');

    // Step 2: Subtract → block with through-hole.
    const holeBlockId = await applyOp(win, 'Part', 'Subtract', [boxId, cylId]);

    // Baseline of the subtracted body.
    const mPre = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Block with hole: vol=${mPre.volume.toFixed(0)}, faces=${mPre.faceCount}`);
    expect(mPre.volume).toBeGreaterThan(0);

    // Step 3: Simplify the block-with-hole.
    await applyOp(win, 'Direct Edit', 'Simplify Geometry', [holeBlockId]);

    const mPost = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Simplified (block with hole): vol=${mPost.volume.toFixed(0)}, faces=${mPost.faceCount}`);

    // Volume preserved within 0.5%.
    expect(mPost.volume).toBeGreaterThan(0);
    expect(mPost.volume).toBeGreaterThan(mPre.volume * 0.995);
    expect(mPost.volume).toBeLessThan(mPre.volume * 1.005);
    expect(mPost.faceCount).toBeLessThanOrEqual(mPre.faceCount);

    const cap = await captureAllAngles(win, 'simplify-blockholesubtr', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
