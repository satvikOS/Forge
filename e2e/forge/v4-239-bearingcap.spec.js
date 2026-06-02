// v4-239-bearingcap.spec.js — Forge-239 soil bearing capacity (Meyerhof).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-239-bearingcap';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-239 · soil bearing capacity (Terzaghi + Meyerhof)', () => {
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
      !!(window.forge && window.forge.bearingcap
         && typeof window.forge.bearingcap.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Das textbook strip footing: q_ult ≈ 1.11 MPa (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.bearingcap.analyse({
      shape: 'strip', widthM: 1.5, depthM: 1.0,
      cohesionPa: 30000, surchargeKnPerM3: 18000,
      frictionAngleDeg: 25, factorOfSafety: 3,
    }));
    // Meyerhof at φ=25°: N_q ≈ 10.66, N_c ≈ 20.72, N_γ ≈ 6.77
    expect(r.Nq).toBeCloseTo(10.66, 1);
    expect(r.Nc).toBeCloseTo(20.72, 1);
    expect(r.Ngamma).toBeCloseTo(6.77, 1);
    expect(r.ultimateBearingPa / 1e3).toBeCloseTo(1110, -1);  // ±10 kPa
    expect(r.allowableBearingPa / 1e3).toBeCloseTo(370, -1);
    await shot(page, 'das-strip');
  });

  test('03 φ = 0 limit: N_c = 5.14, N_q = 1, N_γ = 0 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.bearingcap.analyse({
      shape: 'strip', widthM: 1.5, depthM: 1.0,
      cohesionPa: 30000, surchargeKnPerM3: 18000,
      frictionAngleDeg: 0, factorOfSafety: 3,
    }));
    expect(r.Nc).toBeCloseTo(5.14, 3);
    expect(r.Nq).toBeCloseTo(1.0, 6);
    expect(r.Ngamma).toBeCloseTo(0.0, 6);
    await shot(page, 'phi-zero');
  });

  test('04 square footing applies shape factors (cam #3)', async () => {
    const strip = await page.evaluate(() => window.forge.bearingcap.analyse({
      shape: 'strip', widthM: 1.5, depthM: 1.0,
      cohesionPa: 30000, surchargeKnPerM3: 18000,
      frictionAngleDeg: 25, factorOfSafety: 3,
    }));
    const square = await page.evaluate(() => window.forge.bearingcap.analyse({
      shape: 'square', widthM: 1.5, depthM: 1.0,
      cohesionPa: 30000, surchargeKnPerM3: 18000,
      frictionAngleDeg: 25, factorOfSafety: 3,
    }));
    expect(strip.shapeFactorC).toBe(1);
    expect(square.shapeFactorC).toBeGreaterThan(1);
    expect(square.shapeFactorGamma).toBeCloseTo(0.6, 9);
    await shot(page, 'square');
  });

  test('05 circular ≡ square shape factors (cam #4)', async () => {
    const square = await page.evaluate(() => window.forge.bearingcap.analyse({
      shape: 'square', widthM: 1.5, depthM: 1.0,
      cohesionPa: 30000, surchargeKnPerM3: 18000,
      frictionAngleDeg: 25, factorOfSafety: 3,
    }));
    const circular = await page.evaluate(() => window.forge.bearingcap.analyse({
      shape: 'circular', widthM: 1.5, depthM: 1.0,
      cohesionPa: 30000, surchargeKnPerM3: 18000,
      frictionAngleDeg: 25, factorOfSafety: 3,
    }));
    expect(circular.shapeFactorC).toBeCloseTo(square.shapeFactorC, 9);
    expect(circular.shapeFactorGamma).toBeCloseTo(square.shapeFactorGamma, 9);
    await shot(page, 'circular');
  });

  test('06 FS linear: doubling FS halves q_allow', async () => {
    const r1 = await page.evaluate(() => window.forge.bearingcap.analyse({
      shape: 'strip', widthM: 1.5, depthM: 1.0,
      cohesionPa: 30000, surchargeKnPerM3: 18000,
      frictionAngleDeg: 25, factorOfSafety: 3,
    }));
    const r2 = await page.evaluate(() => window.forge.bearingcap.analyse({
      shape: 'strip', widthM: 1.5, depthM: 1.0,
      cohesionPa: 30000, surchargeKnPerM3: 18000,
      frictionAngleDeg: 25, factorOfSafety: 6,
    }));
    expect(r2.allowableBearingPa).toBeCloseTo(0.5 * r1.allowableBearingPa, 3);
    expect(r2.ultimateBearingPa).toBeCloseTo(r1.ultimateBearingPa, 6);
  });

  test('07 panel renders q_ult + q_allow (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenBearingCapWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-bearingcap-run"]').click();
    await page.waitForSelector('[data-testid="forge-bearingcap-result"]', { timeout: 5000 });
    const qa = await page.locator('[data-testid="forge-bearingcap-qa"]').innerText();
    expect(qa).toMatch(/q_allow/);
    expect(qa).toMatch(/kPa/);
    await shot(page, 'panel');
  });

  test('08 menu route fires bearingcap workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseBearingCapWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.bearingcap' } }));
    });
    await page.waitForSelector('[data-testid="forge-bearingcap-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
