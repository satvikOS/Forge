// v4-267-rcpunching.spec.js — Forge-267 RC slab punching shear (ACI 318-19).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-267-rcpunching';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-267 · RC slab punching shear', () => {
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
      !!(window.forge && window.forge.rcpunching
         && typeof window.forge.rcpunching.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Interior 400×400, f_c 30 MPa, d 200 mm, V_u 600 kN (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.rcpunching.analyse({
      concreteStrengthMPa: 30, effectiveDepthMm: 200,
      columnWidthMm: 400, columnDepthMm: 400, location: 'interior',
      lambdaLightweight: 1.0, factoredShearN: 600000,
    }));
    expect(r.criticalPerimeterMm).toBeCloseTo(2400, 0);
    expect(r.betaC).toBeCloseTo(1.0, 9);
    expect(r.vcMPa).toBeCloseTo(0.33 * Math.sqrt(30), 4);
    expect(r.passes).toBe(true);
    expect(r.demandCapacityRatio).toBeGreaterThan(0.9);
    expect(r.demandCapacityRatio).toBeLessThan(0.95);
    await shot(page, 'interior');
  });

  test('03 Edge column shorter b₀, fails (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.rcpunching.analyse({
      concreteStrengthMPa: 30, effectiveDepthMm: 200,
      columnWidthMm: 400, columnDepthMm: 400, location: 'edge',
      lambdaLightweight: 1.0, factoredShearN: 600000,
    }));
    expect(r.criticalPerimeterMm).toBeLessThan(2400);
    expect(r.passes).toBe(false);
    await shot(page, 'edge-fails');
  });

  test('04 Elongated column triggers vc₂ governance (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.rcpunching.analyse({
      concreteStrengthMPa: 30, effectiveDepthMm: 200,
      columnWidthMm: 200, columnDepthMm: 1200, location: 'interior',
      lambdaLightweight: 1.0, factoredShearN: 100000,
    }));
    expect(r.betaC).toBeCloseTo(6.0, 9);
    expect(r.vcMPa).toBeLessThan(r.vc1MPa);  // β_c effect governs
    expect(r.passes).toBe(true);
    await shot(page, 'elongated');
  });

  test('05 vc scales with √f_c (cam #5)', async () => {
    const r1 = await page.evaluate(() => window.forge.rcpunching.analyse({
      concreteStrengthMPa: 30, effectiveDepthMm: 200,
      columnWidthMm: 400, columnDepthMm: 400, location: 'interior',
      lambdaLightweight: 1.0, factoredShearN: 0,
    }));
    const r2 = await page.evaluate(() => window.forge.rcpunching.analyse({
      concreteStrengthMPa: 60, effectiveDepthMm: 200,
      columnWidthMm: 400, columnDepthMm: 400, location: 'interior',
      lambdaLightweight: 1.0, factoredShearN: 0,
    }));
    expect(r2.vcMPa / r1.vcMPa).toBeCloseTo(Math.sqrt(2), 3);
    await shot(page, 'sqrt-fc');
  });

  test('06 λ < 1 (lightweight) reduces vc proportionally (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.rcpunching.analyse({
      concreteStrengthMPa: 30, effectiveDepthMm: 200,
      columnWidthMm: 400, columnDepthMm: 400, location: 'interior',
      lambdaLightweight: 0.75, factoredShearN: 0,
    }));
    expect(r.vcMPa).toBeCloseTo(0.75 * 0.33 * Math.sqrt(30), 4);
    await shot(page, 'lightweight');
  });

  test('07 Panel renders v_c + DCR rows', async () => {
    await page.evaluate(() => { window.__forgeOpenRcPunchingWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-rcpunching-run"]').click();
    await page.waitForSelector('[data-testid="forge-rcpunching-result"]', { timeout: 5000 });
    const vc  = await page.locator('[data-testid="forge-rcpunching-vc"]').innerText();
    const dcr = await page.locator('[data-testid="forge-rcpunching-dcr"]').innerText();
    expect(vc).toMatch(/v_c/);
    expect(dcr).toMatch(/DCR/);
  });

  test('08 Menu route opens punching panel', async () => {
    await page.evaluate(() => { window.__forgeCloseRcPunchingWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.rcpunching' } }));
    });
    await page.waitForSelector('[data-testid="forge-rcpunching-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
