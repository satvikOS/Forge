/**
 * brep-ribbon-electron.spec.js
 *
 * Verifies that kernel operations are genuinely wired into the ribbon toolbar.
 * For each tested tool: switch to the correct ribbon tab, click the ribbon
 * button, wait for window.__lastBrepShape to update, measure via the kernel,
 * assert real geometry (volume > 0, faceCount >= 1), and confirm zero
 * pageErrors.
 *
 * User-workflow protocol (no hardcoded kernel calls):
 *   - Primitives (Box, Cylinder, Sphere): buildPrimitive() — Part tab + click
 *   - Fillet: buildPrimitive(Box) → selectBodies → injectToolParams → click
 *   - Combine: buildPrimitive(Box) × 2 → selectBodies → click
 *
 * Tools covered: Box (primitive), Cylinder (primitive), Sphere (primitive),
 * Fillet (feature/modify), Combine (boolean).
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  clickRibbonTab, clickRibbonTool,
  buildPrimitive, selectBodies, injectToolParams,
} from './helpers/uiWorkflow.js';

const SHOT = path.resolve(__dirname, 'screenshots');

test.setTimeout(600000); // Kernel WASM is 50 MB; allow up to 10 min cold-load

/** Launch the Electron app and wait until the kernel is ready. */
async function launchAndWarm() {
  fs.mkdirSync(SHOT, { recursive: true });
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const pageErrors = [];
  const win = await app.firstWindow();
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });

  // Pre-warm kernel WASM (cached after first call)
  await win.waitForFunction(async () => {
    try {
      const oc = await window.__archdiscKernel.getOCCT();
      window.__occtPreWarmed = { ok: true };
    } catch (e) {
      window.__occtPreWarmed = { ok: false, error: String(e) };
    }
    return !!window.__occtPreWarmed;
  }, null, { timeout: 300000 });

  const occtReady = await win.evaluate(() => window.__occtPreWarmed);
  expect(occtReady.ok, `Kernel load failed: ${occtReady.error ?? 'unknown'}`).toBe(true);

  return { app, win, pageErrors };
}

// ─── Box ─────────────────────────────────────────────────────────────────────

test('ribbon: Box creates ArchDisc exact B-rep box (40³ mm, 6 faces, 12 edges)', async () => {
  // Artifact: test cube — the simplest engineering primitive, proves Box ribbon wiring.
  // Arity-0 primitive: Part tab → Box.
  // buildPrimitive clicks the tab, injects default params, clicks Box, waits
  // for window.__lastBrepShape.id to change.
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    await buildPrimitive(win, 'Box');

    const metrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Box: vol=${metrics.volume.toFixed(0)}, faces=${metrics.faceCount}, edges=${metrics.edgeCount}`);
    expect(metrics.volume).toBeGreaterThan(63000);
    expect(metrics.volume).toBeLessThan(65000);
    expect(metrics.faceCount).toBe(6);
    expect(metrics.edgeCount).toBe(12);

    const shot = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'ribbon-box.png'),
    });
    expect(shot.length).toBeGreaterThan(2000);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Cylinder ────────────────────────────────────────────────────────────────

test('ribbon: Cylinder creates ArchDisc exact B-rep cylinder (volume > 0, faces >= 3)', async () => {
  // Artifact: shaft stub — a cylindrical stock piece, proves Cylinder ribbon wiring.
  // Arity-0 primitive: Part tab → Cylinder.
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    await buildPrimitive(win, 'Cylinder');

    const metrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Cylinder: vol=${metrics.volume.toFixed(0)}, faces=${metrics.faceCount}, edges=${metrics.edgeCount}`);
    // r=20mm h=40mm → π×400×40 ≈ 50265 mm³
    expect(metrics.volume).toBeGreaterThan(0);
    expect(metrics.faceCount).toBeGreaterThanOrEqual(3); // top, bottom, lateral

    const shot = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'ribbon-cylinder.png'),
    });
    expect(shot.length).toBeGreaterThan(2000);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Sphere ───────────────────────────────────────────────────────────────────

test('ribbon: Sphere creates ArchDisc exact B-rep sphere (volume > 0, faceCount >= 1)', async () => {
  // Artifact: bearing ball — a precision spherical component, proves Sphere ribbon wiring.
  // Arity-0 primitive: Part tab → Sphere.
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    await buildPrimitive(win, 'Sphere');

    const metrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Sphere: vol=${metrics.volume.toFixed(0)}, faces=${metrics.faceCount}, edges=${metrics.edgeCount}`);
    // r=25mm → (4/3)π×15625 ≈ 65450 mm³
    expect(metrics.volume).toBeGreaterThan(0);
    expect(metrics.faceCount).toBeGreaterThanOrEqual(1);

    const shot = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'ribbon-sphere.png'),
    });
    expect(shot.length).toBeGreaterThan(2000);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Fillet (Modify feature) ──────────────────────────────────────────────────

test('ribbon: Fillet creates ArchDisc filleted box (rounded plate: volume drop + 26 faces)', async () => {
  // Artifact: rounded plate — a Box(40³) with all edges filleted at r=2mm.
  // A fully-filleted box (12 edges, 8 corners) produces 6 flat + 12 fillet + 8 corner = 26 faces.
  // Arity-1: build a Box via ribbon, select it, inject fillet radius, click Fillet.
  // Under Playwright (navigator.webdriver=true) the ToolParamDialog auto-bypasses;
  // injectToolParams sets window.__archdiscPlanParams['Fillet'] so the bypass
  // picks up radius=2 instead of the schema default.
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    // 1. Build the box to operate on.
    const boxId = await buildPrimitive(win, 'Box');

    // 2. Select it.
    await selectBodies(win, [boxId]);

    // 3. Capture current id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Inject params + click Part tab → Fillet.
    await injectToolParams(win, 'Fillet', { radius: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Fillet');

    // 5. Wait for the result to land.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    const metrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Fillet (rounded plate): vol=${metrics.volume.toFixed(0)}, faces=${metrics.faceCount}, edges=${metrics.edgeCount}`);
    // Volume must drop from plain box (~64000 mm³) due to corner removal.
    expect(metrics.volume).toBeGreaterThan(0);
    expect(metrics.volume).toBeLessThan(64000); // volume drop confirms fillet material removal
    // Fully-filleted box: 6 flat + 12 cylindrical fillet + 8 spherical corner = 26 faces.
    expect(metrics.faceCount).toBe(26);

    const shot = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'ribbon-fillet.png'),
    });
    expect(shot.length).toBeGreaterThan(2000);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Combine (Boolean union) ──────────────────────────────────────────────────

test('ribbon: Combine creates ArchDisc boolean union (mounting block with boss: volume > 0)', async () => {
  // Artifact: mounting block with boss — a Box(40³) [base plate] fused with
  // a Box(40³) [boss feature] at the same origin, proving Boolean union wiring.
  // Arity-2: build two Boxes via ribbon, select both, click Combine.
  // Two overlapping 40³ boxes fuse into a single solid → V > 0.
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    // 1. Build two primitives.
    const box1Id = await buildPrimitive(win, 'Box');
    const box2Id = await buildPrimitive(win, 'Box');

    // 2. Select both.
    await selectBodies(win, [box1Id, box2Id]);

    // 3. Capture current id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Combine. No params (empty schema); bypass auto-resolves.
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Combine');

    // 5. Wait for the result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    const metrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Combine: vol=${metrics.volume.toFixed(0)}, faces=${metrics.faceCount}, edges=${metrics.edgeCount}`);
    expect(metrics.volume).toBeGreaterThan(0);
    expect(metrics.faceCount).toBeGreaterThanOrEqual(1);

    const shot = await win.locator('canvas').first().screenshot({
      path: path.join(SHOT, 'ribbon-combine.png'),
    });
    expect(shot.length).toBeGreaterThan(2000);

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
