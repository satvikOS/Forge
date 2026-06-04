// v4-321-bundle.spec.js — Forge-321 5-calc bundle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-321-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.configure({ timeout: 240000 });
test.describe.serial('Forge-321 · 5-calc bundle', () => {
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

  test('01 all 5 bridges wired (cam #1)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() => ({
      v: !!(window.forge && window.forge.ventilation),
      f: !!(window.forge && window.forge.firepump),
      s: !!(window.forge && window.forge.septic),
      c: !!(window.forge && window.forge.cyclone),
      st: !!(window.forge && window.forge.stackeffect),
    }));
    expect(has.v).toBe(true); expect(has.f).toBe(true);
    expect(has.s).toBe(true); expect(has.c).toBe(true); expect(has.st).toBe(true);
  });

  test('02 ASHRAE 62.1 office: V_bz=55 L/s, 116.5 cfm (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.ventilation.analyse({
      occupantsP:10, zoneAreaM2:100, R_p_LpsPerPerson:2.5, R_a_LpsPerM2:0.3, zoneAirDistEffectivenessE_z:1.0,
    }));
    expect(r.breathingZoneFlowLps).toBe(55);
    expect(r.outdoorAirFlowCfm).toBeCloseTo(55 * 2.119, 2);
    expect(r.perPersonOAcfm).toBeCloseTo(11.65, 1);
    await shot(page, 'vent');
  });

  test('03 NFPA 20 fire pump: Q=2000 L/min, P=5.4 bar, 150% rule (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.firepump.analyse({
      sprinklerDemandLpm:1500, hoseAllowanceLpm:500, staticHeadM:30, frictionLossM:20, residualPressureBar:0.5,
    }));
    expect(r.ratedFlowLpm).toBe(2000);
    expect(r.pump150PercentFlowLpm).toBe(3000);
    expect(r.pump150PercentMinPressureBar / r.ratedPressureBar).toBeCloseTo(0.65, 5);
    await shot(page, 'firepump');
  });

  test('04 Septic 4-occupant: V=3.12 m³ (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.septic.analyse({
      occupants:4, dailyFlowPerPersonL:600, retentionDays:1, sludgeReserveFraction:0.3,
    }));
    expect(r.dailyInflowL).toBe(2400);
    expect(r.totalVolumeL).toBe(3120);
    expect(r.totalVolumeM3).toBeCloseTo(3.12, 5);
    await shot(page, 'septic');
  });

  test('05 Lapple cyclone: d_50≈4.5 µm (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.cyclone.analyse({
      inletVelocityMs:15, inletWidthM:0.15, numberOfTurns:5,
      gasViscosityPaS:1.8e-5, particleDensityKgPerM3:2500, gasDensityKgPerM3:1.2,
    }));
    expect(r.cutDiameterUm).toBeGreaterThan(4.0);
    expect(r.cutDiameterUm).toBeLessThan(5.0);
    await shot(page, 'cyclone');
  });

  test('06 Stack effect (H=20, T_i=20, T_o=0): ΔP≈17.3 Pa upward (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.stackeffect.analyse({
      stackHeightM:20, indoorTempC:20, outdoorTempC:0, atmPressureKPa:101.325,
    }));
    expect(r.indoorDensityKgPerM3).toBeLessThan(r.outdoorDensityKgPerM3);
    expect(r.stackPressurePa).toBeGreaterThan(15);
    expect(r.stackPressurePa).toBeLessThan(20);
    expect(r.airflowDirection).toBe(1);
    await shot(page, 'stack');
  });

  test('07 Stack reverses when T_o > T_i (cam #7)', async () => {
    const r = await page.evaluate(() => window.forge.stackeffect.analyse({
      stackHeightM:20, indoorTempC:0, outdoorTempC:25, atmPressureKPa:101.325,
    }));
    expect(r.stackPressurePa).toBeLessThan(0);
    expect(r.airflowDirection).toBe(-1);
  });

  test('08 All 5 panels open via menu route (cam #8)', async () => {
    const ids = ['ventilation', 'firepump', 'septic', 'cyclone', 'stackeffect'];
    for (const id of ids) {
      await page.evaluate((i) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action',
          { detail: { id: `tools.${i}` } }));
      }, id);
      await page.waitForTimeout(300);
    }
    const panels = await page.evaluate(() => ({
      vt:!!document.querySelector('[data-testid="forge-vt-panel"]'),
      fp:!!document.querySelector('[data-testid="forge-fp-panel"]'),
      st:!!document.querySelector('[data-testid="forge-st-panel"]'),
      cy:!!document.querySelector('[data-testid="forge-cy-panel"]'),
      se:!!document.querySelector('[data-testid="forge-se-panel"]'),
    }));
    expect(panels.vt).toBe(true);
    expect(panels.fp).toBe(true);
    expect(panels.st).toBe(true);
    expect(panels.cy).toBe(true);
    expect(panels.se).toBe(true);
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
