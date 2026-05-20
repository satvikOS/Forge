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
  // Pre-warm kernel WASM fully before running the test — avoids stack-overflow
  // page errors that can occur when the 50 MB WASM is still initializing.
  await win.waitForFunction(async () => {
    try {
      const oc = await window.__archdiscKernel.getOCCT();
      return typeof oc.BRepPrimAPI_MakeBox_2 === 'function';
    } catch { return false; }
  }, null, { timeout: 300000 });
  return { app, win, pageErrors };
}

test.setTimeout(600000);

test('STEP round-trip: export a box, re-import it, metrics match', async () => {
  const { app, win, pageErrors } = await launch();
  const result = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const box = await K.makeBox(10, 10, 10);
    const before = await K.measure(box);
    const stepText = await K.exportStep(box);
    const reimported = await K.importStep(stepText);
    const after = await K.measure(reimported);
    return { before, after, stepHead: stepText.slice(0, 24), stepLen: stepText.length };
  });
  expect(result.stepHead).toContain('ISO-10303-21');
  expect(result.stepLen).toBeGreaterThan(200);
  expect(Math.abs(result.after.volume - result.before.volume)).toBeLessThan(1);
  expect(result.after.faceCount).toBe(result.before.faceCount);
  expect(pageErrors).toEqual([]);
  await app.close();
});
