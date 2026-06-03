// v4-266-orifice.spec.js — Forge-266 orifice plate (ISO 5167).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-266-orifice';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-266 · orifice plate ISO 5167', () => {
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
      !!(window.forge && window.forge.orificeplate
         && typeof window.forge.orificeplate.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Water in 100 mm pipe, 50 mm orifice, ΔP=500 kPa (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.orificeplate.analyse({
      pipeDiameterM: 0.1, orificeDiameterM: 0.05,
      upstreamDensityKgM3: 1000, dynamicViscosityPas: 1e-3,
      differentialPressurePa: 500000,
      compressible: false, kappaSpecHeatRatio: 1.4, upstreamPressurePa: 0,
    }));
    expect(r.betaRatio).toBeCloseTo(0.5, 9);
    expect(r.dischargeCoefficient).toBeGreaterThan(0.59);
    expect(r.dischargeCoefficient).toBeLessThan(0.62);
    expect(r.expansibilityFactor).toBe(1);
    expect(r.massFlowKgS).toBeCloseTo(38.76, 0);
    expect(r.reynoldsNumberD).toBeGreaterThan(100000);
    await shot(page, 'liquid');
  });

  test('03 Gas case: ε < 1 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.orificeplate.analyse({
      pipeDiameterM: 0.1, orificeDiameterM: 0.05,
      upstreamDensityKgM3: 2.38, dynamicViscosityPas: 1.8e-5,
      differentialPressurePa: 20000,
      compressible: true, kappaSpecHeatRatio: 1.4, upstreamPressurePa: 200000,
    }));
    expect(r.expansibilityFactor).toBeLessThan(1.0);
    expect(r.expansibilityFactor).toBeGreaterThan(0.9);
    await shot(page, 'gas');
  });

  test('04 ṁ ∝ √ΔP (incompressible) (cam #3)', async () => {
    const r1 = await page.evaluate(() => window.forge.orificeplate.analyse({
      pipeDiameterM: 0.1, orificeDiameterM: 0.05,
      upstreamDensityKgM3: 1000, dynamicViscosityPas: 1e-3,
      differentialPressurePa: 250000,
      compressible: false, kappaSpecHeatRatio: 1.4, upstreamPressurePa: 0,
    }));
    const r2 = await page.evaluate(() => window.forge.orificeplate.analyse({
      pipeDiameterM: 0.1, orificeDiameterM: 0.05,
      upstreamDensityKgM3: 1000, dynamicViscosityPas: 1e-3,
      differentialPressurePa: 1000000,
      compressible: false, kappaSpecHeatRatio: 1.4, upstreamPressurePa: 0,
    }));
    // ΔP × 4 → ṁ × 2 (within Re-dependent C variation)
    expect(r2.massFlowKgS / r1.massFlowKgS).toBeCloseTo(2.0, 1);
    await shot(page, 'sqrt-dP');
  });

  test('05 β > 0.75 throws (cam #4)', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.orificeplate.analyse({
        pipeDiameterM: 0.1, orificeDiameterM: 0.09,
        upstreamDensityKgM3: 1000, dynamicViscosityPas: 1e-3,
        differentialPressurePa: 50000,
        compressible: false, kappaSpecHeatRatio: 1.4, upstreamPressurePa: 0,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'beta-throw');
  });

  test('06 Larger d gives more flow (cam #5)', async () => {
    const small = await page.evaluate(() => window.forge.orificeplate.analyse({
      pipeDiameterM: 0.1, orificeDiameterM: 0.04,
      upstreamDensityKgM3: 1000, dynamicViscosityPas: 1e-3,
      differentialPressurePa: 500000,
      compressible: false, kappaSpecHeatRatio: 1.4, upstreamPressurePa: 0,
    }));
    const big = await page.evaluate(() => window.forge.orificeplate.analyse({
      pipeDiameterM: 0.1, orificeDiameterM: 0.07,
      upstreamDensityKgM3: 1000, dynamicViscosityPas: 1e-3,
      differentialPressurePa: 500000,
      compressible: false, kappaSpecHeatRatio: 1.4, upstreamPressurePa: 0,
    }));
    expect(big.massFlowKgS).toBeGreaterThan(small.massFlowKgS);
    await shot(page, 'd-effect');
  });

  test('07 panel renders ṁ + Q rows', async () => {
    await page.evaluate(() => { window.__forgeOpenOrificeWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-orifice-run"]').click();
    await page.waitForSelector('[data-testid="forge-orifice-result"]', { timeout: 5000 });
    const m = await page.locator('[data-testid="forge-orifice-m"]').innerText();
    const Q = await page.locator('[data-testid="forge-orifice-Q"]').innerText();
    expect(m).toMatch(/ṁ/);
    expect(Q).toMatch(/L\/s/);
  });

  test('08 menu route fires orifice workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseOrificeWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.orifice' } }));
    });
    await page.waitForSelector('[data-testid="forge-orifice-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
