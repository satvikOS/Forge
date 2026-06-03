// v4-271-anchorshear.spec.js — Forge-271 anchor bolt shear (ACI 318-19 §17.7).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-271-anchorshear';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const BASE = {
  effectiveShearAreaMm2: 283, steelUltimateMPa: 830, steelYieldMPa: 660,
  anchorDiameterMm: 19.05, loadBearingLengthMm: 150,
  concreteStrengthMPa: 30, edgeDistanceCa1Mm: 150, edgeDistanceCa2Mm: 1000,
  memberThicknessHaMm: 300, lambdaLightweight: 1.0, crackedConcrete: true,
};

test.describe.serial('Forge-271 · anchor bolt shear capacity', () => {
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

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.anchorshear
         && typeof window.forge.anchorshear.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Reference c_a1=150 mm → breakout governs (cam #2)', async () => {
    const r = await page.evaluate((base) => window.forge.anchorshear.analyse(base), BASE);
    expect(r.cappedFutaMPa).toBeCloseTo(830, 1);
    expect(r.steelNominalN).toBeCloseTo(0.6 * 283 * 830, 0);
    expect(r.aVcMm2).toBeCloseTo(r.aVcoMm2, 0);
    expect(r.psiEdV).toBeCloseTo(1.0, 9);
    expect(r.psiHV).toBeCloseTo(1.0, 9);
    expect(r.governingMode).toBe('breakout');
    await shot(page, 'reference');
  });

  test('03 c_a1 ∝ 1.5 power scaling (cam #3)', async () => {
    const small = await page.evaluate((base) => window.forge.anchorshear.analyse(base), BASE);
    const big   = await page.evaluate((base) => window.forge.anchorshear.analyse({
      ...base, edgeDistanceCa1Mm: 600, memberThicknessHaMm: 1000,
    }), BASE);
    expect(big.vBN / small.vBN).toBeCloseTo(Math.pow(600/150, 1.5), 5);
    expect(big.governingMode).toBe('steel');  // breakout grew enough
    await shot(page, 'c-a1-scale');
  });

  test('04 Close c_a2 reduces ψ_ed,V (cam #4)', async () => {
    const r = await page.evaluate((base) => window.forge.anchorshear.analyse({
      ...base, edgeDistanceCa2Mm: 100,
    }), BASE);
    expect(r.psiEdV).toBeCloseTo(0.7 + 0.3 * 100 / 225, 6);
    expect(r.breakoutNominalN).toBeLessThan(0.6 * 283 * 830);  // Sanity
    await shot(page, 'edge-perp');
  });

  test('05 Thin slab triggers A_Vc reduction + ψ_h,V boost (cam #5)', async () => {
    const r = await page.evaluate((base) => window.forge.anchorshear.analyse({
      ...base, memberThicknessHaMm: 150,
    }), BASE);
    expect(r.aVcMm2).toBeLessThan(r.aVcoMm2);
    expect(r.psiHV).toBeGreaterThan(1.0);
    expect(r.psiHV).toBeCloseTo(Math.sqrt(225/150), 6);
    await shot(page, 'thin-slab');
  });

  test('06 Uncracked: +40% breakout (cam #6)', async () => {
    const cracked = await page.evaluate((base) => window.forge.anchorshear.analyse(base), BASE);
    const un      = await page.evaluate((base) => window.forge.anchorshear.analyse({
      ...base, crackedConcrete: false,
    }), BASE);
    expect(un.breakoutNominalN / cracked.breakoutNominalN).toBeCloseTo(1.4, 6);
    expect(un.psiCV).toBeCloseTo(1.4, 9);
    await shot(page, 'uncracked');
  });

  test('07 Panel renders φV_n + Governs rows', async () => {
    await page.evaluate(() => { window.__forgeOpenAnchorShearWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-anchorshear-run"]').click();
    await page.waitForSelector('[data-testid="forge-anchorshear-result"]', { timeout: 5000 });
    const gov  = await page.locator('[data-testid="forge-anchorshear-governing"]').innerText();
    const mode = await page.locator('[data-testid="forge-anchorshear-mode"]').innerText();
    expect(gov).toMatch(/φV_n/);
    expect(mode).toMatch(/Governs/);
  });

  test('08 Menu route opens anchor shear panel', async () => {
    await page.evaluate(() => { window.__forgeCloseAnchorShearWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.anchorshear' } }));
    });
    await page.waitForSelector('[data-testid="forge-anchorshear-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
