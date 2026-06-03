// v4-262-boilereff.spec.js — Forge-262 boiler efficiency.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-262-boilereff';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-262 · boiler efficiency', () => {
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
      !!(window.forge && window.forge.boilereff
         && typeof window.forge.boilereff.directMethod === 'function'
         && typeof window.forge.boilereff.indirectMethod === 'function'));
    expect(has).toBe(true);
  });

  test('02 Direct: Q_out=13.4 MW, η≈79.8% (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.boilereff.directMethod({
      steamFlowKgPerS: 5, feedwaterEnthalpyKjPerKg: 100,
      steamEnthalpyKjPerKg: 2780, fuelFlowKgPerS: 0.4,
      heatingValueKjPerKg: 42000,
    }));
    expect(r.heatOutputKw).toBeCloseTo(13400, 0);
    expect(r.heatInputKw).toBeCloseTo(16800, 0);
    expect(r.efficiencyPct).toBeCloseTo(79.76, 1);
    await shot(page, 'direct');
  });

  test('03 Indirect: L₁=6.46%, total=11.4%, η≈88.6% (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.boilereff.indirectMethod({
      dryFlueGasKgPerKgFuel: 12, moistureKgPerKgFuel: 0.45,
      flueGasTempC: 250, ambientTempC: 25,
      heatingValueKjPerKg: 42000, dryFlueGasCpKjPerKgK: 1.005,
      radiationLossPct: 2.0,
    }));
    expect(r.dryFlueGasLossPct).toBeCloseTo(6.46, 1);
    expect(r.waterVapourLossPct).toBeCloseTo(2.92, 1);
    expect(r.totalLossesPct).toBeCloseTo(11.38, 1);
    expect(r.efficiencyPct).toBeCloseTo(88.62, 1);
    await shot(page, 'indirect');
  });

  test('04 Higher T_flue → larger dry flue gas loss (cam #3)', async () => {
    const cool = await page.evaluate(() => window.forge.boilereff.indirectMethod({
      dryFlueGasKgPerKgFuel: 12, moistureKgPerKgFuel: 0.45,
      flueGasTempC: 150, ambientTempC: 25,
      heatingValueKjPerKg: 42000, dryFlueGasCpKjPerKgK: 1.005,
      radiationLossPct: 2.0,
    }));
    const hot = await page.evaluate(() => window.forge.boilereff.indirectMethod({
      dryFlueGasKgPerKgFuel: 12, moistureKgPerKgFuel: 0.45,
      flueGasTempC: 350, ambientTempC: 25,
      heatingValueKjPerKg: 42000, dryFlueGasCpKjPerKgK: 1.005,
      radiationLossPct: 2.0,
    }));
    expect(hot.dryFlueGasLossPct).toBeGreaterThan(cool.dryFlueGasLossPct);
    expect(hot.efficiencyPct).toBeLessThan(cool.efficiencyPct);
    await shot(page, 'T-flue');
  });

  test('05 doubling fuel flow at fixed steam halves direct η (cam #4)', async () => {
    const base = await page.evaluate(() => window.forge.boilereff.directMethod({
      steamFlowKgPerS: 5, feedwaterEnthalpyKjPerKg: 100,
      steamEnthalpyKjPerKg: 2780, fuelFlowKgPerS: 0.4,
      heatingValueKjPerKg: 42000,
    }));
    const doubled = await page.evaluate(() => window.forge.boilereff.directMethod({
      steamFlowKgPerS: 5, feedwaterEnthalpyKjPerKg: 100,
      steamEnthalpyKjPerKg: 2780, fuelFlowKgPerS: 0.8,
      heatingValueKjPerKg: 42000,
    }));
    expect(doubled.efficiencyPct).toBeCloseTo(base.efficiencyPct / 2, 1);
    await shot(page, 'fuel-double');
  });

  test('06 zero steam flow throws (cam #5)', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.boilereff.directMethod({
        steamFlowKgPerS: 0, feedwaterEnthalpyKjPerKg: 100,
        steamEnthalpyKjPerKg: 2780, fuelFlowKgPerS: 0.4,
        heatingValueKjPerKg: 42000,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'zero-steam');
  });

  test('07 indirect with negative HV throws', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.boilereff.indirectMethod({
        dryFlueGasKgPerKgFuel: 12, moistureKgPerKgFuel: 0.45,
        flueGasTempC: 250, ambientTempC: 25,
        heatingValueKjPerKg: -1000, dryFlueGasCpKjPerKgK: 1.005,
        radiationLossPct: 2.0,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel tab-switch renders η in both modes', async () => {
    await page.evaluate(() => { window.__forgeOpenBoilerEffWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-boilereff-run"]').click();
    await page.waitForSelector('[data-testid="forge-boilereff-eta"]', { timeout: 5000 });
    await page.locator('[data-testid="forge-boilereff-tab-indirect"]').click();
    await page.locator('[data-testid="forge-boilereff-run"]').click();
    const eta = await page.locator('[data-testid="forge-boilereff-eta"]').innerText();
    expect(eta).toMatch(/η_indirect/);
  });

  test('09 menu route fires boilereff workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseBoilerEffWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.boilereff' } }));
    });
    await page.waitForSelector('[data-testid="forge-boilereff-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
