/**
 * brep-blend-electron.spec.js
 *
 * A5 gate — Real-user-workflow tests for OCCT hard-blending operations.
 * Every geometry op is invoked by clicking the real ribbon tool button
 * (Part tab, Modify group) — NOT by calling kernel APIs directly.
 *
 * Handler builds (ToolExecutionEngine.js):
 *   Face Fillet (blendG2)     : builds a G2 C2 fill face (area ≈ 36 mm²)
 *   Full Round Fillet (cliff) : cliffEdgeBlend(20³ box, r=8) → rounded solid
 *   Corner Mitre              : mitreCorner(20³ box, r=3)   → 26-face mitred solid
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';

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

async function switchToPartTab(win) {
  const tab = win.locator('button.ribbon-tab').filter({ hasText: /^Part$/ });
  await expect(tab).toBeVisible({ timeout: 30000 });
  await tab.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function clickRibbonTool(win, toolName) {
  await win.evaluate(() => { window.__lastBrepShape = null; });
  const re = new RegExp(`^${toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const btn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
    has: win.locator('.ribbon-tool-label', { hasText: re }),
  }).first();
  await expect(btn).toBeVisible({ timeout: 30000 });
  await btn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await win.waitForFunction(() => !!window.__lastBrepShape, null, { timeout: 120000 });
}

// ─── Face Fillet (G2 blend) ──────────────────────────────────────────────────

test('Face Fillet: ribbon click builds G2 C2 fill face, area in (28, 60) mm²', async () => {
  // Handler: blendG2(6) → planar 6×6 wire filled with C2 continuity.
  // area ≈ 36 mm² (±20% tolerance for curvature in the fill surface).
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await win.evaluate(() => { window.__lastBrepShape = null; });
    await clickRibbonTool(win, 'Face Fillet');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Face Fillet: area=${m.area?.toFixed(1)}, faces=${m.faceCount}`);
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

// ─── Full Round Fillet (cliff-edge blend) ────────────────────────────────────

test('Full Round Fillet: ribbon click applies r=8 cliff blend on 20³ box, V in (2000, 8000), faceCount > 6', async () => {
  // Handler: no prior __lastBrepShape → cliffEdgeBlend(makeBox(20,20,20), 8).
  // Large-radius blend (40% of face width) rounds all edges heavily.
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await win.evaluate(() => { window.__lastBrepShape = null; });
    await clickRibbonTool(win, 'Full Round Fillet');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Full Round Fillet: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
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

// ─── Corner Mitre ────────────────────────────────────────────────────────────

test('Corner Mitre: ribbon click applies r=3 mitre on 20³ box, V in (7200, 7900), faceCount = 26', async () => {
  // Handler: no prior __lastBrepShape → mitreCorner(makeBox(20,20,20), 3).
  // Empirically verified in occt-api-A5.md: volume ≈ 7572, faceCount = 26.
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await win.evaluate(() => { window.__lastBrepShape = null; });
    await clickRibbonTool(win, 'Corner Mitre');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Corner Mitre: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
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
