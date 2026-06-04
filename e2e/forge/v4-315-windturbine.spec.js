// v4-315-windturbine.spec.js — Forge-315 wind turbine BEM / Betz.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-315-windturbine';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const V100 = {
  rotorDiameterM: 100, windSpeedMs: 10, airDensityKgPerM3: 1.225,
  powerCoefficient: 0.40, generatorEfficiency: 0.95,
  rotorSpeedRpm: 15, capacityFactor: 0.30,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-315 · wind turbine', () => {
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
      !!(window.forge && window.forge.windturbine
         && typeof window.forge.windturbine.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 100 m rotor 10 m/s: P_elec=1.83 MW, λ=7.85 (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.windturbine.analyse(b), V100);
    expect(r.sweptAreaM2).toBeCloseTo(Math.PI * 100 * 100 / 4, 1);
    expect(r.availableWindPowerW / 1e6).toBeCloseTo(0.5 * 1.225 * r.sweptAreaM2 * 1000 / 1e6, 3);
    expect(r.betzCeilingPowerW / r.availableWindPowerW).toBeCloseTo(16/27, 5);
    expect(r.mechanicalPowerW / r.availableWindPowerW).toBeCloseTo(0.40, 5);
    expect(r.electricalPowerW / r.mechanicalPowerW).toBeCloseTo(0.95, 5);
    expect(r.tipSpeedRatio).toBeCloseTo(Math.PI * 100 * 15 / (60 * 10), 4);
    await shot(page, 'standard');
  });

  test('03 P ∝ V³ (cam #3)', async () => {
    const r10 = await page.evaluate((b) => window.forge.windturbine.analyse(b), V100);
    const r20 = await page.evaluate((b) => window.forge.windturbine.analyse({
      ...b, windSpeedMs: 20,
    }), V100);
    expect(r20.availableWindPowerW / r10.availableWindPowerW).toBeCloseTo(8.0, 4);
    expect(r20.electricalPowerW / r10.electricalPowerW).toBeCloseTo(8.0, 4);
    await shot(page, 'V-cubed');
  });

  test('04 P ∝ D² (cam #4)', async () => {
    const d100 = await page.evaluate((b) => window.forge.windturbine.analyse(b), V100);
    const d200 = await page.evaluate((b) => window.forge.windturbine.analyse({
      ...b, rotorDiameterM: 200,
    }), V100);
    expect(d200.availableWindPowerW / d100.availableWindPowerW).toBeCloseTo(4.0, 4);
    await shot(page, 'D-squared');
  });

  test('05 C_P > Betz throws (cam #5)', async () => {
    const err = await page.evaluate(() => {
      try { window.forge.windturbine.analyse({
        rotorDiameterM: 100, windSpeedMs: 10, airDensityKgPerM3: 1.225,
        powerCoefficient: 0.7, generatorEfficiency: 0.95,
        rotorSpeedRpm: 15, capacityFactor: 0.30,
      }); return null; }
      catch (e) { return String(e.message || e); }
    });
    expect(err).toMatch(/powerCoefficient.*0.593|16\/27/);
    await shot(page, 'betz-cap');
  });

  test('06 AEP = P_elec · 8760 · CF (cam #6)', async () => {
    const r = await page.evaluate((b) => window.forge.windturbine.analyse(b), V100);
    expect(r.annualEnergyMWh).toBeCloseTo(r.electricalPowerW * 8760 * 0.30 / 1e6, 0);
    await shot(page, 'AEP');
  });

  test('07 Panel renders P_elec + λ + AEP rows', async () => {
    await page.evaluate(() => { window.__forgeOpenWindTurbineWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-wt-run"]').click();
    await page.waitForSelector('[data-testid="forge-wt-result"]', { timeout: 5000 });
    const Pe  = await page.locator('[data-testid="forge-wt-Pelec"]').innerText();
    const tsr = await page.locator('[data-testid="forge-wt-tsr"]').innerText();
    const AEP = await page.locator('[data-testid="forge-wt-AEP"]').innerText();
    expect(Pe).toMatch(/P_elec/);
    expect(tsr).toMatch(/λ/);
    expect(AEP).toMatch(/AEP/);
  });

  test('08 Menu route opens wind turbine panel', async () => {
    await page.evaluate(() => { window.__forgeCloseWindTurbineWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.windturbine' } }));
    });
    await page.waitForSelector('[data-testid="forge-wt-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
