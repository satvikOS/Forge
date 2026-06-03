// v4-255-solar.spec.js — Forge-255 solar PV sizing.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-255-solar';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-255 · solar PV sizing', () => {
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
      !!(window.forge && window.forge.solarpv
         && typeof window.forge.solarpv.sizeArray === 'function'
         && typeof window.forge.solarpv.sizeBatteryBank === 'function'
         && typeof window.forge.solarpv.sizeInverterVA === 'function'));
    expect(has).toBe(true);
  });

  test('02 array sizing textbook fixture: 4 × 400 Wp (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.solarpv.sizeArray({
      dailyEnergyAcWh: 5000, peakSunHours: 5,
      panelWattPeak: 400, inverterEfficiency: 0.95,
      batteryEfficiency: 0.92, arrayDeratingFactor: 0.75,
    }));
    expect(r.requiredArrayPowerWp).toBeCloseTo(1525.5, 0);
    expect(r.numberOfPanels).toBe(4);
    expect(r.installedArrayPowerWp).toBe(1600);
    await shot(page, 'array');
  });

  test('03 battery bank: 21.7 kWh storage @ 48V → 453 Ah (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.solarpv.sizeBatteryBank({
      dailyEnergyAcWh: 5000, autonomyDays: 2,
      depthOfDischarge: 0.5, batteryBankVoltage: 48, batteryEfficiency: 0.92,
    }));
    expect(r.storageEnergyWh).toBeCloseTo(21739, 0);
    expect(r.batteryCapacityAh).toBeCloseTo(452.9, 1);
    await shot(page, 'battery');
  });

  test('04 inverter VA: 3000W × 1.25 / 0.9 = 4167 VA (cam #3)', async () => {
    const v = await page.evaluate(() => window.forge.solarpv.sizeInverterVA({
      peakAcLoadW: 3000, powerFactor: 0.9, sizingFactor: 1.25,
    }));
    expect(v).toBeCloseTo(4166.67, 1);
    await shot(page, 'inverter');
  });

  test('05 doubling autonomy doubles Ah (cam #4)', async () => {
    const r1 = await page.evaluate(() => window.forge.solarpv.sizeBatteryBank({
      dailyEnergyAcWh: 5000, autonomyDays: 2,
      depthOfDischarge: 0.5, batteryBankVoltage: 48, batteryEfficiency: 0.92,
    }));
    const r2 = await page.evaluate(() => window.forge.solarpv.sizeBatteryBank({
      dailyEnergyAcWh: 5000, autonomyDays: 4,
      depthOfDischarge: 0.5, batteryBankVoltage: 48, batteryEfficiency: 0.92,
    }));
    expect(r2.batteryCapacityAh / r1.batteryCapacityAh).toBeCloseTo(2.0, 6);
    await shot(page, 'autonomy');
  });

  test('06 grid-tie (no battery loss) reduces array Wp (cam #5)', async () => {
    const offgrid = await page.evaluate(() => window.forge.solarpv.sizeArray({
      dailyEnergyAcWh: 5000, peakSunHours: 5,
      panelWattPeak: 400, inverterEfficiency: 0.95,
      batteryEfficiency: 0.92, arrayDeratingFactor: 0.75,
    }));
    const gridTie = await page.evaluate(() => window.forge.solarpv.sizeArray({
      dailyEnergyAcWh: 5000, peakSunHours: 5,
      panelWattPeak: 400, inverterEfficiency: 0.95,
      batteryEfficiency: 1.0, arrayDeratingFactor: 0.75,
    }));
    expect(gridTie.requiredArrayPowerWp).toBeLessThan(offgrid.requiredArrayPowerWp);
    await shot(page, 'grid-tie');
  });

  test('07 unrealistic inputs throw', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.solarpv.sizeArray({
        dailyEnergyAcWh: 0, peakSunHours: 5,
        panelWattPeak: 400, inverterEfficiency: 0.95,
        batteryEfficiency: 0.92, arrayDeratingFactor: 0.75,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel renders array + battery + inverter rows', async () => {
    await page.evaluate(() => { window.__forgeOpenSolarWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-solar-run"]').click();
    await page.waitForSelector('[data-testid="forge-solar-result"]', { timeout: 5000 });
    const arr = await page.locator('[data-testid="forge-solar-array"]').innerText();
    const bat = await page.locator('[data-testid="forge-solar-batt"]').innerText();
    const inv = await page.locator('[data-testid="forge-solar-inv"]').innerText();
    expect(arr).toMatch(/Array/);
    expect(bat).toMatch(/Battery/);
    expect(inv).toMatch(/Inverter/);
  });

  test('09 menu route fires solar workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseSolarWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.solar' } }));
    });
    await page.waitForSelector('[data-testid="forge-solar-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
