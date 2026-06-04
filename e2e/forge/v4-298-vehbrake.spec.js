// v4-298-vehbrake.spec.js — Forge-298 vehicle braking energy.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-298-vehbrake';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const SEDAN = {
  vehicleMassKg: 1500, initialSpeedKmH: 100,
  decelerationMs2: 6, brakeCount: 4,
  discMassKg: 5, discSpecificHeatJkgK: 460,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-298 · vehicle braking', () => {
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
      !!(window.forge && window.forge.vehbrake
         && typeof window.forge.vehbrake.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 1500 kg sedan from 100 km/h, a=6 → KE=579 kJ, ΔT=63 K (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.vehbrake.analyse(b), SEDAN);
    expect(r.initialSpeedMs).toBeCloseTo(100/3.6, 6);
    expect(r.initialKineticEnergyJ).toBeCloseTo(0.5 * 1500 * (100/3.6)**2, 1);
    expect(r.stopTimeS).toBeCloseTo((100/3.6) / 6, 6);
    expect(r.stopDistanceM).toBeCloseTo((100/3.6)**2 / 12, 4);
    expect(r.brakeForceTotalN).toBeCloseTo(9000, 6);
    expect(r.discTemperatureRiseK).toBeGreaterThan(60);
    expect(r.discTemperatureRiseK).toBeLessThan(65);
    await shot(page, 'sedan');
  });

  test('03 KE ∝ v², d ∝ v², t ∝ v (cam #3)', async () => {
    const v100 = await page.evaluate((b) => window.forge.vehbrake.analyse(b), SEDAN);
    const v200 = await page.evaluate((b) => window.forge.vehbrake.analyse({
      ...b, initialSpeedKmH: 200,
    }), SEDAN);
    expect(v200.initialKineticEnergyJ / v100.initialKineticEnergyJ).toBeCloseTo(4.0, 4);
    expect(v200.stopDistanceM / v100.stopDistanceM).toBeCloseTo(4.0, 4);
    expect(v200.stopTimeS / v100.stopTimeS).toBeCloseTo(2.0, 6);
    await shot(page, 'speed-square');
  });

  test('04 Hard braking (a=10): faster stop, same KE/Q (cam #4)', async () => {
    const norm = await page.evaluate((b) => window.forge.vehbrake.analyse(b), SEDAN);
    const hard = await page.evaluate((b) => window.forge.vehbrake.analyse({
      ...b, decelerationMs2: 10,
    }), SEDAN);
    expect(hard.initialKineticEnergyJ).toBeCloseTo(norm.initialKineticEnergyJ, 1);
    expect(hard.heatPerBrakeJ).toBeCloseTo(norm.heatPerBrakeJ, 1);
    expect(hard.stopTimeS).toBeLessThan(norm.stopTimeS);
    expect(hard.averagePowerW).toBeGreaterThan(norm.averagePowerW);
    await shot(page, 'hard-brake');
  });

  test('05 Heavier truck: more KE + ΔT (cam #5)', async () => {
    const sedan = await page.evaluate((b) => window.forge.vehbrake.analyse(b), SEDAN);
    const truck = await page.evaluate((b) => window.forge.vehbrake.analyse({
      ...b, vehicleMassKg: 4500, discMassKg: 8,
    }), SEDAN);
    expect(truck.initialKineticEnergyJ).toBeGreaterThan(sedan.initialKineticEnergyJ);
    expect(truck.discTemperatureRiseK).toBeGreaterThan(sedan.discTemperatureRiseK);
    await shot(page, 'truck');
  });

  test('06 More brakes share heat (cam #6)', async () => {
    const four = await page.evaluate((b) => window.forge.vehbrake.analyse(b), SEDAN);
    const six  = await page.evaluate((b) => window.forge.vehbrake.analyse({
      ...b, brakeCount: 6,
    }), SEDAN);
    expect(six.heatPerBrakeJ / four.heatPerBrakeJ).toBeCloseTo(4/6, 4);
    await shot(page, 'six-brakes');
  });

  test('07 Panel renders KE + ΔT + P rows', async () => {
    await page.evaluate(() => { window.__forgeOpenVehicleBrakingWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-vehbrake-run"]').click();
    await page.waitForSelector('[data-testid="forge-vehbrake-result"]', { timeout: 5000 });
    const KE = await page.locator('[data-testid="forge-vehbrake-KE"]').innerText();
    const T  = await page.locator('[data-testid="forge-vehbrake-T"]').innerText();
    const P  = await page.locator('[data-testid="forge-vehbrake-P"]').innerText();
    expect(KE).toMatch(/KE/);
    expect(T).toMatch(/ΔT_disc/);
    expect(P).toMatch(/P_avg/);
  });

  test('08 Menu route opens braking panel', async () => {
    await page.evaluate(() => { window.__forgeCloseVehicleBrakingWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.vehbrake' } }));
    });
    await page.waitForSelector('[data-testid="forge-vehbrake-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
