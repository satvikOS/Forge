// v4-320-bundle.spec.js — Forge-320 5-calc bundle:
// rebar dev + ChW pump + diesel genset + RO + envelope U-value.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-320-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.configure({ timeout: 240000 });
test.describe.serial('Forge-320 · 5-calc bundle', () => {
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

  test('01 all 5 kernel bridges wired (cam #1)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() => ({
      rebardev: !!(window.forge && window.forge.rebardev),
      chwpump: !!(window.forge && window.forge.chwpump),
      genset: !!(window.forge && window.forge.genset),
      ro: !!(window.forge && window.forge.reverseosmosis),
      envelope: !!(window.forge && window.forge.envelope),
    }));
    expect(has.rebardev).toBe(true);
    expect(has.chwpump).toBe(true);
    expect(has.genset).toBe(true);
    expect(has.ro).toBe(true);
    expect(has.envelope).toBe(true);
  });

  test('02 Rebar dev #6 bar: ℓ_d ≈ 439 mm (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.rebardev.analyse({
      barDiameter_db_mm: 19, fc_MPa: 28, fy_MPa: 420,
      psi_t: 1.0, psi_e: 1.0, psi_s: 0.8, lambda: 1.0,
      clearCover_cb_mm: 50, Ktr_mm: 0,
    }));
    expect(r.cbKtrOverDb).toBe(2.5);
    expect(r.developmentLengthMm).toBeGreaterThan(435);
    expect(r.developmentLengthMm).toBeLessThan(445);
    await shot(page, 'rebar');
  });

  test('03 Min 300 mm governs for short bar (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.rebardev.analyse({
      barDiameter_db_mm: 10, fc_MPa: 28, fy_MPa: 420,
      psi_t: 1.0, psi_e: 1.0, psi_s: 0.8, lambda: 1.0,
      clearCover_cb_mm: 50, Ktr_mm: 0,
    }));
    expect(r.developmentLengthMm).toBe(300);
    expect(r.minimumGoverned).toBe(true);
  });

  test('04 ChW pump: ṁ=Q/(cp·ΔT) identity (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.chwpump.analyse({
      coolingLoadKw: 1000, designDeltaTKelvin: 6, pumpHeadM: 30,
      pumpEfficiency: 0.75, motorEfficiency: 0.93,
    }));
    expect(r.massFlowKgPerS).toBeCloseTo(1000 / (4.186 * 6), 3);
    expect(r.electricalPowerW).toBeCloseTo(r.pumpShaftPowerW / 0.93, 1);
    expect(r.overallEfficiency).toBeCloseTo(0.75 * 0.93, 5);
    await shot(page, 'chw');
  });

  test('05 Genset altitude derate (cam #5)', async () => {
    const sea = await page.evaluate(() => window.forge.genset.analyse({
      connectedLoadKw: 500, diversityFactor: 0.8, powerFactor: 0.85,
      altitudeM: 0, ambientTempC: 25,
      fuelConsumptionLPerKwh: 0.27, designRuntimeHr: 8,
    }));
    const high = await page.evaluate(() => window.forge.genset.analyse({
      connectedLoadKw: 500, diversityFactor: 0.8, powerFactor: 0.85,
      altitudeM: 2000, ambientTempC: 45,
      fuelConsumptionLPerKwh: 0.27, designRuntimeHr: 8,
    }));
    expect(sea.altitudeDerateFactor).toBe(1.0);
    expect(high.altitudeDerateFactor).toBeCloseTo(0.9, 4);
    expect(high.temperatureDerateFactor).toBeCloseTo(0.99, 4);
    expect(high.requiredKvaNameplate).toBeGreaterThan(sea.requiredKvaNameplate);
    await shot(page, 'genset');
  });

  test('06 RO: CF = 1/(1−R), brine = CF·feed (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.reverseosmosis.analyse({
      feedFlowLpm: 100, recoveryFraction: 0.5, feedTdsPpm: 2000,
      appliedPressureBar: 15, temperatureC: 25, vantHoffFactorI: 2,
    }));
    expect(r.concentrationFactor).toBe(2);
    expect(r.brineTdsPpm).toBe(4000);
    expect(r.permeateFlowLpm).toBe(50);
    expect(r.pressureSufficient).toBe(true);
    await shot(page, 'RO');
  });

  test('07 Envelope U = 1/(ΣR + R_si + R_so) (cam #7)', async () => {
    const r = await page.evaluate(() => window.forge.envelope.analyse({
      layers: [
        { thicknessMm: 200, conductivityWmk: 1.7 },
        { thicknessMm: 100, conductivityWmk: 0.025 },
        { thicknessMm: 12, conductivityWmk: 0.17 },
      ],
      interiorFilmRSI: 0.13, exteriorFilmRSI: 0.04,
      areaM2: 100, designDeltaTKelvin: 25,
    }));
    expect(r.layerSumRSI).toBeCloseTo(0.2/1.7 + 0.1/0.025 + 0.012/0.17, 4);
    expect(r.totalRSI).toBeCloseTo(r.layerSumRSI + 0.13 + 0.04, 4);
    expect(r.uValueWm2K).toBeCloseTo(1 / r.totalRSI, 5);
    expect(r.heatFlowW).toBeCloseTo(r.uValueWm2K * 100 * 25, 1);
    await shot(page, 'uvalue');
  });

  test('08 All 5 panels open via menu route (cam #8)', async () => {
    const ids = ['rebardev', 'chwpump', 'genset', 'reverseosmosis', 'envelope'];
    for (const id of ids) {
      await page.evaluate((i) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action',
          { detail: { id: `tools.${i}` } }));
      }, id);
      await page.waitForTimeout(300);
    }
    const panels = await page.evaluate(() => ({
      rd: !!document.querySelector('[data-testid="forge-rd-panel"]'),
      ch: !!document.querySelector('[data-testid="forge-chw-panel"]'),
      gs: !!document.querySelector('[data-testid="forge-gs-panel"]'),
      ro: !!document.querySelector('[data-testid="forge-ro-panel"]'),
      uv: !!document.querySelector('[data-testid="forge-uv-panel"]'),
    }));
    expect(panels.rd).toBe(true);
    expect(panels.ch).toBe(true);
    expect(panels.gs).toBe(true);
    expect(panels.ro).toBe(true);
    expect(panels.uv).toBe(true);
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
