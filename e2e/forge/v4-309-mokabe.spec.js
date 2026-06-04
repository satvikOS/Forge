// v4-309-mokabe.spec.js — Forge-309 Mononobe-Okabe seismic earth pressure.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-309-mokabe';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  soilFrictionAngleDeg: 30, wallFrictionAngleDeg: 20,
  backfillSlopeDeg: 0, wallTiltDeg: 0,
  horizontalSeismicCoeff: 0.2, verticalSeismicCoeff: 0,
  soilUnitWeightKnPerM3: 18, wallHeightM: 6,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-309 · Mononobe-Okabe', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
      timeout: 150000,
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => {
    if (!app) return;
    try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]); }
    catch (e) { /* ignore */ }
    try { app.process()?.kill('SIGKILL'); } catch (e) { /* ignore */ }
  });

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.mokabe
         && typeof window.forge.mokabe.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 φ=30, δ=20, k_h=0.2: θ=11.31°, K_a=0.30, K_AE>K_a (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.mokabe.analyse(b), STD);
    expect(r.seismicInertiaAngleDeg).toBeCloseTo(Math.atan(0.2) * 180 / Math.PI, 4);
    expect(r.staticKa).toBeGreaterThan(0.29);
    expect(r.staticKa).toBeLessThan(0.30);
    expect(r.seismicKae).toBeGreaterThan(r.staticKa);
    expect(r.totalSeismicForceKnPerM).toBeGreaterThan(r.staticForceKnPerM);
    await shot(page, 'standard');
  });

  test('03 k_h=0 collapses K_AE=K_a, ΔP=0, y_bar=H/3 (cam #3)', async () => {
    const r = await page.evaluate((b) => window.forge.mokabe.analyse({
      ...b, horizontalSeismicCoeff: 0,
    }), STD);
    expect(r.seismicKae).toBeCloseTo(r.staticKa, 6);
    expect(r.seismicIncrementKnPerM).toBeCloseTo(0, 6);
    expect(r.pointOfApplicationFromBaseM).toBeCloseTo(6 / 3, 4);
    await shot(page, 'static-limit');
  });

  test('04 k_v reduces P_AE by ~(1−k_v) (cam #4)', async () => {
    const r0 = await page.evaluate((b) => window.forge.mokabe.analyse(b), STD);
    const rkv = await page.evaluate((b) => window.forge.mokabe.analyse({
      ...b, verticalSeismicCoeff: 0.1,
    }), STD);
    expect(rkv.totalSeismicForceKnPerM).toBeLessThan(r0.totalSeismicForceKnPerM);
    expect(rkv.totalSeismicForceKnPerM / r0.totalSeismicForceKnPerM).toBeGreaterThan(0.85);
    expect(rkv.totalSeismicForceKnPerM / r0.totalSeismicForceKnPerM).toBeLessThan(0.99);
    await shot(page, 'kv');
  });

  test('05 Higher k_h gives larger increment (cam #5)', async () => {
    const r1 = await page.evaluate((b) => window.forge.mokabe.analyse(b), STD);
    const r2 = await page.evaluate((b) => window.forge.mokabe.analyse({
      ...b, horizontalSeismicCoeff: 0.35,
    }), STD);
    expect(r2.seismicKae).toBeGreaterThan(r1.seismicKae);
    expect(r2.seismicIncrementKnPerM).toBeGreaterThan(r1.seismicIncrementKnPerM);
    await shot(page, 'high-kh');
  });

  test('06 y_bar > H/3 when seismic (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.mokabe.analyse(b), STD);
    expect(r.pointOfApplicationFromBaseM).toBeGreaterThan(6 / 3);
    expect(r.pointOfApplicationFromBaseM).toBeLessThan(0.6 * 6);
    await shot(page, 'point-app');
  });

  test('07 Panel renders P_AE + ΔP + y_bar rows', async () => {
    await page.evaluate(() => { window.__forgeOpenMononobeOkabeWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-mo-run"]').click();
    await page.waitForSelector('[data-testid="forge-mo-result"]', { timeout: 5000 });
    const PAE = await page.locator('[data-testid="forge-mo-PAE"]').innerText();
    const dP  = await page.locator('[data-testid="forge-mo-dP"]').innerText();
    const yb  = await page.locator('[data-testid="forge-mo-ybar"]').innerText();
    expect(PAE).toMatch(/P_AE/);
    expect(dP).toMatch(/ΔP_dyn/);
    expect(yb).toMatch(/y_bar/);
  });

  test('08 Menu route opens M-O panel', async () => {
    await page.evaluate(() => { window.__forgeCloseMononobeOkabeWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.mokabe' } }));
    });
    await page.waitForSelector('[data-testid="forge-mo-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
