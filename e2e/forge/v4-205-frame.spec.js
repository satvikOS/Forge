// v4-205-frame.spec.js — Forge-205 frame / truss FEA.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-205-frame';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-205 · frame / truss FEA', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.frame
         && typeof window.forge.frame.solve === 'function'));
    expect(has).toBe(true);
  });

  test('02 single-bar axial: u = F·L / (E·A) (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.frame.solve({
      nodes: [
        { position: [0, 0, 0],    fixed: [true, true, true] },
        { position: [1000, 0, 0], fixed: [false, true, true] },
      ],
      elements: [{ a: 0, b: 1, E: 200e3, A: 100 }],
      loads: [{ node: 1, force: [1000, 0, 0] }],
    }));
    expect(r.singular).toBe(false);
    expect(r.displacements[3]).toBeCloseTo(0.05, 6);
    expect(r.axialForce[0]).toBeCloseTo(1000, 5);
    expect(r.reactions[0]).toBeCloseTo(-1000, 5);
    await shot(page, 'axial-bar');
  });

  test('03 symmetric V-truss bar forces (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.frame.solve({
      nodes: [
        { position: [0, 0, 0],         fixed: [true, true, true] },
        { position: [1000, 0, 0],      fixed: [true, true, true] },
        { position: [500, 866.025, 0], fixed: [false, false, true] },
      ],
      elements: [
        { a: 0, b: 2, E: 200e3, A: 100 },
        { a: 1, b: 2, E: 200e3, A: 100 },
      ],
      loads: [{ node: 2, force: [0, -1000, 0] }],
    }));
    expect(r.axialForce[0]).toBeCloseTo(-577.35, 1);
    expect(r.axialForce[1]).toBeCloseTo(-577.35, 1);
    await shot(page, 'v-truss');
  });

  test('04 detects singular (mechanism) (cam #3)', async () => {
    // Two collinear bars + load perpendicular to the axis → singular.
    const r = await page.evaluate(() => window.forge.frame.solve({
      nodes: [
        { position: [0,    0, 0], fixed: [true, true, true] },
        { position: [1000, 0, 0], fixed: [false, false, true] },
        { position: [2000, 0, 0], fixed: [true, true, true] },
      ],
      elements: [
        { a: 0, b: 1, E: 200e3, A: 100 },
        { a: 1, b: 2, E: 200e3, A: 100 },
      ],
      loads: [{ node: 1, force: [0, -1000, 0] }],
    }));
    expect(r.singular).toBe(true);
    await shot(page, 'singular');
  });

  test('05 Warren-truss fixture solves cleanly (cam #4)', async () => {
    const r = await page.evaluate(() => {
      const fix = window.__forgeFrameFixture();
      return window.__forgeFrameSolve(fix);
    });
    expect(r.singular).toBe(false);
    expect(r.axialForce.length).toBe(19);   // 5 bot + 4 top + 10 diag
    let maxAxial = 0;
    for (let i = 0; i < r.axialForce.length; ++i) {
      if (Math.abs(r.axialForce[i]) > maxAxial) maxAxial = Math.abs(r.axialForce[i]);
    }
    expect(maxAxial).toBeGreaterThan(0);
    await shot(page, 'warren-result');
  });

  test('06 open the workbench panel + solve (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenFrameWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-frame-panel"]')).toBeVisible();
    await page.locator('[data-testid="forge-frame-solve"]').click();
    await page.waitForSelector('[data-testid="forge-frame-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-frame-result"]')).toBeVisible();
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
