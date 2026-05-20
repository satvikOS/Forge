/**
 * brep-simplify-electron.spec.js
 *
 * A4 gate — headed Electron e2e tests for geometry simplification.
 * Op under test: Simplify Geometry ribbon tool (Direct Edit tab).
 *
 * All three tests drive the op via the ribbon tool:
 *   Test 1 — ribbon click, assert face/edge reduction and volume preservation
 *   Test 2 — ribbon click, assert renders correctly from all camera angles
 *   Test 3 — same ribbon click (the original proven Test 3, kept for symmetry)
 *
 * Handler build (ToolExecutionEngine.js):
 *   Simplify Geometry: fuse(20³ box, translated 20³ box) → simplify
 *   Before: 10 faces / 20 edges, V ≈ 16000
 *   After:   6 faces / 12 edges, V preserved
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';

test.setTimeout(600000);

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

async function switchToDirectEditTab(win) {
  const tab = win.locator('button.ribbon-tab').filter({ hasText: /^Direct Edit$/ });
  await expect(tab).toBeVisible({ timeout: 30000 });
  await tab.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function clickSimplifyGeometry(win) {
  await win.evaluate(() => { window.__lastBrepShape = null; });
  const re = /^Simplify Geometry$/;
  const btn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
    has: win.locator('.ribbon-tool-label', { hasText: re }),
  }).first();
  await expect(btn).toBeVisible({ timeout: 30000 });
  await btn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await win.waitForFunction(() => !!window.__lastBrepShape, null, { timeout: 120000 });
}

// ─── Test 1 — simplify reduces faces and edges, preserves volume ──────────────

test('simplify: ribbon tool fuses two-box bar and loses its internal seam (10→6 faces, volume preserved)', async () => {
  // Handler: fuse(20³ box, translate(20³ box, 20,0,0)) → simplify.
  // Before: 10 faces / 20 edges; After: 6 faces / 12 edges. Volume ≈ 16000 mm³.
  const { app, win, pageErrors } = await launch();
  try {
    await switchToDirectEditTab(win);
    await clickSimplifyGeometry(win);

    const after = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(
      `  Simplify (result): vol=${after.volume.toFixed(0)},` +
      ` faces=${after.faceCount}, edges=${after.edgeCount}`
    );
    // Volume preserved ≈ 16000 mm³ (two 20³ boxes end-to-end = 40×20×20 bar)
    expect(after.volume).toBeGreaterThan(15800);
    expect(after.volume).toBeLessThan(16200);
    // Seam merged → 6 faces / 12 edges
    expect(after.faceCount).toBe(6);
    expect(after.edgeCount).toBe(12);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Test 2 — simplified geometry renders correctly from all angles ───────────

test('simplify: ribbon result renders correctly from all camera angles and zooms', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    await switchToDirectEditTab(win);
    await clickSimplifyGeometry(win);

    const cap = await captureAllAngles(win, 'simplify', {
      azimuths: [0, 60, 120, 180, 240, 300],
      elevations: [-30, 30],
      zooms: [0.6, 1.0, 1.8],
    });
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Test 3 — the Simplify Geometry ribbon tool works (end-to-end) ────────────

test('ribbon: Simplify Geometry tool (Direct Edit tab) runs end-to-end', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    await switchToDirectEditTab(win);
    await clickSimplifyGeometry(win);

    const metrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(
      `  Simplify Geometry: vol=${metrics.volume.toFixed(0)},` +
      ` faces=${metrics.faceCount}, edges=${metrics.edgeCount}`
    );
    expect(metrics.volume).toBeGreaterThan(0);
    expect(metrics.faceCount).toBeGreaterThanOrEqual(6);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
