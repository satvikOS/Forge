/**
 * brep-localops-electron.spec.js
 *
 * A2 gate — headed Electron e2e tests for local operations:
 *   shell / hollow, thicken, offsetShape, draft.
 *
 * Expected values from docs/superpowers/notes/occt-api-A2.md items 1-4.
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

test('shell: hollow a 20mm box with wall-2 -> volume in (3224, 3561)', async () => {
  // Empirically measured: 3392 mm³ (occt-api-A2.md item 1)
  // ±5% window: 3392 * 0.95 = 3222.4, 3392 * 1.05 = 3561.6 → (3222, 3562)
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const brep = window.__archdiscKernel.kernel.brep;
    const box = await brep.makeBox(20, 20, 20);
    const hollowed = await brep.shell(box, 2);
    box.dispose();
    const metrics = await brep.measure(hollowed);
    hollowed.dispose();
    return metrics;
  });
  expect(pageErrors).toEqual([]);
  expect(m.volume).toBeGreaterThan(0);
  expect(m.volume).toBeLessThan(8000);
  // Tightened ±5% around measured 3392 mm³
  expect(m.volume).toBeGreaterThan(3222);
  expect(m.volume).toBeLessThan(3562);
  await app.close();
});

test('thicken: 60x40 sheet thickened 3mm -> volume in (6840, 7560)', async () => {
  // Empirically measured: |vol| = 7200 mm³ (occt-api-A2.md item 2)
  // Orientation fix in BrepLocalOps.js ensures positive volume.
  // ±5% window: 7200 * 0.95 = 6840, 7200 * 1.05 = 7560
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const brep = window.__archdiscKernel.kernel.brep;
    const slab = await brep.thicken(60, 40, 3);
    const metrics = await brep.measure(slab);
    slab.dispose();
    return metrics;
  });
  expect(pageErrors).toEqual([]);
  expect(m.volume).toBeGreaterThan(6840);
  expect(m.volume).toBeLessThan(7560);
  await app.close();
});

test('offsetShape: offset 20mm box outward +2mm -> volume > 9120', async () => {
  // Empirically measured: 9600 mm³ (occt-api-A2.md item 3)
  // Lower bound: 9600 * 0.95 = 9120
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const brep = window.__archdiscKernel.kernel.brep;
    const box = await brep.makeBox(20, 20, 20);
    const offset = await brep.offsetShape(box, 2);
    box.dispose();
    const metrics = await brep.measure(offset);
    offset.dispose();
    return metrics;
  });
  expect(pageErrors).toEqual([]);
  expect(m.volume).toBeGreaterThan(8000);
  // Tightened lower bound ±5% around 9600
  expect(m.volume).toBeGreaterThan(9120);
  await app.close();
});

test('draft: 5deg draft on 20mm box -> positive volume ~6682, 6 faces', async () => {
  // Empirically measured: 6681.83 mm³ (occt-api-A2.md item 4)
  // ±5% window: 6681.83 * 0.95 = 6347.7, 6681.83 * 1.05 = 7015.9
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const brep = window.__archdiscKernel.kernel.brep;
    const box = await brep.makeBox(20, 20, 20);
    const drafted = await brep.draft(box, 5);
    box.dispose();
    const metrics = await brep.measure(drafted);
    drafted.dispose();
    return metrics;
  });
  expect(pageErrors).toEqual([]);
  expect(m.volume).toBeGreaterThan(0);
  expect(m.faceCount).toBe(6);
  // Tightened ±5% around 6681.83
  expect(m.volume).toBeGreaterThan(6347);
  expect(m.volume).toBeLessThan(7016);
  await app.close();
});
