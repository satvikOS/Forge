// v4-323-bundle.spec.js — Forge-323 5-calc bundle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-323-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.configure({ timeout: 240000 });
test.describe.serial('Forge-323 · 5-calc bundle', () => {
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
      s: !!window.forge?.staticmargin, r: !!window.forge?.refpipe,
      b: !!window.forge?.busbar, d: !!window.forge?.ductleakage, v: !!window.forge?.dustvent,
    }));
    expect(has.s).toBe(true); expect(has.r).toBe(true);
    expect(has.b).toBe(true); expect(has.d).toBe(true); expect(has.v).toBe(true);
  });

  test('02 Static margin: SM = x_NP - x_CG identity (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.staticmargin.analyse({
      xCG_normalized:0.30, xACwing_normalized:0.25,
      tailVolumeCoefficient:0.5, tailToWingCLalphaRatio:0.8, downwashGradient:0.4,
    }));
    expect(r.xNP_normalized).toBeCloseTo(0.25 + 0.5 * 0.8 * 0.6, 5);
    expect(r.staticMargin).toBeCloseTo(r.xNP_normalized - 0.30, 5);
    expect(r.stable).toBe(true);
    await shot(page, 'staticmargin');
  });

  test('03 Refrigerant pipe: D from velocity limit (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.refpipe.analyse({
      coolingDutyKw:100, enthalpyChangeKJpkg:200, specificVolumeM3pkg:0.058, velocityLimitMs:6,
    }));
    expect(r.massFlowKgPerS).toBeCloseTo(0.5, 5);
    expect(r.volumeFlowM3PerS).toBeCloseTo(0.5 * 0.058, 5);
    expect(r.requiredDiameterMm).toBeGreaterThan(75);
    expect(r.requiredDiameterMm).toBeLessThan(80);
    await shot(page, 'refpipe');
  });

  test('04 Bus bar: F ∝ I_peak² / a (cam #4)', async () => {
    const r1 = await page.evaluate(() => window.forge.busbar.analyse({
      shortCircuitCurrentKaRms:50, asymmetryFactorKappa:1.8, conductorSpacingMm:100, spanLengthM:1,
    }));
    const r2 = await page.evaluate(() => window.forge.busbar.analyse({
      shortCircuitCurrentKaRms:100, asymmetryFactorKappa:1.8, conductorSpacingMm:100, spanLengthM:1,
    }));
    expect(r2.peakCurrentKa).toBeCloseTo(2 * r1.peakCurrentKa, 4);
    expect(r2.forcePerLengthNm).toBeCloseTo(4 * r1.forcePerLengthNm, 0);
    await shot(page, 'busbar');
  });

  test('05 Duct leakage: linear in area (cam #5)', async () => {
    const r1 = await page.evaluate(() => window.forge.ductleakage.analyse({
      ductSurfaceAreaM2:100, testPressureInchWC:1.0, leakageClassCL:6,
    }));
    const r2 = await page.evaluate(() => window.forge.ductleakage.analyse({
      ductSurfaceAreaM2:200, testPressureInchWC:1.0, leakageClassCL:6,
    }));
    expect(r2.totalLeakageLPerS / r1.totalLeakageLPerS).toBeCloseTo(2.0, 4);
    expect(r1.leakageRateLPerSperM2).toBeCloseTo(r2.leakageRateLPerSperM2, 4);
    await shot(page, 'ductleak');
  });

  test('06 Dust vent: P_red ≤ P_stat throws (cam #6)', async () => {
    const err = await page.evaluate(() => {
      try { window.forge.dustvent.analyse({
        vesselVolumeM3:10, kstBarMperS:200,
        maxAllowableOverpressureBar:0.1, ventReleasePressureBar:0.2,
      }); return null; }
      catch (e) { return String(e.message || e); }
    });
    expect(err).toMatch(/P_red|stat/);
    await shot(page, 'dust-rejected');
  });

  test('07 5 panels open via menu (cam #7)', async () => {
    const ids = ['staticmargin', 'refpipe', 'busbar', 'ductleakage', 'dustvent'];
    for (const id of ids) {
      await page.evaluate((i) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: `tools.${i}` } }));
      }, id);
      await page.waitForTimeout(300);
    }
    const panels = await page.evaluate(() => ({
      sm:!!document.querySelector('[data-testid="forge-sm-panel"]'),
      rp:!!document.querySelector('[data-testid="forge-rp-panel"]'),
      bb:!!document.querySelector('[data-testid="forge-bb-panel"]'),
      dl:!!document.querySelector('[data-testid="forge-dl-panel"]'),
      dv:!!document.querySelector('[data-testid="forge-dv-panel"]'),
    }));
    expect(panels.sm).toBe(true); expect(panels.rp).toBe(true);
    expect(panels.bb).toBe(true); expect(panels.dl).toBe(true); expect(panels.dv).toBe(true);
  });

  test('08 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
