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

// Two coincident 10mm boxes: fuse -> 1000, common -> 1000 (deterministic).
async function runBool(win, op) {
  return win.evaluate(async (which) => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(10, 10, 10);
    const b = await K.makeBox(10, 10, 10);
    const result = await K[which](a, b);
    return K.measure(result);
  }, op);
}

test('fuse: two coincident boxes union to one box volume (~1000)', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await runBool(win, 'fuse');
  expect(m.volume).toBeGreaterThan(990);
  expect(m.volume).toBeLessThan(1010);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('common: two coincident boxes intersect to one box volume (~1000)', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await runBool(win, 'common');
  expect(m.volume).toBeGreaterThan(990);
  expect(m.volume).toBeLessThan(1010);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('cut: a 20mm block minus a drilled cylinder removes volume', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const block = await K.makeBox(20, 20, 20);
    const drill = await K.makeCylinder(5, 20);
    const holed = await K.cut(block, drill);
    return K.measure(holed);
  });
  expect(m.volume).toBeGreaterThan(0);
  expect(m.volume).toBeLessThan(8000);
  expect(pageErrors).toEqual([]);
  await app.close();
});
