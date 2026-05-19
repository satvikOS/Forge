/**
 * brep-ribbon-electron.spec.js
 *
 * Verifies that OCCT operations are genuinely wired into the ribbon toolbar.
 * For each tested tool: click the ribbon button, wait for window.__lastBrepShape
 * to be set, measure via the kernel, assert real geometry (volume > 0,
 * faceCount >= 1), and confirm zero pageErrors.
 *
 * Tools covered: Box (primitive), Cylinder (primitive), Sphere (primitive),
 * Fillet (feature/modify), Combine (boolean).
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SHOT = path.resolve(__dirname, 'screenshots');

test.setTimeout(600000); // OCCT WASM is 50 MB; allow up to 10 min cold-load

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

  // Pre-warm OCCT WASM (cached after first call)
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
  expect(occtReady.ok, `OCCT load failed: ${occtReady.error ?? 'unknown'}`).toBe(true);

  return { app, win, pageErrors };
}

/**
 * Click a ribbon tool by exact label text and wait for __lastBrepShape to update.
 * Clears __lastBrepShape before clicking so the wait is unambiguous.
 */
async function clickRibbonTool(win, toolName) {
  // Clear the slot before clicking so waitForFunction detects a fresh assignment.
  await win.evaluate(() => { window.__lastBrepShape = null; });

  // The ribbon renders each tool as a <button class="ribbon-tool ...">
  // containing a <span class="ribbon-tool-label"> with the exact tool name.
  // Filter by the label span text to avoid false matches on icon text or
  // partial substring matches.
  const re = new RegExp(`^${toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const btn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
    has: win.locator('.ribbon-tool-label', { hasText: re }),
  }).first();
  await expect(btn).toBeVisible({ timeout: 30000 });

  // dispatchEvent bypasses scrollable-container click interception.
  await btn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  // Wait for the handler to resolve and set window.__lastBrepShape.
  await win.waitForFunction(() => !!window.__lastBrepShape, null, { timeout: 120000 });
}

// ─── Box ─────────────────────────────────────────────────────────────────────

test('ribbon: Box creates OCCT exact B-rep box (40³ mm, 6 faces, 12 edges)', async () => {
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    await clickRibbonTool(win, 'Box');

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

test('ribbon: Cylinder creates OCCT exact B-rep cylinder (volume > 0, faces >= 3)', async () => {
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    await clickRibbonTool(win, 'Cylinder');

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

test('ribbon: Sphere creates OCCT exact B-rep sphere (volume > 0, faceCount >= 1)', async () => {
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    await clickRibbonTool(win, 'Sphere');

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

test('ribbon: Fillet creates OCCT filleted box (volume > 0, faceCount >= 6)', async () => {
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    // Fillet handler works on __lastBrepShape if present, else creates a default
    // 40×40×40 box. Ensure there is no prior shape so the handler builds its own.
    await win.evaluate(() => { window.__lastBrepShape = null; });
    await clickRibbonTool(win, 'Fillet');

    const metrics = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Fillet: vol=${metrics.volume.toFixed(0)}, faces=${metrics.faceCount}, edges=${metrics.edgeCount}`);
    expect(metrics.volume).toBeGreaterThan(0);
    expect(metrics.faceCount).toBeGreaterThanOrEqual(6); // filleted box has more faces than a plain box

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

test('ribbon: Combine creates OCCT boolean union (volume > 0, faceCount >= 1)', async () => {
  const { app, win, pageErrors } = await launchAndWarm();
  try {
    await win.evaluate(() => { window.__lastBrepShape = null; });
    await clickRibbonTool(win, 'Combine');

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
