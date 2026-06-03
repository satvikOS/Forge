// v4-256-hydro.spec.js — Forge-256 hydrology rational + Kirpich + IDF.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-256-hydro';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-256 · hydrology', () => {
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

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.hydrology
         && typeof window.forge.hydrology.rationalDischarge === 'function'
         && typeof window.forge.hydrology.kirpichTimeOfConcentrationMin === 'function'
         && typeof window.forge.hydrology.idfIntensityMmHr === 'function'));
    expect(has).toBe(true);
  });

  test('02 rational method textbook fixture (cam #1)', async () => {
    const Q = await page.evaluate(() => window.forge.hydrology.rationalDischarge({
      runoffCoefficient: 0.6, rainfallIntensityMmHr: 50, drainageAreaM2: 100000,
    }));
    // Q = 0.6 · (50/3.6e6) · 100000 = 0.8333 m³/s
    expect(Q).toBeCloseTo(0.8333, 3);
    await shot(page, 'rational');
  });

  test('03 alternate form Q = 0.278·C·i·A_km² matches (cam #2)', async () => {
    const Q = await page.evaluate(() => window.forge.hydrology.rationalDischarge({
      runoffCoefficient: 0.6, rainfallIntensityMmHr: 50, drainageAreaM2: 100000,
    }));
    const alt = 0.278 * 0.6 * 50 * 0.1;  // A in km² = 0.1
    // 0.278·C·i·A_km² = 0.834 m³/s (close to Q).
    expect(Math.abs(Q - alt) / Q).toBeLessThan(0.005);
    await shot(page, 'alt-form');
  });

  test('04 Kirpich T_c (cam #3)', async () => {
    const tc = await page.evaluate(() => window.forge.hydrology.kirpichTimeOfConcentrationMin(1000, 0.01));
    expect(tc).toBeCloseTo(23.44, 1);
    // T_c increases with L:
    const tcLong = await page.evaluate(() => window.forge.hydrology.kirpichTimeOfConcentrationMin(2000, 0.01));
    expect(tcLong).toBeGreaterThan(tc);
    // T_c decreases with steeper slope:
    const tcSteep = await page.evaluate(() => window.forge.hydrology.kirpichTimeOfConcentrationMin(1000, 0.05));
    expect(tcSteep).toBeLessThan(tc);
    await shot(page, 'Tc');
  });

  test('05 IDF intensity (cam #4)', async () => {
    const i = await page.evaluate(() => window.forge.hydrology.idfIntensityMmHr({
      a: 800, b: 10, c: 0.85, durationMin: 30,
    }));
    // i = 800/(40)^0.85 ≈ 34.78 mm/hr
    expect(i).toBeCloseTo(34.78, 1);
    // Longer duration → lower intensity:
    const i60 = await page.evaluate(() => window.forge.hydrology.idfIntensityMmHr({
      a: 800, b: 10, c: 0.85, durationMin: 60,
    }));
    expect(i60).toBeLessThan(i);
    await shot(page, 'IDF');
  });

  test('06 chained rational design flow (cam #5)', async () => {
    const tc = await page.evaluate(() =>
      window.forge.hydrology.kirpichTimeOfConcentrationMin(1000, 0.01));
    const i = await page.evaluate((t) => window.forge.hydrology.idfIntensityMmHr({
      a: 800, b: 10, c: 0.85, durationMin: t,
    }), tc);
    const Q = await page.evaluate((iv) => window.forge.hydrology.rationalDischarge({
      runoffCoefficient: 0.6, rainfallIntensityMmHr: iv, drainageAreaM2: 100000,
    }), i);
    expect(tc).toBeCloseTo(23.44, 1);
    expect(i).toBeCloseTo(40.5, 0);    // i at T_c = 23.4 min
    expect(Q).toBeCloseTo(0.675, 1);   // 0.6 · 40.5/3.6e6 · 100000 ≈ 0.675 m³/s
    await shot(page, 'chain');
  });

  test('07 invalid inputs throw', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.hydrology.kirpichTimeOfConcentrationMin(0, 0.01));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel renders T_c, i, Q rows', async () => {
    await page.evaluate(() => { window.__forgeOpenHydroWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-hydro-run"]').click();
    await page.waitForSelector('[data-testid="forge-hydro-result"]', { timeout: 5000 });
    const tc = await page.locator('[data-testid="forge-hydro-Tc"]').innerText();
    const i  = await page.locator('[data-testid="forge-hydro-i"]').innerText();
    const Q  = await page.locator('[data-testid="forge-hydro-Q"]').innerText();
    expect(tc).toMatch(/T_c/);
    expect(i).toMatch(/mm\/hr/);
    expect(Q).toMatch(/m³\/s/);
  });

  test('09 menu route fires hydro workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseHydroWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.hydro' } }));
    });
    await page.waitForSelector('[data-testid="forge-hydro-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
