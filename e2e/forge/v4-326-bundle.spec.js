// v4-326-bundle.spec.js — Forge-326 5-calc bundle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-326-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.configure({ timeout: 240000 });
test.describe.serial('Forge-326 · 5-calc bundle', () => {
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

  test('01 5 bridges (cam #1)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() => ({
      c: !!window.forge?.cover, m: !!window.forge?.mse,
      h: !!window.forge?.hunter, s: !!window.forge?.solarcollector, ch: !!window.forge?.chimney,
    }));
    expect(has.c).toBe(true); expect(has.m).toBe(true);
    expect(has.h).toBe(true); expect(has.s).toBe(true); expect(has.ch).toBe(true);
  });

  test('02 Cover earth-direct = 75 mm (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.cover.analyse({exposureCondition:'earth-direct', barSize:'large'}));
    expect(r.minimumCoverMm).toBe(75);
    expect(r.exteriorFireRated).toBe(true);
    await shot(page, 'cover');
  });

  test('03 MSE L = max(0.7H, 2.4) auto-pick (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.mse.analyse({wallHeightH_m:6, soilFrictionAngleDeg:34, foundationFrictionAngleDeg:30, soilUnitWeightKnM3:19, reinforcementLengthM:0, surchargeKnM2:10}));
    expect(r.effectiveReinforcementLengthM).toBeCloseTo(0.7 * 6, 4);
    expect(r.K_active).toBeGreaterThan(0.27);
    expect(r.K_active).toBeLessThan(0.30);
    expect(r.slidingFOS).toBeGreaterThan(1.5);
    await shot(page, 'mse');
  });

  test('04 Hunter power-law transition at FU=500 (cam #4)', async () => {
    const r1 = await page.evaluate(() => window.forge.hunter.analyse({totalFixtureUnits:50, flushValveMix:false}));
    const r2 = await page.evaluate(() => window.forge.hunter.analyse({totalFixtureUnits:1000, flushValveMix:false}));
    expect(r1.designFlowGpm).toBeGreaterThan(0);
    expect(r2.designFlowGpm).toBeGreaterThan(r1.designFlowGpm);
    expect(r1.designFlowLps).toBeCloseTo(r1.designFlowGpm * 0.06309, 3);
    await shot(page, 'hunter');
  });

  test('05 Solar η = q_u/(A·G_T) identity (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.solarcollector.analyse({collectorAreaM2:5, opticalEfficiency_F_R_tau_alpha:0.75, overallLossCoeff_U_L:4.5, F_R:0.85, globalIrradianceWm2:800, inletTempC:40, ambientTempC:20}));
    expect(r.instantaneousEfficiency).toBeCloseTo(r.usefulHeatGainW / (5 * 800), 5);
    expect(r.reducedTemperature).toBeCloseTo((40-20)/800, 5);
    await shot(page, 'solar');
  });

  test('06 Chimney net = avail − friction (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.chimney.analyse({stackHeightM:15, flueDiameterM:0.3, flueGasTempC:200, ambientTempC:20, flueMassFlowKgPerS:0.5, atmPressureKPa:101.325}));
    expect(r.rhoAmbient).toBeGreaterThan(r.rhoFlue);
    expect(r.availableDraftPa).toBeGreaterThan(0);
    expect(r.netDraftPa).toBeCloseTo(r.availableDraftPa - r.frictionLossPa, 3);
    await shot(page, 'chimney');
  });

  test('07 5 panels open via menu (cam #7)', async () => {
    const ids = ['cover', 'mse', 'hunter', 'solarcollector', 'chimney'];
    for (const id of ids) {
      await page.evaluate((i) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: `tools.${i}` } }));
      }, id);
      await page.waitForTimeout(300);
    }
    const panels = await page.evaluate(() => ({
      c:!!document.querySelector('[data-testid="forge-cov-panel"]'),
      m:!!document.querySelector('[data-testid="forge-mse-panel"]'),
      h:!!document.querySelector('[data-testid="forge-hnt-panel"]'),
      s:!!document.querySelector('[data-testid="forge-sol-panel"]'),
      ch:!!document.querySelector('[data-testid="forge-chm-panel"]'),
    }));
    expect(panels.c).toBe(true); expect(panels.m).toBe(true);
    expect(panels.h).toBe(true); expect(panels.s).toBe(true); expect(panels.ch).toBe(true);
  });

  test('08 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
