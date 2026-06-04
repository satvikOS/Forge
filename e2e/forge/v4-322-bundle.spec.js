// v4-322-bundle.spec.js — Forge-322 5-calc bundle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-322-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.configure({ timeout: 240000 });
test.describe.serial('Forge-322 · 5-calc bundle', () => {
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

  test('01 5 kernel bridges (cam #1)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() => ({
      m: !!window.forge?.masonry, a: !!window.forge?.asphalt,
      c: !!window.forge?.cathodic, h: !!window.forge?.heattrace, l: !!window.forge?.lightning,
    }));
    expect(has.m).toBe(true); expect(has.a).toBe(true);
    expect(has.c).toBe(true); expect(has.h).toBe(true); expect(has.l).toBe(true);
  });

  test('02 Masonry M_n + φM_n positive (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.masonry.analyse({
      wallWidthB_mm:1000, effectiveDepth_d_mm:100, steelAreaAs_mm2:200,
      factoredAxialPu_kN:50, fm_MPa:14, fy_MPa:420,
    }));
    expect(r.Ase_mm2).toBeGreaterThan(200);
    expect(r.aMm).toBeGreaterThan(0);
    expect(r.designMoment_kNm).toBeCloseTo(0.9 * r.nominalMoment_kNm, 5);
    await shot(page, 'masonry');
  });

  test('03 Asphalt: G_mm > G_mb, V_a identity (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.asphalt.analyse({
      aggregateSG:2.65, asphaltSG:1.02, asphaltContentPct:5, bulkSG_Gmb:2.40,
    }));
    expect(r.theoreticalMaxSG).toBeGreaterThan(2.40);
    expect(r.airVoidsPct).toBeCloseTo((r.theoreticalMaxSG - 2.40) / r.theoreticalMaxSG * 100, 4);
    await shot(page, 'asphalt');
  });

  test('04 CP: I = i·A, m linear in life (cam #4)', async () => {
    const r10 = await page.evaluate(() => window.forge.cathodic.analyse({
      protectedAreaM2:500, currentDensityMaPerM2:50, designLifeYears:10,
      anodeConsumptionKgPerAmpYr:11.9, anodeUtilizationFactor:0.85,
    }));
    const r20 = await page.evaluate(() => window.forge.cathodic.analyse({
      protectedAreaM2:500, currentDensityMaPerM2:50, designLifeYears:20,
      anodeConsumptionKgPerAmpYr:11.9, anodeUtilizationFactor:0.85,
    }));
    expect(r10.totalCurrentRequiredA).toBe(25);
    expect(r20.anodeMassRequiredKg).toBeCloseTo(2 * r10.anodeMassRequiredKg, 1);
    await shot(page, 'cathodic');
  });

  test('05 Heat trace: cable = q·SF (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.heattrace.analyse({
      pipeOuterDiameterMm:100, insulationThicknessMm:50, insulationConductivityWmk:0.04,
      outdoorFilmCoefficientWm2K:25, pipeTargetTempC:5, ambientTempC:-20, safetyFactor:1.25,
    }));
    expect(r.insulationOD_mm).toBe(200);
    expect(r.recommendedCableWperM).toBeCloseTo(r.heatLossWPerM * 1.25, 5);
    await shot(page, 'heattrace');
  });

  test('06 Lightning rolling sphere identity r = √(h(2R−h)) (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.lightning.analyse({
      rollingSphereRadiusM:30, mastHeightM:10, protectedObjectHeightM:0,
    }));
    expect(r.groundProtectedRadiusM).toBeCloseTo(Math.sqrt(10 * (60 - 10)), 4);
    await shot(page, 'lightning');
  });

  test('07 All 5 panels open via menu (cam #7)', async () => {
    const ids = ['masonry', 'asphalt', 'cathodic', 'heattrace', 'lightning'];
    for (const id of ids) {
      await page.evaluate((i) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: `tools.${i}` } }));
      }, id);
      await page.waitForTimeout(300);
    }
    const panels = await page.evaluate(() => ({
      m:!!document.querySelector('[data-testid="forge-mw-panel"]'),
      a:!!document.querySelector('[data-testid="forge-as-panel"]'),
      c:!!document.querySelector('[data-testid="forge-cp-panel"]'),
      h:!!document.querySelector('[data-testid="forge-ht-panel"]'),
      l:!!document.querySelector('[data-testid="forge-lp-panel"]'),
    }));
    expect(panels.m).toBe(true); expect(panels.a).toBe(true);
    expect(panels.c).toBe(true); expect(panels.h).toBe(true); expect(panels.l).toBe(true);
  });

  test('08 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
