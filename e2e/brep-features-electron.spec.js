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

test('extrude: 12x8 rect extruded 5mm -> volume 480 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderExtrude(12, 8, 5));
  expect(m.volume).toBeGreaterThan(475);
  expect(m.volume).toBeLessThan(485);
  expect(m.faceCount).toBe(6);
  const cap = await captureAllAngles(win, 'extrude', SWEEP);
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('revolve: full 360 ring has positive volume ~1037 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderRevolve(4, 3, 10, 360));
  expect(m.volume).toBeGreaterThan(1000);
  expect(m.volume).toBeLessThan(1075);
  const cap = await captureAllAngles(win, 'revolve', SWEEP);
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('fillet: filleting all edges of a 10mm box reduces volume below 1000', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderFillet(10, 1.5));
  expect(m.volume).toBeGreaterThan(900);
  expect(m.volume).toBeLessThan(1000);
  expect(m.faceCount).toBeGreaterThan(6);
  const cap = await captureAllAngles(win, 'fillet', SWEEP);
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('chamfer: chamfering all edges of a 10mm box reduces volume below 1000', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderChamfer(10, 1.5));
  // d=1.5 chamfer on all 12 edges of a 10mm box: empirically measured ~883 mm3
  // (A1 note: d=1 → 945.33; d=1.5 removes more material, ~883 exact)
  expect(m.volume).toBeGreaterThan(870);
  expect(m.volume).toBeLessThan(1000);
  expect(m.faceCount).toBeGreaterThan(6);
  const cap = await captureAllAngles(win, 'chamfer', SWEEP);
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});
