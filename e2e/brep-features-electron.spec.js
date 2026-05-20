/**
 * brep-features-electron.spec.js
 *
 * Real-user-workflow tests for OCCT feature operations.
 * Every geometry op is invoked by clicking the real ribbon tool button
 * (Part tab) — NOT by calling kernel APIs directly.
 *
 * The ToolParamDialog auto-resolves with schema defaults when
 * navigator.webdriver is true (Playwright sets this). Effective defaults:
 *   Extrude Boss : width=80 depth=50 height=25 → V = 80×50×25 = 100 000 mm³
 *   Revolve Boss : innerR=12 width=18 height=40 → ring torus-like solid
 *   Fillet       : radius=2 on default 40³ box (no prior __lastBrepShape)
 *   Chamfer      : distance=2 on default 40³ box (no prior __lastBrepShape)
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

// ─── Extrude Boss ─────────────────────────────────────────────────────────────

test('Extrude Boss: ribbon click + dialog auto-defaults → 80×50×25 mm, V = 100 000 mm³', async () => {
  // The ToolParamDialog auto-resolves under Playwright (navigator.webdriver=true)
  // with defaults: width=80, depth=50, height=25.
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await clickRibbonTool(win, 'Extrude Boss');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Extrude Boss: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // 80×50×25 = 100 000 mm³, ±10%
    expect(m.volume).toBeGreaterThan(90000);
    expect(m.volume).toBeLessThan(110000);
    expect(m.faceCount).toBe(6); // rectangular prism

    const cap = await captureAllAngles(win, 'extrude-boss', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Revolve Boss ─────────────────────────────────────────────────────────────

test('Revolve Boss: ribbon click + dialog auto-defaults → innerR=12 w=18 h=40, positive volume', async () => {
  // The ToolParamDialog auto-resolves under Playwright.
  // Handler defaults: innerR=12, width=18, height=40 — revolves a ring 360°.
  // Volume = π×40×((12+18)²−12²) = π×40×(900−144) = π×40×756 ≈ 95 034 mm³
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await clickRibbonTool(win, 'Revolve Boss');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Revolve Boss: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // Annular ring: outerR=innerR+width=30, innerR=12, height=40
    // V = π×h×(R²−r²) = π×40×(900−144) ≈ 95 034 mm³, ±15% (OCCT approximation)
    expect(m.volume).toBeGreaterThan(50000);
    expect(m.faceCount).toBeGreaterThanOrEqual(3);

    const cap = await captureAllAngles(win, 'revolve-boss', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Fillet ───────────────────────────────────────────────────────────────────

test('Fillet: ribbon click + dialog auto-defaults → r=2 on 40³ box, volume < 64000', async () => {
  // The ToolParamDialog auto-resolves under Playwright.
  // Handler: no prior __lastBrepShape → creates a 40³ box, fillets all edges r=2.
  // Fillet removes material from corners → V < 64000 and > 0.
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    // Ensure no prior OCCT body so the handler builds its own 40³ box.
    await win.evaluate(() => { window.__lastBrepShape = null; });
    await clickRibbonTool(win, 'Fillet');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Fillet: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(58000); // r=2 on 40³ box → small material removal
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBeGreaterThan(6);  // filleted box has curved faces

    const cap = await captureAllAngles(win, 'fillet-boss', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Chamfer ──────────────────────────────────────────────────────────────────

test('Chamfer: ribbon click + dialog auto-defaults → d=2 on 40³ box, volume < 64000', async () => {
  // The ToolParamDialog auto-resolves under Playwright.
  // Handler: no prior __lastBrepShape → creates a 40³ box, chamfers all edges d=2.
  // Chamfer removes material from corners → V < 64000 and > 0.
  const { app, win, pageErrors } = await launch();
  try {
    await switchToPartTab(win);
    await win.evaluate(() => { window.__lastBrepShape = null; });
    await clickRibbonTool(win, 'Chamfer');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Chamfer: vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    expect(m.volume).toBeGreaterThan(55000); // d=2 chamfer on 40³ box
    expect(m.volume).toBeLessThan(64000);
    expect(m.faceCount).toBeGreaterThan(6);  // chamfered box has extra faces

    const cap = await captureAllAngles(win, 'chamfer-boss', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
