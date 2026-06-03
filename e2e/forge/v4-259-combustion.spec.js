// v4-259-combustion.spec.js — Forge-259 combustion analysis.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-259-combustion';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-259 · combustion analysis', () => {
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
      !!(window.forge && window.forge.combustion
         && typeof window.forge.combustion.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 bituminous coal textbook fixture (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.combustion.analyse({
      fuel: { C: 0.75, H: 0.05, O: 0.05, N: 0.01, S: 0.04 },
      excessAirRatio: 1.20,
    }));
    expect(r.stoichiometricOxygenKgPerKgFuel).toBeCloseTo(2.39, 2);
    expect(r.stoichiometricAirKgPerKgFuel).toBeCloseTo(10.30, 1);
    expect(r.actualAirKgPerKgFuel).toBeCloseTo(12.36, 1);
    expect(r.co2KgPerKgFuel).toBeCloseTo(2.75, 2);
    expect(r.dryCO2MassPct).toBeCloseTo(21.5, 0);
    expect(r.dryO2MassPct).toBeCloseTo(3.73, 1);
    await shot(page, 'coal');
  });

  test('03 stoichiometric (λ=1) → 0% excess O₂ (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.combustion.analyse({
      fuel: { C: 0.75, H: 0.05, O: 0.05, N: 0.01, S: 0.04 },
      excessAirRatio: 1.0,
    }));
    expect(r.excessO2KgPerKgFuel).toBeCloseTo(0, 9);
    expect(r.dryO2MassPct).toBeCloseTo(0, 9);
    await shot(page, 'stoichiometric');
  });

  test('04 higher excess air dilutes %CO₂ (cam #3)', async () => {
    const low = await page.evaluate(() => window.forge.combustion.analyse({
      fuel: { C: 0.75, H: 0.05, O: 0.05, N: 0.01, S: 0.04 },
      excessAirRatio: 1.10,
    }));
    const high = await page.evaluate(() => window.forge.combustion.analyse({
      fuel: { C: 0.75, H: 0.05, O: 0.05, N: 0.01, S: 0.04 },
      excessAirRatio: 1.50,
    }));
    expect(high.dryCO2MassPct).toBeLessThan(low.dryCO2MassPct);
    expect(high.dryO2MassPct).toBeGreaterThan(low.dryO2MassPct);
    await shot(page, 'excess-air');
  });

  test('05 pure methane CH₄ stoich AFR ≈ 17.2 (cam #4)', async () => {
    // CH₄: C=12/16 = 0.75, H=4/16 = 0.25.
    const r = await page.evaluate(() => window.forge.combustion.analyse({
      fuel: { C: 0.75, H: 0.25, O: 0, N: 0, S: 0 },
      excessAirRatio: 1.0,
    }));
    // m_O₂ = 8/3·0.75 + 8·0.25 = 2.00 + 2.00 = 4.00; AFR = 4/0.232 = 17.24
    expect(r.stoichiometricAirKgPerKgFuel).toBeCloseTo(17.24, 1);
    await shot(page, 'methane');
  });

  test('06 hydrogen H₂ produces only water + N₂ (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.combustion.analyse({
      fuel: { C: 0, H: 1.0, O: 0, N: 0, S: 0 },
      excessAirRatio: 1.0,
    }));
    expect(r.co2KgPerKgFuel).toBeCloseTo(0, 9);
    expect(r.h2oKgPerKgFuel).toBeCloseTo(9.0, 1);  // 9·H = 9
    expect(r.dryCO2MassPct).toBeCloseTo(0, 9);
    await shot(page, 'hydrogen');
  });

  test('07 invalid fractions (sum > 1) throw', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.combustion.analyse({
        fuel: { C: 0.5, H: 0.5, O: 0.5, N: 0, S: 0 },
        excessAirRatio: 1.20,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel renders AFR + dry flue gas rows', async () => {
    await page.evaluate(() => { window.__forgeOpenCombustionWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-combustion-run"]').click();
    await page.waitForSelector('[data-testid="forge-combustion-result"]', { timeout: 5000 });
    const afr = await page.locator('[data-testid="forge-combustion-AFR"]').innerText();
    const dry = await page.locator('[data-testid="forge-combustion-dry"]').innerText();
    expect(afr).toMatch(/AFR/);
    expect(dry).toMatch(/Dry flue gas/);
  });

  test('09 menu route fires combustion workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseCombustionWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.combustion' } }));
    });
    await page.waitForSelector('[data-testid="forge-combustion-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
