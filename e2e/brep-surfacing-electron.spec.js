/**
 * brep-surfacing-electron.spec.js
 *
 * Real-user-workflow tests for surfacing operations.
 * Every geometry op is invoked by clicking the real ribbon tool button
 * (Part tab, Create group) and filling the ToolParamDialog — NOT by
 * calling kernel APIs directly.
 *
 * Each test builds a recognisable real-world engineering artifact.
 *
 * Arity-0 (no body selection, dialog defines geometry):
 *   Sweep Boss : pipe (circular profile swept along axis) — r=8, 60 mm path
 *                → V = π×64×60 ≈ 12 064 mm³
 *   Loft Boss  : transition fitting (square-to-square loft) — 40→16 over 50 mm
 *                → V ≈ 41 600 mm³
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

// ─── Sweep Boss ───────────────────────────────────────────────────────────────

test('Sweep Boss: pipe (circular profile swept along axis) — ribbon click + dialog defaults → r=8 disk swept 60 mm, V in (10858, 13270)', async () => {
  // Artifact: pipe (circular profile swept along axis)
  // Arity-0: no body selection. Dialog defaults: radius=8, length=60.
  // A circular cross-section (r=8 mm) swept along a 60 mm straight axis produces
  // a solid pipe segment — as used in hydraulic lines, structural tube members,
  // or conduit runs.
  // sweep(r=8, 60) → π×64×60 = 12 063.72 mm³, ±10%
  const { app, win, pageErrors } = await launch();
  try {
    // Click Part tab → Sweep Boss → accept dialog defaults.
    await buildPrimitive(win, 'Sweep Boss');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Sweep Boss (pipe): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // π×64×60 = 12 063.72 mm³, ±10%
    expect(m.volume).toBeGreaterThan(10858);
    expect(m.volume).toBeLessThan(13270);

    const cap = await captureAllAngles(win, 'sweep-boss', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

// ─── Loft Boss ────────────────────────────────────────────────────────────────

test('Loft Boss: transition fitting (square-to-square loft) — ribbon click + dialog defaults → 40→16 squares over 50 mm, V in (37440, 45760)', async () => {
  // Artifact: transition fitting (square-to-square loft)
  // Arity-0: no body selection. Dialog defaults: bottomSize=40, topSize=16, height=50.
  // A square-to-square loft over 50 mm produces a transition fitting — as used in
  // HVAC ductwork reducers, pressure vessel nozzle transitions, or casting sprue gates.
  // V = h/3×(A1+A2+√(A1×A2)) = 50/3×(1600+256+640) = 50/3×2496 ≈ 41 600 mm³, ±10%
  const { app, win, pageErrors } = await launch();
  try {
    // Click Part tab → Loft Boss → accept dialog defaults.
    await buildPrimitive(win, 'Loft Boss');

    const m = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)
    );
    console.log(`  Loft Boss (transition fitting): vol=${m.volume.toFixed(0)}, faces=${m.faceCount}`);
    // ±10% around 41 600 mm³
    expect(m.volume).toBeGreaterThan(37440);
    expect(m.volume).toBeLessThan(45760);

    const cap = await captureAllAngles(win, 'loft-boss', SWEEP);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
