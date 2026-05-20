/**
 * brep-simplify-electron.spec.js
 *
 * SOPH-T6 batch 1 — Complex-model e2e for Simplify Geometry (Direct Edit tab).
 *
 * Each test builds a richer composite via the ribbon tool-chain before
 * applying Simplify Geometry as the climactic step.  The focal op merges
 * coplanar/coaxial faces; volume must be preserved within 0.5% and
 * face count must not increase.
 *
 * Test A — Simplify on Box+Cylinder Combine composite
 * Test B — Simplify on Box+Cylinder Combine + Fillet composite
 * Test C — Simplify on Box minus Cylinder Subtract composite
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

// ─── Test A — Simplify on Combined composite ─────────────────────────────────

test('simplify: Box+Cyl→Combine composite → Simplify Geometry → volume preserved ±0.5%, faceCount ≤ pre', async () => {
  /**
   *   1. Box (40³) + Cylinder (r20, h40) → Combine → composite
   *   2. Measure composite (baseline: volume + faceCount)
   *   3. Select composite → Direct Edit tab → Simplify Geometry (no params)
   *   4. Assert: volume preserved within 0.5%; faceCount ≤ pre-simplify count
   */
  const { app, win, pageErrors } = await launch();
  try {
    // Step 1: Build composite via ribbon.
    const boxId  = await buildPrimitive(win, 'Box');
    const cylId  = await buildPrimitive(win, 'Cylinder');
    const combId = await applyOp(win, 'Part', 'Combine', [boxId, cylId]);

    // Step 2: Baseline measurements.
    const mPre = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Composite (Box+Cyl): vol=${mPre.volume.toFixed(0)}, faces=${mPre.faceCount}`);
    expect(mPre.volume).toBeGreaterThan(0);

    // Step 3: Simplify Geometry on the composite.
    // Simplify Geometry is arity-1 with no dialog params — zero-field schema.
    await applyOp(win, 'Direct Edit', 'Simplify Geometry', [combId]);

    // Step 4: Post-simplify measurements.
    const mPost = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Simplified (Box+Cyl): vol=${mPost.volume.toFixed(0)}, faces=${mPost.faceCount}`);

    // Volume preserved within 0.5%.
    expect(mPost.volume).toBeGreaterThan(mPre.volume * 0.995);
    expect(mPost.volume).toBeLessThan(mPre.volume * 1.005);
    // Simplify merges faces — face count must not increase.
    expect(mPost.faceCount).toBeLessThanOrEqual(mPre.faceCount);

    const cap = await captureAllAngles(win, 'simplify-combine-composite', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Test B — Simplify on Combine+Fillet composite ────────────────────────────

test('simplify: Box+Cyl→Combine→Fillet(r=2) composite → Simplify Geometry → volume preserved, faceCount ≤ pre', async () => {
  /**
   *   1. Box + Cylinder → Combine → composite A
   *   2. Select A → Fillet (r=2) → filleted composite B
   *   3. Measure B (baseline)
   *   4. Select B → Simplify Geometry → simplified result
   *   5. Assert: volume preserved ±0.5%; faceCount ≤ pre
   */
  const { app, win, pageErrors } = await launch();
  try {
    // Step 1: Box + Cylinder → Combine.
    const boxId  = await buildPrimitive(win, 'Box');
    const cylId  = await buildPrimitive(win, 'Cylinder');
    const combId = await applyOp(win, 'Part', 'Combine', [boxId, cylId]);

    // Step 2: Fillet the composite.
    const filletId = await applyOp(win, 'Part', 'Fillet', [combId], { radius: 2 });

    // Baseline of the filleted composite.
    const mPre = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Fillet+Combine composite: vol=${mPre.volume.toFixed(0)}, faces=${mPre.faceCount}`);
    expect(mPre.volume).toBeGreaterThan(0);

    // Step 3: Simplify the filleted composite.
    await applyOp(win, 'Direct Edit', 'Simplify Geometry', [filletId]);

    const mPost = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Simplified (Fillet+Combine): vol=${mPost.volume.toFixed(0)}, faces=${mPost.faceCount}`);

    expect(mPost.volume).toBeGreaterThan(mPre.volume * 0.995);
    expect(mPost.volume).toBeLessThan(mPre.volume * 1.005);
    expect(mPost.faceCount).toBeLessThanOrEqual(mPre.faceCount);

    const cap = await captureAllAngles(win, 'simplify-fillet-composite', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Test C — Simplify after Subtract ────────────────────────────────────────

test('simplify: Box(40³)−Cylinder(r20,h40) Subtract → Simplify Geometry → positive volume, no blanks', async () => {
  /**
   *   1. Box (40³) + Cylinder (r20, h40) → Subtract (Box minus Cylinder)
   *   2. Measure the subtracted composite as baseline.
   *   3. Select composite → Simplify Geometry → simplified result.
   *   4. Assert: positive volume; volume preserved ±0.5%; faceCount ≤ pre.
   */
  const { app, win, pageErrors } = await launch();
  try {
    // Step 1: Box − Cylinder.
    const boxId    = await buildPrimitive(win, 'Box');
    const cylId    = await buildPrimitive(win, 'Cylinder');
    const subId    = await applyOp(win, 'Part', 'Subtract', [boxId, cylId]);

    // Baseline.
    const mPre = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Subtract (Box−Cyl): vol=${mPre.volume.toFixed(0)}, faces=${mPre.faceCount}`);
    expect(mPre.volume).toBeGreaterThan(0);

    // Step 2: Simplify the subtracted body.
    await applyOp(win, 'Direct Edit', 'Simplify Geometry', [subId]);

    const mPost = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Simplified (Box−Cyl): vol=${mPost.volume.toFixed(0)}, faces=${mPost.faceCount}`);

    expect(mPost.volume).toBeGreaterThan(0);
    expect(mPost.volume).toBeGreaterThan(mPre.volume * 0.995);
    expect(mPost.volume).toBeLessThan(mPre.volume * 1.005);
    expect(mPost.faceCount).toBeLessThanOrEqual(mPre.faceCount);

    const cap = await captureAllAngles(win, 'simplify-subtract-composite', SWEEP_OPTS);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
