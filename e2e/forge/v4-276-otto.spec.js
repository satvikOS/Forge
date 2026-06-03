// v4-276-otto.spec.js — Forge-276 air-standard Otto cycle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-276-otto';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const CENGEL = {
  compressionRatio: 8, intakeTemperatureK: 290, intakePressureKPa: 95,
  peakTemperatureK: 1781, specificHeatRatio: 1.4,
};

test.describe.serial('Forge-276 · Otto cycle', () => {
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
      !!(window.forge && window.forge.otto
         && typeof window.forge.otto.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Cengel Ex. 9-2: r=8, T_1=290, T_3=1781 → η=56.5% (cam #2)', async () => {
    const r = await page.evaluate((c) => window.forge.otto.analyse(c), CENGEL);
    expect(r.cVKJkgK).toBeCloseTo(0.7175, 3);
    expect(r.t2K).toBeCloseTo(290 * Math.pow(8, 0.4), 4);
    expect(r.t4K).toBeCloseTo(1781 / Math.pow(8, 0.4), 4);
    expect(r.thermalEfficiency).toBeCloseTo(1 - Math.pow(8, -0.4), 9);
    expect(r.wNetKJkg).toBeCloseTo(r.qInKJkg - r.qOutKJkg, 6);
    await shot(page, 'cengel');
  });

  test('03 Higher compression r=12 raises η (cam #3)', async () => {
    const r8  = await page.evaluate((c) => window.forge.otto.analyse(c), CENGEL);
    const r12 = await page.evaluate((c) => window.forge.otto.analyse({
      ...c, compressionRatio: 12, peakTemperatureK: 2200,
    }), CENGEL);
    expect(r12.thermalEfficiency).toBeGreaterThan(r8.thermalEfficiency);
    expect(r12.thermalEfficiency).toBeCloseTo(1 - Math.pow(12, -0.4), 9);
    await shot(page, 'r12');
  });

  test('04 η identity matches w_net/q_in (cam #4)', async () => {
    const r = await page.evaluate((c) => window.forge.otto.analyse(c), CENGEL);
    expect(r.thermalEfficiency).toBeCloseTo(r.wNetKJkg / r.qInKJkg, 6);
    await shot(page, 'eta-identity');
  });

  test('05 Monatomic γ=1.667 follows η formula (cam #5)', async () => {
    const r = await page.evaluate((c) => window.forge.otto.analyse({
      ...c, specificHeatRatio: 1.667, peakTemperatureK: 2000,
    }), CENGEL);
    expect(r.thermalEfficiency).toBeCloseTo(1 - Math.pow(8, -0.667), 9);
    await shot(page, 'monatomic');
  });

  test('06 r ≤ 1 throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((c) => window.forge.otto.analyse({ ...c, compressionRatio: 0.5 }), CENGEL);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'throw-r');
  });

  test('07 Panel renders η + MEP rows', async () => {
    await page.evaluate(() => { window.__forgeOpenOttoCycleWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-otto-run"]').click();
    await page.waitForSelector('[data-testid="forge-otto-result"]', { timeout: 5000 });
    const eta = await page.locator('[data-testid="forge-otto-eta"]').innerText();
    const mep = await page.locator('[data-testid="forge-otto-mep"]').innerText();
    expect(eta).toMatch(/η_th/);
    expect(mep).toMatch(/MEP/);
  });

  test('08 Menu route opens Otto cycle panel', async () => {
    await page.evaluate(() => { window.__forgeCloseOttoCycleWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.otto' } }));
    });
    await page.waitForSelector('[data-testid="forge-otto-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
