// v4-238-rcbeam.spec.js — Forge-238 RC beam flexure (ACI 318-19 §22.2).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-238-rcbeam';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-238 · RC beam flexure ACI 318-19 §22.2', () => {
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
      !!(window.forge && window.forge.rcbeam
         && typeof window.forge.rcbeam.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 PCA textbook: 300×500 mm, 3·#7 → φM_n ≈ 201.7 kN·m (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.rcbeam.analyse({
      widthM: 0.300, effectiveDepthM: 0.500, steelAreaM2: 1.161e-3,
      concreteFcPa: 28e6, steelFyPa: 414e6, steelEPa: 200e9,
    }));
    expect(r.beta1).toBeCloseTo(0.85, 9);
    expect(r.stressBlockDepthM).toBeCloseTo(0.0673, 3);
    expect(r.neutralAxisDepthM).toBeCloseTo(0.0792, 3);
    expect(r.tensionControlled).toBe(true);
    expect(r.phi).toBeCloseTo(0.90, 9);
    expect(r.nominalMomentNm / 1000).toBeCloseTo(224.2, 0);
    expect(r.designMomentNm / 1000).toBeCloseTo(201.7, 0);
    await shot(page, 'pca-textbook');
  });

  test('03 β_1 transition: f\'_c = 35 MPa → 0.80 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.rcbeam.analyse({
      widthM: 0.300, effectiveDepthM: 0.500, steelAreaM2: 1.161e-3,
      concreteFcPa: 35e6, steelFyPa: 414e6, steelEPa: 200e9,
    }));
    expect(r.beta1).toBeCloseTo(0.80, 9);
    await shot(page, 'beta1-transition');
  });

  test('04 β_1 cap: f\'_c = 70 MPa → 0.65 (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.rcbeam.analyse({
      widthM: 0.300, effectiveDepthM: 0.500, steelAreaM2: 1.161e-3,
      concreteFcPa: 70e6, steelFyPa: 414e6, steelEPa: 200e9,
    }));
    expect(r.beta1).toBeCloseTo(0.65, 9);
    await shot(page, 'beta1-cap');
  });

  test('05 compression-controlled regime when A_s is heavy (cam #4)', async () => {
    // Big A_s forces ε_t low (≤ ε_ty). Use A_s = 5·#11 ≈ 5·1006 mm² = 5.03e-3 m².
    const r = await page.evaluate(() => window.forge.rcbeam.analyse({
      widthM: 0.300, effectiveDepthM: 0.500, steelAreaM2: 5.03e-3,
      concreteFcPa: 28e6, steelFyPa: 414e6, steelEPa: 200e9,
    }));
    expect(r.tensionControlled).toBe(false);
    // φ should be < 0.90 (still ≥ 0.65); ε_t < 0.005.
    expect(r.phi).toBeLessThan(0.90);
    expect(r.phi).toBeGreaterThanOrEqual(0.65);
    expect(r.steelStrain).toBeLessThan(0.005);
    expect(r.aboveRhoMax).toBe(true);
    await shot(page, 'compression-controlled');
  });

  test('06 ρ_min flag when A_s is too small', async () => {
    const r = await page.evaluate(() => window.forge.rcbeam.analyse({
      widthM: 0.300, effectiveDepthM: 0.500, steelAreaM2: 1e-4,  // 100 mm² only
      concreteFcPa: 28e6, steelFyPa: 414e6, steelEPa: 200e9,
    }));
    expect(r.rho).toBeLessThan(r.rhoMin);
    expect(r.belowRhoMin).toBe(true);
  });

  test('07 panel renders regime + φM_n + ρ rows (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenRcBeamWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-rcbeam-run"]').click();
    await page.waitForSelector('[data-testid="forge-rcbeam-result"]', { timeout: 5000 });
    const regime = await page.locator('[data-testid="forge-rcbeam-regime"]').innerText();
    expect(regime).toMatch(/TENSION-CONTROLLED|TRANSITION|COMPRESSION/);
    const phiMn = await page.locator('[data-testid="forge-rcbeam-phiMn"]').innerText();
    expect(phiMn).toMatch(/φM_n/);
    expect(phiMn).toMatch(/kN/);
    await shot(page, 'panel');
  });

  test('08 menu route fires rcbeam workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseRcBeamWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.rcbeam' } }));
    });
    await page.waitForSelector('[data-testid="forge-rcbeam-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
