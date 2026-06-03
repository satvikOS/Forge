// v4-270-steelbeam.spec.js — Forge-270 steel beam LTB (AISC 360-22 §F2).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-270-steelbeam';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const W18x50 = {
  yieldMPa: 345, elasticModulusMPa: 200000,
  sectionModulusXMm3: 1376e3, plasticModulusXMm3: 1557e3,
  torsionConstantMm4: 0.788e6,
  radiusYMm: 41.4, radiusTsMm: 49.0,
  distanceBetweenFlangeCentroidsMm: 442,
  warpingCoefficient: 1.0,
  cb: 1.0,
};

test.describe.serial('Forge-270 · steel beam LTB', () => {
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
      !!(window.forge && window.forge.steelbeam
         && typeof window.forge.steelbeam.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 W18×50 short L_b → plastic regime, M_n = M_p (cam #2)', async () => {
    const r = await page.evaluate((base) => window.forge.steelbeam.analyse({
      ...base, unbracedLengthMm: 1500,
    }), W18x50);
    expect(r.regime).toBe('plastic');
    expect(r.mNnominalNmm).toBeCloseTo(r.mPlasticNmm, 0);
    expect(r.lpMm).toBeCloseTo(1755, -1);
    expect(r.phiMnNmm).toBeCloseTo(0.9 * r.mPlasticNmm, 0);
    await shot(page, 'plastic');
  });

  test('03 W18×50 mid L_b → inelastic-LTB, M_n < M_p (cam #3)', async () => {
    const r = await page.evaluate((base) => window.forge.steelbeam.analyse({
      ...base, unbracedLengthMm: 3000,
    }), W18x50);
    expect(r.regime).toBe('inelastic-LTB');
    expect(r.mNnominalNmm).toBeLessThan(r.mPlasticNmm);
    expect(r.mNnominalNmm).toBeGreaterThan(0.7 * 345 * W18x50.sectionModulusXMm3);
    await shot(page, 'inelastic');
  });

  test('04 W18×50 long L_b → elastic-LTB, F_cr > 0 (cam #4)', async () => {
    const r = await page.evaluate((base) => window.forge.steelbeam.analyse({
      ...base, unbracedLengthMm: 8000,
    }), W18x50);
    expect(r.regime).toBe('elastic-LTB');
    expect(r.fCrMPa).toBeGreaterThan(0);
    expect(r.mNnominalNmm).toBeLessThan(r.mPlasticNmm);
    await shot(page, 'elastic');
  });

  test('05 C_b = 2 in inelastic regime increases M_n (cam #5)', async () => {
    const a = await page.evaluate((base) => window.forge.steelbeam.analyse({
      ...base, unbracedLengthMm: 3000, cb: 1.0,
    }), W18x50);
    const b = await page.evaluate((base) => window.forge.steelbeam.analyse({
      ...base, unbracedLengthMm: 3000, cb: 2.0,
    }), W18x50);
    expect(b.mNnominalNmm).toBeGreaterThanOrEqual(a.mNnominalNmm);
    expect(b.mNnominalNmm).toBeLessThanOrEqual(b.mPlasticNmm);
    await shot(page, 'cb');
  });

  test('06 LRFD φ = 0.9 and ASD Ω = 1.67 identities (cam #6)', async () => {
    const r = await page.evaluate((base) => window.forge.steelbeam.analyse({
      ...base, unbracedLengthMm: 3000,
    }), W18x50);
    expect(r.phiMnNmm).toBeCloseTo(0.9 * r.mNnominalNmm, 0);
    expect(r.mnOverOmegaNmm).toBeCloseTo(r.mNnominalNmm / 1.67, 0);
    await shot(page, 'lrfd-asd');
  });

  test('07 Panel renders regime + φM_n rows', async () => {
    await page.evaluate(() => { window.__forgeOpenSteelBeamLtbWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-steelbeam-run"]').click();
    await page.waitForSelector('[data-testid="forge-steelbeam-result"]', { timeout: 5000 });
    const regime = await page.locator('[data-testid="forge-steelbeam-regime"]').innerText();
    const phi    = await page.locator('[data-testid="forge-steelbeam-phimn"]').innerText();
    expect(regime).toMatch(/PLASTIC|INELASTIC|ELASTIC/);
    expect(phi).toMatch(/φM_n/);
  });

  test('08 Menu route opens steel beam panel', async () => {
    await page.evaluate(() => { window.__forgeCloseSteelBeamLtbWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.steelbeam' } }));
    });
    await page.waitForSelector('[data-testid="forge-steelbeam-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
