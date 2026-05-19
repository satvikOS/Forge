/**
 * brep-check-electron.spec.js
 *
 * A3 gate: self-intersection detection and clash / interference detection.
 * Ops under test: checkSelfIntersection, checkClash, translate, makeCompound.
 * Verified OCCT sequences: docs/superpowers/notes/occt-api-A3.md.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

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

test('self-intersection: a clean box reports none', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const box = await K.makeBox(20, 20, 20);
    return K.checkSelfIntersection(box);
  });
  expect(r.selfIntersects).toBe(false);
  expect(r.valid).toBe(true);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('self-intersection: a compound of two overlapping boxes is detected', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const bRaw = await K.makeBox(20, 20, 20);
    const b = await K.translate(bRaw, 10, 0, 0);   // overlaps `a`
    const compound = await K.makeCompound([a, b]);
    return K.checkSelfIntersection(compound);
  });
  expect(r.selfIntersects).toBe(true);
  expect(r.count).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('clash: two overlapping solids clash with positive interference volume', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const bRaw = await K.makeBox(20, 20, 20);
    const b = await K.translate(bRaw, 10, 0, 0);   // overlaps `a` by 10mm
    return K.checkClash(a, b);
  });
  expect(r.clash).toBe(true);
  expect(r.interferenceVolume).toBeGreaterThan(3600);  // ~4000 (10x20x20), -10%
  expect(r.interferenceVolume).toBeLessThan(4400);
  expect(r.minDistance).toBeLessThan(0.001);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('clash: two disjoint solids report no clash with a real clearance', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const bRaw = await K.makeBox(20, 20, 20);
    const b = await K.translate(bRaw, 50, 0, 0);   // gap: box a ends x=20, b starts x=50
    return K.checkClash(a, b);
  });
  expect(r.clash).toBe(false);
  expect(r.interferenceVolume).toBeLessThan(0.001);
  expect(r.minDistance).toBeGreaterThan(27);   // ~30mm gap, ±10%
  expect(r.minDistance).toBeLessThan(33);
  expect(pageErrors).toEqual([]);
  await app.close();
});
