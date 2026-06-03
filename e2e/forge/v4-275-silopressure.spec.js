// v4-275-silopressure.spec.js — Forge-275 Janssen silo pressure.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-275-silopressure';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const BASE = {
  bulkUnitWeightKnM3: 8, hydraulicRadiusM: 2,
  wallFrictionCoefficient: 0.4, horizontalRatioK: 0.4,
};

test.describe.serial('Forge-275 · Janssen silo pressure', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.silopressure
         && typeof window.forge.silopressure.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Grain silo asymptotes: γR/(μk), γR/μ, γR (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.silopressure.analyse({
      ...b, depthM: 0,
    }), BASE);
    expect(r.asymptoticVerticalKPa).toBeCloseTo(100, 4);
    expect(r.asymptoticWallKPa).toBeCloseTo(40, 4);
    expect(r.asymptoticFrictionKPa).toBeCloseTo(16, 4);
    expect(r.verticalPressureKPa).toBeCloseTo(0, 9);
    await shot(page, 'asymptotes');
  });

  test('03 At z = z_c → factor = 1 − e^-1 ≈ 0.632 (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.silopressure.analyse({
      ...b, depthM: 12.5,
    }), BASE);
    expect(r.depthRatioToZc).toBeCloseTo(1.0, 6);
    expect(r.verticalPressureKPa).toBeCloseTo(100 * (1 - Math.exp(-1)), 5);
    expect(r.wallPressureKPa).toBeCloseTo(40 * (1 - Math.exp(-1)), 5);
    expect(r.frictionStressKPa).toBeCloseTo(16 * (1 - Math.exp(-1)), 5);
    await shot(page, 'zc');
  });

  test('04 Deep silo z → ∞ approaches asymptotes (cam #4)', async () => {
    const r = await page.evaluate((b) => window.forge.silopressure.analyse({
      ...b, depthM: 100,
    }), BASE);
    expect(r.verticalPressureKPa).toBeGreaterThan(0.999 * r.asymptoticVerticalKPa);
    expect(r.wallPressureKPa).toBeGreaterThan(0.999 * r.asymptoticWallKPa);
    expect(r.frictionStressKPa).toBeGreaterThan(0.999 * r.asymptoticFrictionKPa);
    await shot(page, 'deep');
  });

  test('05 Smaller k pushes z_c out → slower asymptote (cam #5)', async () => {
    const a = await page.evaluate((b) => window.forge.silopressure.analyse({
      ...b, horizontalRatioK: 0.4, depthM: 12.5,
    }), BASE);
    const b = await page.evaluate((base) => window.forge.silopressure.analyse({
      ...base, horizontalRatioK: 0.25, depthM: 12.5,
    }), BASE);
    expect(b.depthRatioToZc).toBeLessThan(a.depthRatioToZc);
    expect(b.asymptoticVerticalKPa).toBeGreaterThan(a.asymptoticVerticalKPa);
    await shot(page, 'low-k');
  });

  test('06 Smaller R → smaller p_v,∞ (cam #6)', async () => {
    const thick = await page.evaluate((b) => window.forge.silopressure.analyse({
      ...b, hydraulicRadiusM: 2, depthM: 100,
    }), BASE);
    const thin  = await page.evaluate((b) => window.forge.silopressure.analyse({
      ...b, hydraulicRadiusM: 0.5, depthM: 100,
    }), BASE);
    expect(thin.asymptoticVerticalKPa).toBeLessThan(thick.asymptoticVerticalKPa);
    expect(thin.asymptoticVerticalKPa).toBeCloseTo(thick.asymptoticVerticalKPa / 4, 4);
    await shot(page, 'thin-silo');
  });

  test('07 Panel renders p_v + p_w rows', async () => {
    await page.evaluate(() => { window.__forgeOpenSiloPressureWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-silopressure-run"]').click();
    await page.waitForSelector('[data-testid="forge-silopressure-result"]', { timeout: 5000 });
    const pv = await page.locator('[data-testid="forge-silopressure-pv"]').innerText();
    const pw = await page.locator('[data-testid="forge-silopressure-pw"]').innerText();
    expect(pv).toMatch(/p_v/);
    expect(pw).toMatch(/p_w/);
  });

  test('08 Menu route opens silo pressure panel', async () => {
    await page.evaluate(() => { window.__forgeCloseSiloPressureWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.silopressure' } }));
    });
    await page.waitForSelector('[data-testid="forge-silopressure-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
