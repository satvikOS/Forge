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

test('cylinder: r5 h12 builds with volume ~942 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderCylinder(5, 12));
  expect(m.volume).toBeGreaterThan(930);
  expect(m.volume).toBeLessThan(955);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('sphere: r6 builds with volume ~905 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderSphere(6));
  expect(m.volume).toBeGreaterThan(890);
  expect(m.volume).toBeLessThan(920);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('cone: r1=6 r2=2 h12 builds with positive volume', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderCone(6, 2, 12));
  expect(m.volume).toBeGreaterThan(620);
  expect(m.volume).toBeLessThan(685);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('torus: R10 r3 builds with volume ~1776 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderTorus(10, 3));
  expect(m.volume).toBeGreaterThan(1740);
  expect(m.volume).toBeLessThan(1815);
  expect(pageErrors).toEqual([]);
  await app.close();
});
