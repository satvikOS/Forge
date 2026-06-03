// v4-265-tmd.spec.js — Forge-265 tuned mass damper.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-265-tmd';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-265 · tuned mass damper', () => {
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
      !!(window.forge && window.forge.tmd
         && typeof window.forge.tmd.sizeAbsorber === 'function'));
    expect(has).toBe(true);
  });

  test('02 Den Hartog textbook: m_p=1000 kg, f_p=2.5 Hz, μ=0.05 (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.tmd.sizeAbsorber({
      primaryMassKg: 1000, primaryFrequencyHz: 2.5, massRatio: 0.05,
    }));
    expect(r.absorberMassKg).toBeCloseTo(50, 9);
    expect(r.frequencyRatioOptimum).toBeCloseTo(1/1.05, 6);
    expect(r.dampingRatioOptimum).toBeCloseTo(0.1273, 3);
    expect(r.absorberFrequencyHz).toBeCloseTo(2.381, 2);
    expect(r.absorberStiffnessNPerM).toBeCloseTo(11190, -1);
    expect(r.peakTransmissibility).toBeCloseTo(Math.sqrt(41), 3);
    await shot(page, 'denhartog');
  });

  test('03 f_opt = 1/(1+μ) closed form (cam #2)', async () => {
    const μ = 0.10;
    const r = await page.evaluate((mu) => window.forge.tmd.sizeAbsorber({
      primaryMassKg: 1000, primaryFrequencyHz: 5, massRatio: mu,
    }), μ);
    expect(r.frequencyRatioOptimum).toBeCloseTo(1 / (1 + μ), 9);
    await shot(page, 'f_opt');
  });

  test('04 ζ_opt = √(3μ/(8(1+μ)³)) closed form (cam #3)', async () => {
    const μ = 0.15;
    const r = await page.evaluate((mu) => window.forge.tmd.sizeAbsorber({
      primaryMassKg: 1000, primaryFrequencyHz: 5, massRatio: mu,
    }), μ);
    const expected = Math.sqrt(3 * μ / (8 * Math.pow(1 + μ, 3)));
    expect(r.dampingRatioOptimum).toBeCloseTo(expected, 9);
    await shot(page, 'zeta_opt');
  });

  test('05 Higher μ reduces peak transmissibility (cam #4)', async () => {
    const small = await page.evaluate(() => window.forge.tmd.sizeAbsorber({
      primaryMassKg: 1000, primaryFrequencyHz: 2.5, massRatio: 0.02,
    }));
    const big = await page.evaluate(() => window.forge.tmd.sizeAbsorber({
      primaryMassKg: 1000, primaryFrequencyHz: 2.5, massRatio: 0.20,
    }));
    expect(big.peakTransmissibility).toBeLessThan(small.peakTransmissibility);
    expect(big.absorberMassKg).toBeGreaterThan(small.absorberMassKg);
    await shot(page, 'mu-tradeoff');
  });

  test('06 k_a = m_a · ω_a² (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.tmd.sizeAbsorber({
      primaryMassKg: 1000, primaryFrequencyHz: 2.5, massRatio: 0.05,
    }));
    const ω = 2 * Math.PI * r.absorberFrequencyHz;
    expect(r.absorberStiffnessNPerM).toBeCloseTo(r.absorberMassKg * ω * ω, 6);
    await shot(page, 'k-identity');
  });

  test('07 invalid μ throws', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.tmd.sizeAbsorber({
        primaryMassKg: 1000, primaryFrequencyHz: 2.5, massRatio: -0.1,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel renders k + TR rows', async () => {
    await page.evaluate(() => { window.__forgeOpenTMDWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-tmd-run"]').click();
    await page.waitForSelector('[data-testid="forge-tmd-result"]', { timeout: 5000 });
    const k = await page.locator('[data-testid="forge-tmd-k"]').innerText();
    const tr = await page.locator('[data-testid="forge-tmd-TR"]').innerText();
    expect(k).toMatch(/k_a/);
    expect(tr).toMatch(/TR_peak/);
  });

  test('09 menu route fires tmd workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseTMDWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.tmd' } }));
    });
    await page.waitForSelector('[data-testid="forge-tmd-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
