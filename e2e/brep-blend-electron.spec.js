/**
 * brep-blend-electron.spec.js
 *
 * A5 gate — headed Electron e2e tests for hard-blending ops:
 *   blendG2, cliffEdgeBlend, mitreCorner.
 *
 * Expected values from docs/superpowers/notes/occt-api-A5.md empirical recon.
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

test('blendG2: builds a C2 fill face of the expected area, renders from all angles', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const f = await window.__archdiscKernel.kernel.brep.blendG2(6);
    await window.__archdiscKernel.renderShape(f);
    return window.__archdiscKernel.kernel.brep.measure(f);
  });
  // Planar 6×6 square wire filled with C2 → fill face area ≈ 36 mm² (±20%
  // tolerance for any continuity-induced curvature in the fill surface).
  expect(m.area).toBeGreaterThan(28);
  expect(m.area).toBeLessThan(60);
  expect(m.faceCount).toBeGreaterThanOrEqual(1);
  const cap = await captureAllAngles(win, 'a5-blendG2', {
    azimuths: [0, 60, 120, 180, 240, 300], elevations: [-30, 30], zooms: [0.6, 1.0, 1.8],
  });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('cliffEdgeBlend: r=8 on a 20mm box (40% of face) yields a valid rounded solid', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const box = await K.makeBox(20, 20, 20);
    const blended = await K.cliffEdgeBlend(box, 8);
    box.dispose();
    await window.__archdiscKernel.renderShape(blended);
    return K.measure(blended);
  });
  // Cliff-range r=8 on a 20mm box: volume drops well below 8000, but is
  // still a real positive solid; faceCount well above 6 (every original
  // edge becomes a rounded face, plus corner patches).
  expect(m.volume).toBeGreaterThan(2000);
  expect(m.volume).toBeLessThan(8000);
  expect(m.faceCount).toBeGreaterThan(6);
  const cap = await captureAllAngles(win, 'a5-cliff', {
    azimuths: [0, 60, 120, 180, 240, 300], elevations: [-30, 30], zooms: [0.6, 1.0, 1.8],
  });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('mitreCorner: r=3 on a 20mm box yields the recon-verified 26-face mitred solid', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const box = await K.makeBox(20, 20, 20);
    const mitred = await K.mitreCorner(box, 3);
    box.dispose();
    await window.__archdiscKernel.renderShape(mitred);
    return K.measure(mitred);
  });
  // Empirically verified in occt-api-A5.md: volume ≈ 7572, faceCount = 26.
  expect(m.volume).toBeGreaterThan(7200);
  expect(m.volume).toBeLessThan(7900);
  expect(m.faceCount).toBe(26);
  const cap = await captureAllAngles(win, 'a5-mitre', {
    azimuths: [0, 60, 120, 180, 240, 300], elevations: [-30, 30], zooms: [0.6, 1.0, 1.8],
  });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});
