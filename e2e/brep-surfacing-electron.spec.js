/**
 * brep-surfacing-electron.spec.js
 *
 * A2 gate — headed Electron e2e tests for surfacing operations:
 *   sweep (pipe), loft (ThruSections).
 *
 * Expected values from docs/superpowers/notes/occt-api-A2.md items 5-6.
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

// 6 azimuths × 2 elevations × 3 zooms = 36 captures
const SWEEP = { azimuths: [0, 60, 120, 180, 240, 300], elevations: [-30, 40], zooms: [0.6, 1.0, 1.8] };

test('sweep: r=8 disk swept 60mm -> volume in (11400, 12700)', async () => {
  // Empirically measured: 12063.72 mm³ (= π·8²·60, occt-api-A2.md item 5)
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const brep = window.__archdiscKernel.kernel.brep;
    const pipe = await brep.sweep(8, 60);
    const metrics = await brep.measure(pipe);
    pipe.dispose();
    return metrics;
  });
  expect(pageErrors).toEqual([]);
  expect(m.volume).toBeGreaterThan(11400);
  expect(m.volume).toBeLessThan(12700);
  // Render for visual verification
  await win.evaluate(() => window.__archdiscKernel.renderSweep(8, 60));
  const cap = await captureAllAngles(win, 'sweep', SWEEP);
  expect(cap.blanks).toEqual([]);
  await app.close();
});

test('loft: 40x40 bottom, 16x16 top, height=50 -> volume > 0 and in expected range', async () => {
  // loft(bottomSize=40, topSize=16, height=50)
  // The loft is a frustum-like solid. Volume of frustum with square sections:
  //   V = h/3 * (A1 + A2 + sqrt(A1*A2)) = 50/3 * (1600 + 256 + 640) = 50/3 * 2496 = 41600
  // Actual measured value may differ slightly; allow a wide initial range then tighten.
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const brep = window.__archdiscKernel.kernel.brep;
    const lofted = await brep.loft(40, 16, 50);
    const metrics = await brep.measure(lofted);
    lofted.dispose();
    return metrics;
  });
  expect(pageErrors).toEqual([]);
  expect(m.volume).toBeGreaterThan(0);
  // Tightened upper bound: frustum formula gives ~41600; allow ±5% = (39520, 43680)
  expect(m.volume).toBeGreaterThan(39520);
  expect(m.volume).toBeLessThan(43680);
  // Render for visual verification
  await win.evaluate(() => window.__archdiscKernel.renderLoft(40, 16, 50));
  const cap = await captureAllAngles(win, 'loft', SWEEP);
  expect(cap.blanks).toEqual([]);
  await app.close();
});
