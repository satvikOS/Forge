// v4-222-hydcyl.spec.js — Forge-222 hydraulic cylinder sizing.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-222-hydcyl';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-222 · hydraulic cylinder', () => {
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
      !!(window.forge && window.forge.hydcyl
         && typeof window.forge.hydcyl.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 areas match π·D²/4 (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.hydcyl.analyse({
      bore: 0.050, rodDiameter: 0.022,
      pressure: 21e6, flowRate: 1.667e-4,
      strokeLength: 0.200, rodE: 200e9, bucklingK: 1.0,
    }));
    expect(r.pistonArea).toBeCloseTo(Math.PI * 0.050 * 0.050 / 4, 12);
    expect(r.rodArea).toBeCloseTo(Math.PI * 0.022 * 0.022 / 4, 12);
    expect(r.annulusArea).toBeCloseTo(r.pistonArea - r.rodArea, 12);
    await shot(page, 'areas');
  });

  test('03 forces: F = p · A (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.hydcyl.analyse({
      bore: 0.050, rodDiameter: 0.022,
      pressure: 21e6, flowRate: 1.667e-4,
      strokeLength: 0.200, rodE: 200e9, bucklingK: 1.0,
    }));
    expect(r.extendForce).toBeCloseTo(21e6 * r.pistonArea, 6);
    expect(r.retractForce).toBeCloseTo(21e6 * r.annulusArea, 6);
    expect(r.extendForce).toBeGreaterThan(r.retractForce);
    await shot(page, 'forces');
  });

  test('04 speeds: v = Q / A, retract faster than extend (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.hydcyl.analyse({
      bore: 0.050, rodDiameter: 0.022,
      pressure: 21e6, flowRate: 1.667e-4,
      strokeLength: 0.200, rodE: 200e9, bucklingK: 1.0,
    }));
    expect(r.extendSpeed).toBeCloseTo(1.667e-4 / r.pistonArea, 9);
    expect(r.retractSpeed).toBeCloseTo(1.667e-4 / r.annulusArea, 9);
    expect(r.retractSpeed).toBeGreaterThan(r.extendSpeed);
    await shot(page, 'speeds');
  });

  test('05 buckling SF Euler with K = 1 (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.hydcyl.analyse({
      bore: 0.050, rodDiameter: 0.022,
      pressure: 21e6, flowRate: 1.667e-4,
      strokeLength: 0.200, rodE: 200e9, bucklingK: 1.0,
    }));
    const I_expected = Math.PI * Math.pow(0.022, 4) / 64;
    const Pcr_expected = Math.PI * Math.PI * 200e9 * I_expected / (1 * 0.2 * 1 * 0.2);
    expect(r.rodMomentI).toBeCloseTo(I_expected, 14);
    expect(r.rodEulerCriticalLoad).toBeCloseTo(Pcr_expected, 0);
    expect(r.bucklingSafetyFactor).toBeGreaterThan(2);
    await shot(page, 'buckling');
  });

  test('06 panel analyse renders SF banner (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenHydCylWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-hydcyl-run"]').click();
    await page.waitForSelector('[data-testid="forge-hydcyl-result"]', { timeout: 5000 });
    const sf = await page.locator('[data-testid="forge-hydcyl-sf"]').innerText();
    expect(sf).toMatch(/Buckling SF/);
    expect(sf).toMatch(/OK/);
    await shot(page, 'panel-sf');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
