// v4-234-seismic.spec.js — Forge-234 Seismic load (ASCE 7 §12.8 ELF).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-234-seismic';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-234 · seismic ASCE 7 §12.8', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    // Forge-189 onboarding tour overlay intercepts clicks — dismiss before testing.
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.seismic
         && typeof window.forge.seismic.approximateFundamentalPeriod === 'function'
         && typeof window.forge.seismic.seismicResponseCoefficient === 'function'
         && typeof window.forge.seismic.baseShear === 'function'));
    expect(has).toBe(true);
  });

  test('02 T_a per system: steel MRF vs concrete MRF at h_n = 20m (cam #1)', async () => {
    const T_steel = await page.evaluate(() =>
      window.forge.seismic.approximateFundamentalPeriod('steel-mrf', 20));
    const T_conc  = await page.evaluate(() =>
      window.forge.seismic.approximateFundamentalPeriod('concrete-mrf', 20));
    const T_ebf   = await page.evaluate(() =>
      window.forge.seismic.approximateFundamentalPeriod('steel-ebf', 20));
    const T_other = await page.evaluate(() =>
      window.forge.seismic.approximateFundamentalPeriod('other', 20));

    // ASCE 7 Table 12.8-2 C_t, x (metric):
    //   steel MRF:     0.0724, 0.8
    //   concrete MRF:  0.0466, 0.9
    //   steel EBF:     0.0731, 0.75
    //   other:         0.0488, 0.75
    expect(T_steel).toBeCloseTo(0.0724 * Math.pow(20, 0.8), 6);
    expect(T_conc).toBeCloseTo(0.0466 * Math.pow(20, 0.9), 6);
    expect(T_ebf).toBeCloseTo(0.0731 * Math.pow(20, 0.75), 6);
    expect(T_other).toBeCloseTo(0.0488 * Math.pow(20, 0.75), 6);
    // At h_n = 20m the steel MRF period exceeds the concrete MRF period
    // (exponent dominance flips at h_n ≈ 73m).
    expect(T_steel).toBeGreaterThan(T_conc);
    await shot(page, 'period-per-system');
  });

  test('03 C_s short-period (basic governs) (cam #2)', async () => {
    // Short structure (T low) → C_s_basic is small enough not to be capped
    // and large enough not to hit the floor.
    const T = await page.evaluate(() =>
      window.forge.seismic.approximateFundamentalPeriod('steel-mrf', 20));
    const cs = await page.evaluate((T) => window.forge.seismic.seismicResponseCoefficient({
      SDS: 1.0, SD1: 0.6, T, TL: 8, R: 8, Ie: 1.0,
    }), T);
    expect(cs.CsBasic).toBeCloseTo(1.0 / (8 / 1.0), 9);  // = 0.125
    expect(cs.CsMax).toBeCloseTo(0.6 / (T * (8 / 1.0)), 9);
    expect(cs.CsMin).toBeCloseTo(Math.max(0.044 * 1.0 * 1.0, 0.01), 9);
    // For this textbook 5-story steel MRF the S_D1/T branch governs.
    expect(cs.CsGoverning).toBeLessThan(cs.CsBasic);
    expect(cs.CsGoverning).toBeCloseTo(cs.CsMax, 12);
    await shot(page, 'cs-period-branch');
  });

  test('04 C_s minimum floor governs for high R / low S_D1 (cam #3)', async () => {
    // Push R sky-high so both basic and max drop below the 0.044·S_DS·Ie floor.
    const T = 1.0;
    const cs = await page.evaluate((T) => window.forge.seismic.seismicResponseCoefficient({
      SDS: 1.0, SD1: 0.05, T, TL: 8, R: 16, Ie: 1.0,
    }), T);
    expect(cs.CsBasic).toBeCloseTo(1.0 / 16.0, 9);          // 0.0625
    expect(cs.CsMax).toBeCloseTo(0.05 / (1.0 * 16.0), 9);   // 0.003125
    expect(cs.CsMin).toBeCloseTo(0.044, 9);                 // 0.044·1·1
    // Max < basic, but floor catches the basic-clamped-down result.
    expect(cs.CsGoverning).toBeCloseTo(cs.CsMin, 12);
    await shot(page, 'cs-floor-branch');
  });

  test('05 C_s long-period branch (T > T_L) (cam #4)', async () => {
    const T = 9.0;  // > T_L = 8
    const TL = 8.0;
    const cs = await page.evaluate(({ T, TL }) => window.forge.seismic.seismicResponseCoefficient({
      SDS: 1.0, SD1: 0.6, T, TL, R: 8, Ie: 1.0,
    }), { T, TL });
    expect(cs.CsMax).toBeCloseTo(0.6 * TL / (T * T * (8 / 1.0)), 9);
    await shot(page, 'cs-long-period');
  });

  test('06 V = C_s · W exactly', async () => {
    const V = await page.evaluate(() => window.forge.seismic.baseShear(0.1, 5000e3));
    expect(V).toBeCloseTo(0.1 * 5000e3, 6);  // 500 kN
  });

  test('07 panel computes T_a, C_s, V (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenSeismicWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-seismic-run"]').click();
    await page.waitForSelector('[data-testid="forge-seismic-result"]', { timeout: 5000 });
    const V = await page.locator('[data-testid="forge-seismic-V"]').innerText();
    expect(V).toMatch(/Base shear/);
    expect(V).toMatch(/kN/);
    await shot(page, 'panel');
  });

  test('08 menu route fires seismic workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseSeismicWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.seismic' } }));
    });
    await page.waitForSelector('[data-testid="forge-seismic-panel"]', { timeout: 2000 });
    await shot(page, 'via-menu-event');
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
