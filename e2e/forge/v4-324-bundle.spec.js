// v4-324-bundle.spec.js — Forge-324 5-calc bundle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-324-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.configure({ timeout: 240000 });
test.describe.serial('Forge-324 · 5-calc bundle', () => {
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
      i: !!window.forge?.iplv, s: !!window.forge?.snowdrift,
      sl: !!window.forge?.slaboneway, c: !!window.forge?.cranerunway, m: !!window.forge?.cmucomp,
    }));
    expect(has.i).toBe(true); expect(has.s).toBe(true);
    expect(has.sl).toBe(true); expect(has.c).toBe(true); expect(has.m).toBe(true);
  });

  test('02 IPLV weighted sum identity (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.iplv.analyse({cop100:5.5, cop75:6.5, cop50:7.5, cop25:5.0}));
    expect(r.iplv).toBeCloseTo(0.01*5.5 + 0.42*6.5 + 0.45*7.5 + 0.12*5.0, 5);
    expect(r.iplv_kWperTon).toBeCloseTo(12 / (3.412 * r.iplv), 4);
    await shot(page, 'iplv');
  });

  test('03 Snow drift clamps at 0 for low p_g (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.snowdrift.analyse({groundSnowLoad_kNm2:2.0, upwindFetchLength_m:30, leewardDrift:true}));
    expect(r.driftHeight_m).toBeGreaterThanOrEqual(0);
    expect(r.driftPressure_kNm2).toBeGreaterThanOrEqual(0);
    await shot(page, 'snow');
  });

  test('04 Slab t_min = L/divisor by support (cam #4)', async () => {
    const r1 = await page.evaluate(() => window.forge.slaboneway.analyse({spanLength_m:6, slabThickness_mm:200, effectiveDepth_d_mm:170, areaSteelMm2PerM:600, fc_MPa:28, fy_MPa:420, supportCondition:'simple'}));
    const r2 = await page.evaluate(() => window.forge.slaboneway.analyse({spanLength_m:6, slabThickness_mm:200, effectiveDepth_d_mm:170, areaSteelMm2PerM:600, fc_MPa:28, fy_MPa:420, supportCondition:'both-cont'}));
    expect(r1.minimumThicknessMm).toBeCloseTo(6000/20, 4);
    expect(r2.minimumThicknessMm).toBeCloseTo(6000/28, 4);
    await shot(page, 'slab');
  });

  test('05 Crane runway P+impact = 1.25·P (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.cranerunway.analyse({maxWheelLoadKn:200, spanLengthM:8, impactFactor:0.25, lateralFraction:0.20}));
    expect(r.wheelLoadWithImpactKn).toBeCloseTo(250, 5);
    expect(r.verticalMomentKnm).toBeCloseTo(500, 4);
    expect(r.combinedDesignMomentKnm).toBeCloseTo(580, 4);
    await shot(page, 'crane');
  });

  test('06 CMU h/r=54.6 short, P_n ≈ 515 kN (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.cmucomp.analyse({netAreaMm2:55000, radiusOfGyrationMm:55, effectiveHeightMm:3000, fm_MPa:13.8}));
    expect(r.slendernessRatio_h_r).toBeCloseTo(3000/55, 3);
    expect(r.slenderRegime).toBe(false);
    expect(r.nominalCapacityKn).toBeGreaterThan(500);
    expect(r.nominalCapacityKn).toBeLessThan(525);
    expect(r.designCapacityKn).toBeCloseTo(0.60 * r.nominalCapacityKn, 4);
    await shot(page, 'cmu');
  });

  test('07 5 panels open via menu (cam #7)', async () => {
    const ids = ['iplv', 'snowdrift', 'slaboneway', 'cranerunway', 'cmucomp'];
    for (const id of ids) {
      await page.evaluate((i) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: `tools.${i}` } }));
      }, id);
      await page.waitForTimeout(300);
    }
    const panels = await page.evaluate(() => ({
      i:!!document.querySelector('[data-testid="forge-iplv-panel"]'),
      s:!!document.querySelector('[data-testid="forge-snd-panel"]'),
      sl:!!document.querySelector('[data-testid="forge-slab-panel"]'),
      c:!!document.querySelector('[data-testid="forge-crn-panel"]'),
      m:!!document.querySelector('[data-testid="forge-cmu-panel"]'),
    }));
    expect(panels.i).toBe(true); expect(panels.s).toBe(true);
    expect(panels.sl).toBe(true); expect(panels.c).toBe(true); expect(panels.m).toBe(true);
  });

  test('08 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
