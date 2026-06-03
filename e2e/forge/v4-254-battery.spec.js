// v4-254-battery.spec.js — Forge-254 battery sizing.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-254-battery';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-254 · battery sizing', () => {
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
      !!(window.forge && window.forge.battery
         && typeof window.forge.battery.runtime === 'function'
         && typeof window.forge.battery.chargeTime === 'function'
         && typeof window.forge.battery.terminalState === 'function'));
    expect(has).toBe(true);
  });

  test('02 Peukert at rated current returns full capacity (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.battery.runtime({
      ratedCapacityAh: 100, ratedHours: 20, peukertExponent: 1.2,
      loadCurrentA: 5,  // = C/20
    }));
    expect(r.effectiveCapacityAh).toBeCloseTo(100, 6);
    expect(r.runtimeHours).toBeCloseTo(20, 6);
    await shot(page, 'rated');
  });

  test('03 Peukert at 10× rated current sharply reduces C_eff (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.battery.runtime({
      ratedCapacityAh: 100, ratedHours: 20, peukertExponent: 1.2,
      loadCurrentA: 50,  // = C/2
    }));
    expect(r.effectiveCapacityAh).toBeCloseTo(63.10, 1);
    expect(r.runtimeHours).toBeCloseTo(1.262, 2);
    await shot(page, 'high-current');
  });

  test('04 Charge time CC+CV (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.battery.chargeTime({
      ratedCapacityAh: 100, chargeCurrentA: 20,
      initialSoc: 0.20, targetSoc: 0.95, cvPhaseFactor: 0.5,
    }));
    expect(r.constantCurrentHours).toBeCloseTo(3.75, 6);
    expect(r.constantVoltageHours).toBeCloseTo(1.875, 6);
    expect(r.totalHours).toBeCloseTo(5.625, 6);
    await shot(page, 'charge');
  });

  test('05 Terminal voltage drop and SoC (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.battery.terminalState({
      openCircuitVoltage: 12.6, internalResistanceOhm: 0.02, loadCurrentA: 50,
    }));
    expect(r.dropV).toBeCloseTo(1.0, 6);
    expect(r.terminalVoltageV).toBeCloseTo(11.6, 6);
    expect(r.stateOfCharge).toBeCloseTo(0.9, 3);
    await shot(page, 'terminal');
  });

  test('06 SoC clamps to [0, 1] (cam #5)', async () => {
    const lo = await page.evaluate(() => window.forge.battery.terminalState({
      openCircuitVoltage: 11.0, internalResistanceOhm: 0, loadCurrentA: 0,
    }));
    const hi = await page.evaluate(() => window.forge.battery.terminalState({
      openCircuitVoltage: 13.5, internalResistanceOhm: 0, loadCurrentA: 0,
    }));
    expect(lo.stateOfCharge).toBeCloseTo(0.0, 9);
    expect(hi.stateOfCharge).toBeCloseTo(1.0, 9);
    await shot(page, 'SoC-clamp');
  });

  test('07 invalid SoC bounds throw', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.battery.chargeTime({
        ratedCapacityAh: 100, chargeCurrentA: 20,
        initialSoc: 0.9, targetSoc: 0.5, cvPhaseFactor: 0.5,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel tab-switch renders all three result widgets', async () => {
    await page.evaluate(() => { window.__forgeOpenBatteryWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-battery-run"]').click();
    await page.waitForSelector('[data-testid="forge-battery-runtime"]', { timeout: 5000 });
    await page.locator('[data-testid="forge-battery-tab-charge"]').click();
    await page.locator('[data-testid="forge-battery-run"]').click();
    await page.waitForSelector('[data-testid="forge-battery-charge"]', { timeout: 5000 });
    await page.locator('[data-testid="forge-battery-tab-terminal"]').click();
    await page.locator('[data-testid="forge-battery-run"]').click();
    await page.waitForSelector('[data-testid="forge-battery-Vt"]', { timeout: 5000 });
    const soc = await page.locator('[data-testid="forge-battery-SoC"]').innerText();
    expect(soc).toMatch(/SoC/);
  });

  test('09 menu route fires battery workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseBatteryWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.battery' } }));
    });
    await page.waitForSelector('[data-testid="forge-battery-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
