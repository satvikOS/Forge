// v4-327-bundle.spec.js — Forge-327 5-calc bundle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-327-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.configure({ timeout: 240000 });
test.describe.serial('Forge-327 · 5-calc bundle', () => {
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
      m: !!window.forge?.mohrcoulomb, s: !!window.forge?.stair,
      sp: !!window.forge?.snowpv, n: !!window.forge?.nrc, a: !!window.forge?.adiabatic,
    }));
    expect(has.m).toBe(true); expect(has.s).toBe(true);
    expect(has.sp).toBe(true); expect(has.n).toBe(true); expect(has.a).toBe(true);
  });

  test('02 Mohr-Coulomb identity τ = c + σ·tan φ (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.mohrcoulomb.analyse({cohesionKpa:10, frictionAngleDeg:30, normalStressKpa:100}));
    expect(r.shearStrengthKpa).toBeCloseTo(10 + 100 * Math.tan(30 * Math.PI/180), 3);
    await shot(page, 'mc');
  });

  test('03 Stair: 3200 mm → 18 risers, 177.8 mm, IBC pass (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.stair.analyse({floorToFloorHeightMm:3200, maxRiserMm:178, minTreadMm:279}));
    expect(r.numberOfRisers).toBe(18);
    expect(r.numberOfTreads).toBe(17);
    expect(r.actualRiserMm).toBeCloseTo(3200/18, 3);
    expect(r.riserCompliant).toBe(true);
    expect(r.treadCompliant).toBe(true);
    expect(r.blondelCompliant).toBe(true);
    expect(r.overallCompliant).toBe(true);
    await shot(page, 'stair');
  });

  test('04 Snow PV: slope 25 → C_s=1; slope 50 → C_s=0.5 (cam #4)', async () => {
    const r25 = await page.evaluate(() => window.forge.snowpv.analyse({groundSnowKnM2:1.5, slopeAngleDeg:25, thermalC_t:1.0, exposureC_e:1.0, importanceI_s:1.0}));
    const r50 = await page.evaluate(() => window.forge.snowpv.analyse({groundSnowKnM2:1.5, slopeAngleDeg:50, thermalC_t:1.0, exposureC_e:1.0, importanceI_s:1.0}));
    expect(r25.slopeCoefficient_C_s).toBe(1.0);
    expect(r50.slopeCoefficient_C_s).toBeCloseTo(0.5, 5);
    expect(r25.flatRoofSnowKnM2).toBeCloseTo(0.7 * 1.5, 4);
    await shot(page, 'snowpv');
  });

  test('05 NRC rounds to 0.05 (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.nrc.analyse({alpha250:0.40, alpha500:0.65, alpha1000:0.80, alpha2000:0.75}));
    expect(r.nrcRaw).toBeCloseTo(0.65, 5);
    expect(r.nrcRounded).toBe(0.65);
    expect(r.meetsAbsorbentClass).toBe(true);
    await shot(page, 'nrc');
  });

  test('06 Adiabatic: T_2s = T_1·ratio^((k-1)/k) identity (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.adiabatic.analyse({inletTempC:20, inletPressureKpaAbs:100, dischargePressureKpaAbs:800, kRatio:1.4, isentropicEfficiency:0.80, molecularWeight:29}));
    const T1 = 293.15;
    const expected_T2s_K = T1 * Math.pow(8.0, 0.4/1.4);
    expect(r.isentropicDischargeTempC + 273.15).toBeCloseTo(expected_T2s_K, 1);
    expect(r.actualDischargeTempC).toBeGreaterThan(r.isentropicDischargeTempC);
    expect(r.pressureRatio).toBe(8.0);
    await shot(page, 'adiabatic');
  });

  test('07 5 panels open via menu (cam #7)', async () => {
    const ids = ['mohrcoulomb', 'stair', 'snowpv', 'nrc', 'adiabatic'];
    for (const id of ids) {
      await page.evaluate((i) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: `tools.${i}` } }));
      }, id);
      await page.waitForTimeout(300);
    }
    const panels = await page.evaluate(() => ({
      m:!!document.querySelector('[data-testid="forge-mc-panel"]'),
      s:!!document.querySelector('[data-testid="forge-stair-panel"]'),
      sp:!!document.querySelector('[data-testid="forge-spv-panel"]'),
      n:!!document.querySelector('[data-testid="forge-nrc-panel"]'),
      a:!!document.querySelector('[data-testid="forge-acmp-panel"]'),
    }));
    expect(panels.m).toBe(true); expect(panels.s).toBe(true);
    expect(panels.sp).toBe(true); expect(panels.n).toBe(true); expect(panels.a).toBe(true);
  });

  test('08 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
