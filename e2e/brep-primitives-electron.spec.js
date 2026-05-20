/**
 * brep-primitives-electron.spec.js
 *
 * Real-user-workflow tests for OCCT solid primitives.
 * Every geometry op is invoked by clicking the real ribbon tool button
 * (Part tab, Solid Primitives group) and filling the ToolParamDialog —
 * NOT by calling kernel APIs directly.
 *
 * Each primitive IS the artifact at its simplest — no composite needed.
 *
 * Under Playwright (navigator.webdriver=true) the ToolParamDialog
 * auto-resolves with schema defaults immediately. Effective defaults:
 *   Cylinder  : r=20 mm, h=40 mm  → V = π×400×40 ≈ 50 265 mm³
 *   Sphere    : r=25 mm           → V = (4/3)π×15625 ≈ 65 450 mm³
 *   Cone      : r1=25 r2=8 h=45   → V = π×(45/3)×(625+200+64) ≈ 41 900 mm³
 *   Torus     : R=30 r=10         → V = 2π²×30×100 ≈ 59 218 mm³
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';
import { buildPrimitive } from './helpers/uiWorkflow.js';

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

// ─── Cylinder ────────────────────────────────────────────────────────────────

test('cylinder: cylindrical pin / shaft stub — ribbon click builds r=20 h=40 cylinder, volume ≈ 50 265 mm³', async () => {
  // Artifact: cylindrical pin / shaft stub
  // A solid cylinder (r=20 mm, h=40 mm) as used for a locating pin, shaft stub,
  // or bearing journal. The simplest rotational solid in any machine assembly.
  const { app, win, pageErrors } = await launch();
  try {
    // Build via real ribbon click + dialog (defaults: r=20 h=40).
    await buildPrimitive(win, 'Cylinder');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Cylinder (pin/shaft stub): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
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

test('sphere: ball joint / bearing ball — ribbon click builds r=25 sphere, volume ≈ 65 450 mm³', async () => {
  // Artifact: ball joint / bearing ball
  // A solid sphere (r=25 mm) as used for a ball-joint socket mating surface,
  // a precision bearing ball, or a spherical end cap on a linkage rod.
  const { app, win, pageErrors } = await launch();
  try {
    // Build via real ribbon click + dialog (defaults: r=25).
    await buildPrimitive(win, 'Sphere');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Sphere (ball joint/bearing ball): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
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

test('cone: tapered locator / cone insert — ribbon click builds r1=25 r2=8 h=45 cone, positive volume', async () => {
  // Artifact: tapered locator / cone insert
  // A frustum cone (r1=25, r2=8, h=45 mm) as used for a tapered locating pin,
  // a conical insert for alignment in fixture plates, or a funnel entry geometry.
  const { app, win, pageErrors } = await launch();
  try {
    // Build via real ribbon click + dialog (defaults: r1=25 r2=8 h=45).
    await buildPrimitive(win, 'Cone');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Cone (tapered locator): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
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

test('torus: O-ring / wheel rim — ribbon click builds R=30 r=10 torus, volume ≈ 59 218 mm³', async () => {
  // Artifact: O-ring / wheel rim
  // A solid torus (R=30 mm, r=10 mm) as used for an O-ring seal profile,
  // a wheel rim cross-section, or a circular gasket blank.
  const { app, win, pageErrors } = await launch();
  try {
    // Build via real ribbon click + dialog (defaults: majorRadius=30 minorRadius=10).
    await buildPrimitive(win, 'Torus');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Torus (O-ring/wheel rim): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
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
