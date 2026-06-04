// v4-325-bundle.spec.js — Forge-325 5-calc bundle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-325-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.configure({ timeout: 240000 });
test.describe.serial('Forge-325 · 5-calc bundle', () => {
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
      p: !!window.forge?.prv, e: !!window.forge?.expansiontank,
      pb: !!window.forge?.platebuck, a: !!window.forge?.ashrae62r, w: !!window.forge?.weldelectrode,
    }));
    expect(has.p).toBe(true); expect(has.e).toBe(true);
    expect(has.pb).toBe(true); expect(has.a).toBe(true); expect(has.w).toBe(true);
  });

  test('02 PRV gas: C(k=1.3)≈347, orifice selected (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.prv.analyse({mode:'gas', inletPressureKpaAbs:500, dischargeCoeffKd:0.975, massFlowKgPerH:1000, inletTempK:350, molecularWeight:18, kRatio:1.3, volumeFlowLpm:0, backPressureKpaAbs:0, specificGravity:0}));
    expect(r.gasCoefficientC).toBeGreaterThan(340);
    expect(r.gasCoefficientC).toBeLessThan(360);
    expect(r.requiredOrificeAreaMm2).toBeGreaterThan(0);
    expect(r.nextStandardOrifice).toMatch(/[A-Z]/);
    await shot(page, 'prv');
  });

  test('03 Expansion tank: water density decreases with T (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.expansiontank.analyse({systemVolumeLiters:1000, minTempC:4, maxTempC:25, minPressureBarAbs:1.5, maxPressureBarAbs:3.0}));
    expect(r.densityMinKgPerM3).toBeGreaterThan(r.densityMaxKgPerM3);
    expect(r.expansionFraction).toBeGreaterThan(0);
    expect(r.tankVolumeLiters).toBeGreaterThan(0);
    await shot(page, 'extank');
  });

  test('04 Plate buckling: nonslender at b/t=8, slender at b/t=24 (cam #4)', async () => {
    const r1 = await page.evaluate(() => window.forge.platebuck.analyse({elementType:'flange', widthMm:80, thicknessMm:10, Fy_MPa:345, E_MPa:200000}));
    const r2 = await page.evaluate(() => window.forge.platebuck.analyse({elementType:'flange', widthMm:240, thicknessMm:10, Fy_MPa:345, E_MPa:200000}));
    expect(r1.classification).toBe('nonslender');
    expect(r1.Qs).toBe(1.0);
    expect(r2.classification).toBe('slender');
    expect(r2.Qs).toBeLessThan(1.0);
    expect(r2.Qs).toBeGreaterThan(0);
    await shot(page, 'plate');
  });

  test('05 ASHRAE 62.2: 200m² 3br = 94.6 cfm req (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.ashrae62r.analyse({conditionedFloorAreaM2:200, bedroomCount:3, infiltrationCreditCfm:30}));
    expect(r.requiredVentilationCfm).toBeCloseTo(0.03*200*10.7639 + 7.5*4, 1);
    expect(r.netVentilationCfm).toBeCloseTo(r.requiredVentilationCfm - 30, 1);
    expect(r.netVentilationLps).toBeCloseTo(r.netVentilationCfm / 2.119, 2);
    await shot(page, 'a62r');
  });

  test('06 Weld fillet area = leg²/2 identity (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.weldelectrode.analyse({weldType:'fillet', sizeMm:6, weldLengthM:10, processEfficiency:0.65, electrodeCostPerKg:3.0, bevelAngleDeg:60, rootGapMm:2}));
    expect(r.weldAreaMm2).toBeCloseTo(36/2, 5);
    expect(r.depositMassKg).toBeCloseTo(18e-6 * 10 * 7850, 3);
    expect(r.electrodeMassKg).toBeCloseTo(r.depositMassKg / 0.65, 3);
    expect(r.electrodeCost).toBeCloseTo(r.electrodeMassKg * 3.0, 3);
    await shot(page, 'weld');
  });

  test('07 5 panels open via menu (cam #7)', async () => {
    const ids = ['prv', 'expansiontank', 'platebuck', 'ashrae62r', 'weldelectrode'];
    for (const id of ids) {
      await page.evaluate((i) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: `tools.${i}` } }));
      }, id);
      await page.waitForTimeout(300);
    }
    const panels = await page.evaluate(() => ({
      p:!!document.querySelector('[data-testid="forge-prv-panel"]'),
      e:!!document.querySelector('[data-testid="forge-ext-panel"]'),
      pb:!!document.querySelector('[data-testid="forge-pbl-panel"]'),
      a:!!document.querySelector('[data-testid="forge-a62r-panel"]'),
      w:!!document.querySelector('[data-testid="forge-we-panel"]'),
    }));
    expect(panels.p).toBe(true); expect(panels.e).toBe(true);
    expect(panels.pb).toBe(true); expect(panels.a).toBe(true); expect(panels.w).toBe(true);
  });

  test('08 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
