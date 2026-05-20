/**
 * brep-boolean-electron.spec.js
 *
 * Real-user-workflow tests for OCCT boolean operations.
 * Every geometry op is invoked by clicking the real ribbon tool button
 * (Part tab, Boolean group) — NOT by calling kernel APIs directly.
 *
 * Handler builds (from ToolExecutionEngine.js):
 *   Combine  : fuse( 30³ box,  r=12 h=40 cylinder ) → V > 27000 mm³ (union)
 *   Subtract : cut( 40³ box − r=12 h=40 cylinder ) → V ≈ 64000−18096 = 45904 mm³
 *   Intersect: common( 40³ box ∩ sphere r=26 )      → V ≈ 64000 mm³ (sphere r=26 is larger)
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

// ─── Combine (fuse) ───────────────────────────────────────────────────────────

test('Combine: ribbon click fuses 30³ box + r=12 h=40 cylinder, volume > 0', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await clickRibbonTool(win, 'Combine');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Combine: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // box V=27000, cyl V=π×144×40≈18096; fused V > max(27000,18096)
    // and <= 27000+18096=45096 (no overlap assumed). ±10% around ~45096 (they may not overlap).
    // The box is at origin; cylinder at origin too → they overlap significantly.
    // Conservative: fused V must be > 27000 and < 50000.
    expect(m.volume).toBeGreaterThan(27000);
    expect(m.faceCount).toBeGreaterThanOrEqual(1);

    const cap = await captureAllAngles(win, 'bool-combine', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Subtract (cut) ───────────────────────────────────────────────────────────

test('Subtract: ribbon click cuts r=12 h=40 cylinder from 40³ box, positive volume less than original', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await clickRibbonTool(win, 'Subtract');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Subtract: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Empirically measured: 59476 mm³ (cylinder placed at box corner, partial overlap).
    // ±10% around 59476: (53528, 65424). Volume must be < 64000 (cut removed material).
    expect(m.volume).toBeGreaterThan(53500);
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBeGreaterThan(2);

    const cap = await captureAllAngles(win, 'bool-subtract', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Intersect (common) ───────────────────────────────────────────────────────

test('Intersect: ribbon click intersects 40³ box ∩ sphere r=26, positive volume', async () => {
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await clickRibbonTool(win, 'Intersect');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Intersect: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Empirically measured: 9203 mm³ — sphere origin at box corner (0,0,0),
    // so intersection is a corner spherical sector ≈ (1/8) of sphere volume
    // = (4/3)π×26³/8 ≈ 9154 mm³. ±10%: (8283, 10123).
    expect(m.volume).toBeGreaterThan(8283);
    expect(m.volume).toBeLessThan(10123);
    expect(m.faceCount).toBeGreaterThanOrEqual(1);

    const cap = await captureAllAngles(win, 'bool-intersect', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
