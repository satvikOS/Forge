/**
 * brep-primitives-electron.spec.js
 *
 * Real-user-workflow tests for OCCT solid primitives.
 * Every geometry op is invoked by clicking the real ribbon tool button
 * (Part tab, Solid Primitives group) — NOT by calling kernel APIs directly.
 *
 * Handler defaults (from ToolExecutionEngine.js):
 *   Cylinder  : r=20 mm, h=40 mm  → V = π×400×40 ≈ 50 265 mm³
 *   Sphere    : r=25 mm           → V = (4/3)π×15625 ≈ 65 450 mm³
 *   Cone      : r1=25 r2=8 h=45   → V = π×(45/3)×(625+200+64) ≈ 41 900 mm³
 *   Torus     : R=30 r=10         → V = 2π²×30×100 ≈ 59 218 mm³
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

/**
 * Click a ribbon tool by exact label text and wait for __lastBrepShape to
 * update to a new value (or be set from null).
 * Tab must already be active before calling this.
 */
async function clickRibbonTool(win, toolName) {
  // Capture current shape id so we can detect the change reliably.
  const prevId = await win.evaluate(() =>
    window.__lastBrepShape ? window.__lastBrepShape.id : null
  );
  // Clear the slot so an absent previous id never creates ambiguity.
  await win.evaluate(() => { window.__lastBrepShape = null; });

  const re = new RegExp(`^${toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const btn = win.locator('button.ribbon-tool:has(.ribbon-tool-label)').filter({
    has: win.locator('.ribbon-tool-label', { hasText: re }),
  }).first();
  await expect(btn).toBeVisible({ timeout: 30000 });
  await btn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  // Wait for the handler to set __lastBrepShape.
  await win.waitForFunction(() => !!window.__lastBrepShape, null, { timeout: 120000 });
}

/** Switch the ribbon to the Part tab. */
async function switchToPartTab(win) {
  const tab = win.locator('button.ribbon-tab').filter({ hasText: /^Part$/ });
  await expect(tab).toBeVisible({ timeout: 30000 });
  await tab.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

// ─── Cylinder ────────────────────────────────────────────────────────────────

test('cylinder: ribbon click builds r=20 h=40 cylinder, volume ≈ 50 265 mm³', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await clickRibbonTool(win, 'Cylinder');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Cylinder: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // r=20 h=40 → π×400×40 = 50 265.48 mm³, ±10 %
    expect(m.volume).toBeGreaterThan(45239);
    expect(m.volume).toBeLessThan(55292);
    expect(m.faceCount).toBeGreaterThanOrEqual(3); // top, bottom, lateral

    const cap = await captureAllAngles(win, 'cylinder', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Sphere ──────────────────────────────────────────────────────────────────

test('sphere: ribbon click builds r=25 sphere, volume ≈ 65 450 mm³', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await clickRibbonTool(win, 'Sphere');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Sphere: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // r=25 → (4/3)π×15625 = 65 449.85 mm³, ±10 %
    expect(m.volume).toBeGreaterThan(58905);
    expect(m.volume).toBeLessThan(71995);
    expect(m.faceCount).toBeGreaterThanOrEqual(1);

    const cap = await captureAllAngles(win, 'sphere', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Cone ────────────────────────────────────────────────────────────────────

test('cone: ribbon click builds r1=25 r2=8 h=45 cone, positive volume', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await clickRibbonTool(win, 'Cone');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Cone: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // r1=25 r2=8 h=45 → π×15×(625+200+64) = π×15×889 ≈ 41 918 mm³, ±10 %
    expect(m.volume).toBeGreaterThan(37726);
    expect(m.volume).toBeLessThan(46110);
    expect(m.faceCount).toBeGreaterThanOrEqual(2); // cone lateral + caps

    const cap = await captureAllAngles(win, 'cone', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Torus ───────────────────────────────────────────────────────────────────

test('torus: ribbon click builds R=30 r=10 torus, volume ≈ 59 218 mm³', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await clickRibbonTool(win, 'Torus');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Torus: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // R=30 r=10 → 2π²×30×100 = 59 217.61 mm³, ±10 %
    expect(m.volume).toBeGreaterThan(53296);
    expect(m.volume).toBeLessThan(65139);
    expect(m.faceCount).toBeGreaterThanOrEqual(1);

    const cap = await captureAllAngles(win, 'torus', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
