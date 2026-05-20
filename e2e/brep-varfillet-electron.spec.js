/**
 * brep-varfillet-electron.spec.js
 *
 * Real-user-workflow test for OCCT variable-radius fillet.
 * Geometry is invoked by clicking the real ribbon tool button
 * (Part tab, Modify group) and filling the ToolParamDialog —
 * NOT by calling kernel APIs directly.
 *
 * Arity-1 workflow:
 *   1. Build Box (40³) via ribbon + dialog.
 *   2. Select the Box body.
 *   3. Click Variable Radius Fillet → fill dialog (r1=1, r2=4).
 *   4. Measure: V in (50000, 63900), faceCount > 6.
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

// ─── Variable Radius Fillet ───────────────────────────────────────────────────

test('Variable Radius Fillet: build 40³ box → select → ribbon click → r1=1→r2=4 dialog → V in (50000, 63900), faceCount > 6', async () => {
  // Variable-radius fillet on all edges: removes material from corners.
  // V must be < 64000 (material removed) and > 50000 (partial removal only).
  const { app, win, pageErrors } = await launch();
  try {
    // 1. Build the input body via the Box primitive (user workflow).
    const boxId = await buildPrimitive(win, 'Box');

    // 2. Select the body for the Variable Radius Fillet op.
    await selectBodies(win, [boxId]);

    // 3. Capture current shape id.
    const idBefore = await win.evaluate(() =>
      window.__lastBrepShape && window.__lastBrepShape.id
    );

    // 4. Click Part tab → Variable Radius Fillet.
    //    Inject params before clicking — under Playwright (navigator.webdriver=true)
    //    ToolParamDialog auto-bypasses; planParams is the correct injection path.
    await injectToolParams(win, 'Variable Radius Fillet', { r1: 1, r2: 4 });
    await clickRibbonTab(win, 'Part');
    await win.waitForTimeout(120);
    await clickRibbonTool(win, 'Variable Radius Fillet');

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
    console.log(`  Variable Radius Fillet: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(50000);
    expect(m.volume).toBeLessThan(63900);
    expect(m.faceCount).toBeGreaterThan(6);

    const cap = await captureAllAngles(win, 'varfillet', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
