/**
 * brep-varfillet-electron.spec.js
 *
 * Real-user-workflow test for OCCT variable-radius fillet.
 * Geometry is invoked by clicking the real ribbon tool button
 * (Part tab, Modify group) — NOT by calling kernel APIs directly.
 *
 * Handler build (ToolExecutionEngine.js):
 *   Variable Radius Fillet: variableFillet(40³ box, r1=1, r2=4)
 *   → V reduced from 64000 mm³, faceCount > 6
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';

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

async function switchToPartTab(win) {
  const tab = win.locator('button.ribbon-tab').filter({ hasText: /^Part$/ });
  await expect(tab).toBeVisible({ timeout: 30000 });
  await tab.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

// ─── Variable Radius Fillet ───────────────────────────────────────────────────

test('Variable Radius Fillet: ribbon click applies r1=1→r2=4 on 40³ box, V in (50000, 63900), faceCount > 6', async () => {
  // Handler: no prior __lastBrepShape → variableFillet(makeBox(40,40,40), 1, 4).
  // Variable-radius fillet on all edges: removes material from corners.
  // V must be < 64000 (material removed) and > 50000 (partial removal only).
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await win.evaluate(() => { window.__lastBrepShape = null; });

    const re = /^Variable Radius Fillet$/;
    const btn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
      has: win.locator('.ribbon-tool-label', { hasText: re }),
    }).first();
    await expect(btn).toBeVisible({ timeout: 30000 });
    await win.evaluate(() => { window.__lastBrepShape = null; });
    await btn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await win.waitForFunction(() => !!window.__lastBrepShape, null, { timeout: 120000 });

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
