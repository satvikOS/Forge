/**
 * brep-b-advanced-electron.spec.js
 *
 * Sub-project B — headed Electron e2e gate for advanced boolean ops and
 * local face replacement.  Every op is driven by a REAL ribbon-tool click;
 * geometry is never built from within the spec.
 *
 * Tests:
 *   1. Combine (Non-Manifold) — Part tab Boolean group
 *   2. Combine (Coincident)   — Part tab Boolean group
 *   3. Lattice Fuse           — Part tab Boolean group
 *   4. Replace Face           — Direct Edit tab Direct Modeling group
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

async function clickRibbonTab(win, label) {
  await win.locator('button.ribbon-tab')
    .filter({ hasText: new RegExp('^' + label + '$') })
    .first()
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function clickRibbonTool(win, label) {
  // Escape RegExp special chars in the label (names contain "(", ")").
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await win.locator('button.ribbon-tool:has(.ribbon-tool-label)')
    .filter({ has: win.locator('.ribbon-tool-label', { hasText: new RegExp('^' + escaped + '$') }) })
    .first()
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

/**
 * Click a ribbon tab then a tool, wait for window.__lastBrepShape to be
 * updated with a new shape, and return its measured properties.
 */
async function clickAndMeasure(win, tabLabel, toolLabel) {
  // Capture id BEFORE the click so we can detect when the new shape appears.
  const before = await win.evaluate(() =>
    (window.__lastBrepShape && window.__lastBrepShape.id) || null);

  await clickRibbonTab(win, tabLabel);
  await win.waitForTimeout(120);
  await clickRibbonTool(win, toolLabel);

  await win.waitForFunction(
    (b) => !!window.__lastBrepShape && window.__lastBrepShape.id && window.__lastBrepShape.id !== b,
    before,
    { timeout: 60000 },
  );

  return win.evaluate(() =>
    window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape));
}

// ─── Test 1: Combine (Non-Manifold) ──────────────────────────────────────────

test('Combine (Non-Manifold): clicking ribbon fuses face-sharing boxes', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    // Handler: two 20mm boxes side-by-side (share face at x=20) → fused vol = 16 000 mm³
    const m = await clickAndMeasure(win, 'Part', 'Combine (Non-Manifold)');
    console.log(`  Combine (Non-Manifold): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(15500);
    expect(m.volume).toBeLessThan(16500);

    const cap = await captureAllAngles(win, 'b-nonmanifold', {
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

// ─── Test 2: Combine (Coincident) ────────────────────────────────────────────

test('Combine (Coincident): fuzzy-tolerance fuse of near-coincident boxes', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    // Handler: two 20mm boxes with 0.001 mm gap → fuzzy-fused vol ≈ 16 000 mm³
    const m = await clickAndMeasure(win, 'Part', 'Combine (Coincident)');
    console.log(`  Combine (Coincident): vol=${m.volume.toFixed(3)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(15500);
    expect(m.volume).toBeLessThan(16500);

    const cap = await captureAllAngles(win, 'b-coincident', {
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

// ─── Test 3: Lattice Fuse ─────────────────────────────────────────────────────

test('Lattice Fuse: 8-member lattice fused in one boolean pass', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    // Handler: 8 × (10×3×3) non-overlapping boxes → vol = 720 mm³
    const m = await clickAndMeasure(win, 'Part', 'Lattice Fuse');
    console.log(`  Lattice Fuse: vol=${m.volume.toFixed(3)}, faces=${m.faceCount}`);
    // 8 × 90 = 720 mm³, ±10%
    expect(m.volume).toBeGreaterThan(648);
    expect(m.volume).toBeLessThan(792);

    const cap = await captureAllAngles(win, 'b-lattice', {
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

// ─── Test 4: Replace Face ─────────────────────────────────────────────────────

test('Replace Face: clicking ribbon rewrites a face via BRepTools_ReShape', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    // Handler: replaceFace(20mm box, 1) → valid 6-face solid, vol = 8 000 mm³
    const m = await clickAndMeasure(win, 'Direct Edit', 'Replace Face');
    console.log(`  Replace Face: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(0);
    expect(m.faceCount).toBeGreaterThanOrEqual(6);

    const cap = await captureAllAngles(win, 'b-replaceface', {
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
