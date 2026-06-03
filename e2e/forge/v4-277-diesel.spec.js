// v4-277-diesel.spec.js — Forge-277 air-standard Diesel cycle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-277-diesel';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const CENGEL = {
  compressionRatio: 18, cutoffRatio: 2,
  intakeTemperatureK: 300, intakePressureKPa: 100,
  specificHeatRatio: 1.4,
};

test.describe.serial('Forge-277 · Diesel cycle', () => {
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
      !!(window.forge && window.forge.diesel
         && typeof window.forge.diesel.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Cengel Ex. 9-3: r=18, r_c=2 → η=63.2% (cam #2)', async () => {
    const r = await page.evaluate((c) => window.forge.diesel.analyse(c), CENGEL);
    const eta_exp = 1 - (1 / Math.pow(18, 0.4))
                      * (Math.pow(2, 1.4) - 1) / (1.4 * (2 - 1));
    expect(r.thermalEfficiency).toBeCloseTo(eta_exp, 9);
    expect(r.t2K).toBeCloseTo(300 * Math.pow(18, 0.4), 4);
    expect(r.t3K).toBeCloseTo(r.t2K * 2, 4);
    expect(r.p3KPa).toBeCloseTo(r.p2KPa, 6);
    await shot(page, 'cengel');
  });

  test('03 r_c=1 collapses to Otto efficiency (cam #3)', async () => {
    const d = await page.evaluate((c) => window.forge.diesel.analyse({
      ...c, compressionRatio: 8, cutoffRatio: 1.0,
      intakeTemperatureK: 290, intakePressureKPa: 95,
    }), CENGEL);
    const o = await page.evaluate(() => window.forge.otto.analyse({
      compressionRatio: 8, intakeTemperatureK: 290, intakePressureKPa: 95,
      peakTemperatureK: 290 * Math.pow(8, 0.4) + 100, specificHeatRatio: 1.4,
    }));
    expect(d.thermalEfficiency).toBeCloseTo(o.thermalEfficiency, 9);
    await shot(page, 'otto-limit');
  });

  test('04 Higher r_c at fixed r → lower η (cam #4)', async () => {
    const low  = await page.evaluate((c) => window.forge.diesel.analyse({
      ...c, cutoffRatio: 1.5,
    }), CENGEL);
    const high = await page.evaluate((c) => window.forge.diesel.analyse({
      ...c, cutoffRatio: 3.0,
    }), CENGEL);
    expect(low.thermalEfficiency).toBeGreaterThan(high.thermalEfficiency);
    await shot(page, 'rc-effect');
  });

  test('05 Higher r raises η (cam #5)', async () => {
    const r12 = await page.evaluate((c) => window.forge.diesel.analyse({
      ...c, compressionRatio: 12,
    }), CENGEL);
    const r24 = await page.evaluate((c) => window.forge.diesel.analyse({
      ...c, compressionRatio: 24,
    }), CENGEL);
    expect(r24.thermalEfficiency).toBeGreaterThan(r12.thermalEfficiency);
    await shot(page, 'r-effect');
  });

  test('06 r_c ≥ r throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((c) => window.forge.diesel.analyse({
        ...c, compressionRatio: 5, cutoffRatio: 6,
      }), CENGEL);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'throw');
  });

  test('07 Panel renders η + MEP rows', async () => {
    await page.evaluate(() => { window.__forgeOpenDieselCycleWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-diesel-run"]').click();
    await page.waitForSelector('[data-testid="forge-diesel-result"]', { timeout: 5000 });
    const eta = await page.locator('[data-testid="forge-diesel-eta"]').innerText();
    const mep = await page.locator('[data-testid="forge-diesel-mep"]').innerText();
    expect(eta).toMatch(/η_th/);
    expect(mep).toMatch(/MEP/);
  });

  test('08 Menu route opens Diesel panel', async () => {
    await page.evaluate(() => { window.__forgeCloseDieselCycleWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.diesel' } }));
    });
    await page.waitForSelector('[data-testid="forge-diesel-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
