// v4-252-cable.spec.js — Forge-252 cable sizing (NEC 310 + IEC 60364).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-252-cable';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-252 · cable sizing NEC 310 + IEC 60364', () => {
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
      !!(window.forge && window.forge.cable
         && typeof window.forge.cable.ampacity === 'function'
         && typeof window.forge.cable.voltageDrop === 'function'));
    expect(has).toBe(true);
  });

  test('02 4 AWG Cu NEC 310 base 85 A, derate to 63.92 A (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.cable.ampacity({
      conductorSize: '4', material: 'copper',
      ambientTempC: 35, numCurrentCarryingConductors: 4,
    }));
    expect(r.baseAmpacityA).toBe(85);
    expect(r.ambientFactor).toBeCloseTo(0.94, 6);
    expect(r.groupingFactor).toBeCloseTo(0.80, 6);
    expect(r.materialFactor).toBe(1.0);
    expect(r.effectiveAmpacityA).toBeCloseTo(63.92, 2);
    await shot(page, 'cu-derate');
  });

  test('03 Aluminum factor 0.80 reduces ampacity (cam #2)', async () => {
    const al = await page.evaluate(() => window.forge.cable.ampacity({
      conductorSize: '4', material: 'aluminum',
      ambientTempC: 35, numCurrentCarryingConductors: 4,
    }));
    expect(al.materialFactor).toBe(0.80);
    expect(al.effectiveAmpacityA).toBeCloseTo(51.14, 2);
    await shot(page, 'al-derate');
  });

  test('04 3-φ voltage drop matches √3·I·L·(R cosφ) (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.cable.voltageDrop({
      system: 'threePhase',
      xsecMm2: 16, lengthMeters: 50, loadAmperes: 100,
      powerFactor: 0.9,
      materialResistivityOhmMmSqPerM: 0.0172,
      conductorReactanceOhmPerKm: 0,
      systemVoltage: 400,
    }));
    expect(r.cableResistanceOhmPerKm).toBeCloseTo(1.075, 3);
    expect(r.voltageDropV).toBeCloseTo(8.379, 2);
    expect(r.voltageDropPct).toBeCloseTo(2.10, 1);
    await shot(page, '3phase-vd');
  });

  test('05 1-φ uses 2× multiplier (cam #4)', async () => {
    const r3 = await page.evaluate(() => window.forge.cable.voltageDrop({
      system: 'threePhase',
      xsecMm2: 16, lengthMeters: 50, loadAmperes: 100,
      powerFactor: 0.9, materialResistivityOhmMmSqPerM: 0.0172,
      conductorReactanceOhmPerKm: 0, systemVoltage: 400,
    }));
    const r1 = await page.evaluate(() => window.forge.cable.voltageDrop({
      system: 'singlePhase',
      xsecMm2: 16, lengthMeters: 50, loadAmperes: 100,
      powerFactor: 0.9, materialResistivityOhmMmSqPerM: 0.0172,
      conductorReactanceOhmPerKm: 0, systemVoltage: 230,
    }));
    // ratio: 1-φ uses 2, 3-φ uses √3 → 1-φ ΔV = 2/√3 × 3-φ ΔV (same R/I/L).
    expect(r1.voltageDropV / r3.voltageDropV).toBeCloseTo(2 / Math.sqrt(3), 4);
    await shot(page, '1phase-vd');
  });

  test('06 ambient temp tiers monotone decreasing (cam #5)', async () => {
    const t30 = await page.evaluate(() => window.forge.cable.ampacity({
      conductorSize: '4', material: 'copper',
      ambientTempC: 30, numCurrentCarryingConductors: 3,
    }));
    const t40 = await page.evaluate(() => window.forge.cable.ampacity({
      conductorSize: '4', material: 'copper',
      ambientTempC: 40, numCurrentCarryingConductors: 3,
    }));
    const t50 = await page.evaluate(() => window.forge.cable.ampacity({
      conductorSize: '4', material: 'copper',
      ambientTempC: 50, numCurrentCarryingConductors: 3,
    }));
    expect(t30.ambientFactor).toBe(1.00);
    expect(t40.ambientFactor).toBe(0.88);
    expect(t50.ambientFactor).toBe(0.75);
    expect(t30.effectiveAmpacityA).toBeGreaterThan(t40.effectiveAmpacityA);
    expect(t40.effectiveAmpacityA).toBeGreaterThan(t50.effectiveAmpacityA);
    await shot(page, 'ambient-tiers');
  });

  test('07 unknown size throws', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.cable.ampacity({
        conductorSize: '0000', material: 'copper',
        ambientTempC: 30, numCurrentCarryingConductors: 3,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel renders ampacity + ΔV rows', async () => {
    await page.evaluate(() => { window.__forgeOpenCableWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-cable-run"]').click();
    await page.waitForSelector('[data-testid="forge-cable-amp"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="forge-cable-vd"]', { timeout: 5000 });
    const ieff = await page.locator('[data-testid="forge-cable-Ieff"]').innerText();
    const vd = await page.locator('[data-testid="forge-cable-Vd"]').innerText();
    expect(ieff).toMatch(/Effective/);
    expect(vd).toMatch(/ΔV/);
  });

  test('09 menu route fires cable workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseCableWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.cable' } }));
    });
    await page.waitForSelector('[data-testid="forge-cable-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
