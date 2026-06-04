// v4-306-coolingload.spec.js — Forge-306 HVAC coil load.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-306-coolingload';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const COIL = {
  airflowLps: 1000, tSupplyC: 13, tReturnC: 26,
  wSupplyKgPerKg: 0.0085, wReturnKgPerKg: 0.011, atmPressureKPa: 0,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-306 · HVAC coil load', () => {
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

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.coolingload
         && typeof window.forge.coolingload.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 1000 L/s cooling: Q_s=15.7, Q_l=7.5, SHR=0.68 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.coolingload.analyse(b), COIL);
    expect(r.massFlowKgPerS).toBeCloseTo(1.20, 4);
    expect(r.sensibleLoadKw).toBeCloseTo(1.20 * 1.006 * (26 - 13), 3);
    expect(r.latentLoadKw).toBeCloseTo(1.20 * 2501 * (0.011 - 0.0085), 3);
    expect(r.sensibleHeatRatio).toBeGreaterThan(0.67);
    expect(r.sensibleHeatRatio).toBeLessThan(0.69);
    expect(r.modeName).toBe('cooling');
    await shot(page, 'cooling');
  });

  test('03 Heating mode: T_supply > T_return (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.coolingload.analyse({
      airflowLps: 1000, tSupplyC: 35, tReturnC: 18,
      wSupplyKgPerKg: 0.005, wReturnKgPerKg: 0.005, atmPressureKPa: 0,
    }));
    expect(r.totalLoadKw).toBeLessThan(0);
    expect(r.modeName).toBe('heating');
    expect(r.latentLoadKw).toBeCloseTo(0, 6);
    await shot(page, 'heating');
  });

  test('04 Pure latent load: ΔT=0 gives SHR=0 (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.coolingload.analyse({
      airflowLps: 1000, tSupplyC: 20, tReturnC: 20,
      wSupplyKgPerKg: 0.005, wReturnKgPerKg: 0.010, atmPressureKPa: 0,
    }));
    expect(r.sensibleLoadKw).toBeCloseTo(0, 6);
    expect(r.latentLoadKw).toBeGreaterThan(0);
    expect(r.sensibleHeatRatio).toBeCloseTo(0, 6);
    await shot(page, 'latent');
  });

  test('05 High altitude (84.5 kPa) drops ṁ (cam #5)', async () => {
    const r0 = await page.evaluate((b) => window.forge.coolingload.analyse(b), COIL);
    const r1 = await page.evaluate((b) => window.forge.coolingload.analyse({
      ...b, atmPressureKPa: 84.5,
    }), COIL);
    expect(r1.massFlowKgPerS).toBeLessThan(r0.massFlowKgPerS);
    expect(r1.totalLoadKw).toBeLessThan(r0.totalLoadKw);
    await shot(page, 'altitude');
  });

  test('06 Doubled airflow → doubled loads (linear in ṁ) (cam #6)', async () => {
    const r1 = await page.evaluate((b) => window.forge.coolingload.analyse(b), COIL);
    const r2 = await page.evaluate((b) => window.forge.coolingload.analyse({
      ...b, airflowLps: 2000,
    }), COIL);
    expect(r2.totalLoadKw / r1.totalLoadKw).toBeCloseTo(2.0, 5);
    expect(r2.sensibleHeatRatio).toBeCloseTo(r1.sensibleHeatRatio, 6);  // SHR ratio invariant
    await shot(page, 'doubled-flow');
  });

  test('07 Panel renders Q_total + SHR + mode rows', async () => {
    await page.evaluate(() => { window.__forgeOpenCoolingLoadWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-cload-run"]').click();
    await page.waitForSelector('[data-testid="forge-cload-result"]', { timeout: 5000 });
    const Qt = await page.locator('[data-testid="forge-cload-total"]').innerText();
    const sh = await page.locator('[data-testid="forge-cload-shr"]').innerText();
    const md = await page.locator('[data-testid="forge-cload-mode"]').innerText();
    expect(Qt).toMatch(/Q_total/);
    expect(sh).toMatch(/SHR/);
    expect(md).toMatch(/COOLING|HEATING/);
  });

  test('08 Menu route opens cooling load panel', async () => {
    await page.evaluate(() => { window.__forgeCloseCoolingLoadWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.coolingload' } }));
    });
    await page.waitForSelector('[data-testid="forge-cload-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
