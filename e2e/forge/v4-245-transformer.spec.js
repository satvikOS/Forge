// v4-245-transformer.spec.js — Forge-245 transformer eq-circuit.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-245-transformer';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-245 · transformer eq-circuit', () => {
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
      !!(window.forge && window.forge.transformer
         && typeof window.forge.transformer.openCircuitTest === 'function'
         && typeof window.forge.transformer.shortCircuitTest === 'function'
         && typeof window.forge.transformer.voltageRegulation === 'function'
         && typeof window.forge.transformer.efficiency === 'function'));
    expect(has).toBe(true);
  });

  test('02 OC test textbook: R_c ≈ 689 Ω, X_m ≈ 83.6 Ω (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.transformer.openCircuitTest({
      openCircuitVoltageV: 415, openCircuitCurrentA: 5, openCircuitPowerW: 250,
    }));
    expect(r.cosPhiOc).toBeCloseTo(0.1205, 3);
    expect(r.coreResistanceOhm).toBeCloseTo(689.0, 0);
    expect(r.magnetisingReactanceOhm).toBeCloseTo(83.6, 0);
    await shot(page, 'oc-test');
  });

  test('03 SC test textbook: R_eq ≈ 38.7 Ω, X_eq ≈ 79.0 Ω (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.transformer.shortCircuitTest({
      shortCircuitCurrentA: 4.545, shortCircuitVoltageV: 400, shortCircuitPowerW: 800,
    }));
    expect(r.equivalentResistanceOhm).toBeCloseTo(38.72, 1);
    expect(r.equivalentImpedanceOhm).toBeCloseTo(88.0, 1);
    expect(r.equivalentReactanceOhm).toBeCloseTo(79.03, 1);
    await shot(page, 'sc-test');
  });

  test('04 voltage regulation at full load pf=0.8 lag: ≈ 3.24% (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.transformer.voltageRegulation({
      equivalentResistanceOhm: 38.72, equivalentReactanceOhm: 79.02,
      ratedHvCurrentA: 4.545, loadFraction: 1.0,
      powerFactor: 0.8, leading: false, ratedHvVoltageV: 11000,
    }));
    expect(r.regulationPct).toBeCloseTo(3.24, 1);
    await shot(page, 'regulation-lag');
  });

  test('05 leading pf reduces (can negate) regulation (cam #4)', async () => {
    const lag = await page.evaluate(() => window.forge.transformer.voltageRegulation({
      equivalentResistanceOhm: 38.72, equivalentReactanceOhm: 79.02,
      ratedHvCurrentA: 4.545, loadFraction: 1.0,
      powerFactor: 0.8, leading: false, ratedHvVoltageV: 11000,
    }));
    const lead = await page.evaluate(() => window.forge.transformer.voltageRegulation({
      equivalentResistanceOhm: 38.72, equivalentReactanceOhm: 79.02,
      ratedHvCurrentA: 4.545, loadFraction: 1.0,
      powerFactor: 0.8, leading: true, ratedHvVoltageV: 11000,
    }));
    expect(lead.regulationPct).toBeLessThan(lag.regulationPct);
    // For this fixture leading actually flips to negative.
    expect(lead.regulationPct).toBeLessThan(0);
    await shot(page, 'leading');
  });

  test('06 efficiency at full load pf=0.8: ≈ 97.44% (cam #5)', async () => {
    const eta = await page.evaluate(() => window.forge.transformer.efficiency({
      ratedKva: 50, openCircuitPowerW: 250, shortCircuitPowerW: 800,
      loadFraction: 1.0, powerFactor: 0.8,
    }));
    expect(eta).toBeCloseTo(0.9744, 3);
    await shot(page, 'eta');
  });

  test('07 max-η load fraction = √(P_oc/P_sc)', async () => {
    const x = await page.evaluate(() =>
      window.forge.transformer.maximumEfficiencyLoadFraction(250, 800));
    expect(x).toBeCloseTo(Math.sqrt(250 / 800), 6);
  });

  test('08 efficiency peaks near x*', async () => {
    const etaBelow = await page.evaluate(() => window.forge.transformer.efficiency({
      ratedKva: 50, openCircuitPowerW: 250, shortCircuitPowerW: 800,
      loadFraction: 0.3, powerFactor: 1.0,
    }));
    const etaPeak = await page.evaluate(() => window.forge.transformer.efficiency({
      ratedKva: 50, openCircuitPowerW: 250, shortCircuitPowerW: 800,
      loadFraction: 0.559, powerFactor: 1.0,
    }));
    const etaAbove = await page.evaluate(() => window.forge.transformer.efficiency({
      ratedKva: 50, openCircuitPowerW: 250, shortCircuitPowerW: 800,
      loadFraction: 1.0, powerFactor: 1.0,
    }));
    expect(etaPeak).toBeGreaterThan(etaBelow);
    expect(etaPeak).toBeGreaterThan(etaAbove);
  });

  test('09 panel renders regulation + η rows', async () => {
    await page.evaluate(() => { window.__forgeOpenXformerWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-xformer-run"]').click();
    await page.waitForSelector('[data-testid="forge-xformer-result"]', { timeout: 5000 });
    const reg = await page.locator('[data-testid="forge-xformer-reg"]').innerText();
    const eta = await page.locator('[data-testid="forge-xformer-eta"]').innerText();
    expect(reg).toMatch(/Regulation/);
    expect(eta).toMatch(/η/);
  });

  test('10 menu route fires xformer workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseXformerWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.xformer' } }));
    });
    await page.waitForSelector('[data-testid="forge-xformer-panel"]', { timeout: 2000 });
  });

  test('11 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
