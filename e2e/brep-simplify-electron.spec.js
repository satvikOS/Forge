/**
 * brep-simplify-electron.spec.js
 *
 * A4 gate — headed Electron e2e tests for geometry simplification.
 * Op under test: kernel.brep.simplify (ShapeUpgrade_UnifySameDomain).
 * Verified OCCT sequence: docs/superpowers/notes/occt-api-A4.md items 1-2.
 *
 * Empirically verified before/after counts (from A4 recon):
 *   Fused two-box 40×20×20 bar:  10 faces / 20 unique edges, volume ≈ 16000
 *   After simplify:                6 faces / 12 unique edges, volume preserved
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';

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

test.setTimeout(600000);

// ─── Test 1 — simplify reduces faces, preserves volume ───────────────────────

test('simplify: a fused two-box bar loses its internal seam (10 → 6 faces, volume preserved)', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const b = await K.translate(await K.makeBox(20, 20, 20), 20, 0, 0);
    const fused = await K.fuse(a, b);
    const before = await K.measure(fused);
    const simplified = await K.simplify(fused);
    const after = await K.measure(simplified);
    return { before, after };
  });
  // Volume preserved within 0.1% (≈16000 mm³)
  expect(Math.abs(r.after.volume - r.before.volume)).toBeLessThan(16);
  expect(r.after.volume).toBeGreaterThan(15800);
  // Seam is removed: before > after
  expect(r.before.faceCount).toBeGreaterThan(r.after.faceCount);
  // Verified exact counts from A4 recon: 10 → 6 faces, 20 → 12 edges
  expect(r.before.faceCount).toBe(10);
  expect(r.before.edgeCount).toBe(20);
  expect(r.after.faceCount).toBe(6);
  expect(r.after.edgeCount).toBe(12);
  expect(pageErrors).toEqual([]);
  await app.close();
});

// ─── Test 2 — simplified geometry renders correctly from all angles ───────────

test('simplify: result renders correctly from all camera angles and zooms', async () => {
  const { app, win, pageErrors } = await launch();
  await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const b = await K.translate(await K.makeBox(20, 20, 20), 20, 0, 0);
    const simplified = await K.simplify(await K.fuse(a, b));
    await window.__archdiscKernel.renderShape(simplified);
  });
  const cap = await captureAllAngles(win, 'simplify', {
    azimuths: [0, 60, 120, 180, 240, 300],
    elevations: [-30, 30],
    zooms: [0.6, 1.0, 1.8],
  });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});

// ─── Test 3 — the Simplify Geometry ribbon tool works ────────────────────────

test('ribbon: Simplify Geometry tool (Direct Edit tab) runs end-to-end', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    // Step 1: switch to the Direct Edit tab.
    // The ribbon renders each tab as <button class="ribbon-tab ..."> with the tab label.
    const directEditTab = win.locator('button.ribbon-tab').filter({ hasText: /^Direct Edit$/ });
    await expect(directEditTab).toBeVisible({ timeout: 30000 });
    await directEditTab.evaluate(el =>
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );

    // Step 2: clear __lastBrepShape so the wait below is unambiguous.
    await win.evaluate(() => { window.__lastBrepShape = null; });

    // Step 3: click the Simplify Geometry tool button.
    // The ribbon renders each tool as <button class="ribbon-tool ...">
    // containing a <span class="ribbon-tool-label"> with the exact tool name.
    const re = /^Simplify Geometry$/;
    const btn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
      has: win.locator('.ribbon-tool-label', { hasText: re }),
    }).first();
    await expect(btn).toBeVisible({ timeout: 30000 });
    await btn.evaluate(el =>
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );

    // Step 4: wait for the handler to set window.__lastBrepShape.
    await win.waitForFunction(() => !!window.__lastBrepShape, null, { timeout: 120000 });

    // Step 5: measure the resulting shape — must be a real solid.
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
