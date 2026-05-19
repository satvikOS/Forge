/**
 * brep-varfillet-electron.spec.js
 *
 * A2 gate — headed Electron e2e test for variable-radius fillet.
 *
 * Expected values from docs/superpowers/notes/occt-api-A2.md item 7.
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

test('variableFillet: 20mm box r1=1->r2=4 on all edges -> volume in (6000, 8000), faceCount > 6', async () => {
  // Empirically measured: 7969.16 mm³ (occt-api-A2.md item 7, ONE edge).
  // variableFillet() fills ALL edges with variable radius r1->r2, so volume
  // will be further below 8000 than the single-edge case.
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const brep = window.__archdiscKernel.kernel.brep;
    const box = await brep.makeBox(20, 20, 20);
    const filleted = await brep.variableFillet(box, 1, 4);
    box.dispose();
    const metrics = await brep.measure(filleted);
    filleted.dispose();
    return metrics;
  });
  expect(pageErrors).toEqual([]);
  expect(m.volume).toBeGreaterThan(6000);
  expect(m.volume).toBeLessThan(8000);
  expect(m.faceCount).toBeGreaterThan(6);
  await app.close();
});
