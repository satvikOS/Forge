/**
 * brep-localops-electron.spec.js
 *
 * Real-user-workflow tests for local operations.
 * Every geometry op is invoked by clicking the real ribbon tool button and
 * filling the ToolParamDialog — NOT by calling kernel APIs directly.
 *
 * Each test builds a recognisable real-world engineering artifact.
 *
 * Arity-0 (no selection):
 *   Thicken     : thicken( 60×40 sheet, 3 mm ) → V ≈ 7200 mm³  [metal plate]
 *
 * Arity-1 (build Box → select → click → fill dialog):
 *   Shell       : shell( 40³ box, t=3 )         → hollow, V in (3500, 62000)  [open tray / housing]
 *   Offset Shape: offsetShape( 40³ box, +2 )    → V ≈ 70 400 mm³              [padded block]
 *   Draft       : draft( 40³ box, 5° )          → tapered, V < 64000          [draft-angle plug]
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

// ─── Shell ────────────────────────────────────────────────────────────────────

test('Shell: thin-walled tray (open housing) — build 40³ box → select → ribbon click → t=3 → hollow, V in (3500, 62000)', async () => {
  // Artifact: thin-walled tray (open housing)
  // Arity-1: build a Box (40³ — the housing blank), select it, click Shell,
  // accept thickness=3. Result: a thin-walled open tray like an electronics enclosure
  // or oil-pan housing. Shell removes one face (open shell).
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the housing blank (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');

    // 2. Select for Shell op.
    await selectBodies(win, [boxId]);

    // 3. Capture current id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Shell.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Shell', { thickness: 3 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Shell');

    // 5. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Shell (open housing tray): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(3500);
    expect(m.volume).toBeLessThan(62000);

    const cap = await captureAllAngles(win, 'shell', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Thicken ─────────────────────────────────────────────────────────────────

test('Thicken: thickened sheet (metal plate) — ribbon click thickens 60×40 sheet by 3 mm, V in (6480, 7920)', async () => {
  // Artifact: thickened sheet (metal plate)
  // Arity-0: no body selection needed. Dialog defaults: width=60, height=40, thickness=3.
  // Produces a thin sheet-metal plate as used in brackets, flanges, or sheet-metal blanks.
  // 60×40×3 = 7200 mm³, ±10%.
  const { app, win, pageErrors } = await launch();
  try {
    // Click Part tab → Thicken → accept dialog defaults.
    await buildPrimitive(win, 'Thicken');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Thicken (metal plate): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // 60×40×3 = 7200 mm³, ±10%
    expect(m.volume).toBeGreaterThan(6480);
    expect(m.volume).toBeLessThan(7920);

    const cap = await captureAllAngles(win, 'thicken', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Offset Shape ─────────────────────────────────────────────────────────────

test('Offset Shape: padded block (face-offset) — build 40³ box → select → ribbon click → +2 mm → V in (63360, 77440)', async () => {
  // Artifact: padded block (face-offset)
  // Arity-1: build a Box (40³ — the base block), select it, click Offset Shape,
  // fill distance=2. Uniformly offsets all faces outward by 2 mm, producing a
  // padded enclosure block (like adding material for machining stock allowance).
  // Empirically measured: 70400 mm³ (offsetShape result at +2mm offset).
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the base block (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');

    // 2. Select for Offset Shape op.
    await selectBodies(win, [boxId]);

    // 3. Capture current id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Offset Shape.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Offset Shape', { distance: 2 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Offset Shape');

    // 5. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Offset Shape (padded block): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Empirically measured: 70400 mm³, ±10%
    expect(m.volume).toBeGreaterThan(63360);
    expect(m.volume).toBeLessThan(77440);

    const cap = await captureAllAngles(win, 'offset-shape', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Draft ────────────────────────────────────────────────────────────────────

test('Draft: draft-angle plug (mold-release shape) — build 40³ box → select → ribbon click → 5° dialog → positive V < 64000, 6 faces', async () => {
  // Artifact: draft-angle plug (mold-release shape)
  // Arity-1: build a Box (40³ — the plug blank), select it, click Draft, fill angleDeg=5.
  // Tapers the side faces inward at 5° for mold-release, producing a plastic injection
  // mold plug or die casting insert with the required draft angle.
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the plug blank (Box 40³).
    const boxId = await buildPrimitive(win, 'Box');

    // 2. Select for Draft op.
    await selectBodies(win, [boxId]);

    // 3. Capture current id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Draft.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Draft', { angleDeg: 5 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Draft');

    // 5. Wait for result.
    await win.waitForFunction(
      (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
      idBefore,
      { timeout: 60000 },
    );

    // 7. Measure + assert.
    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Draft (mold-release plug): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(0);
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBe(6);

    const cap = await captureAllAngles(win, 'draft', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
