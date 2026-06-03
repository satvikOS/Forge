// v4-278-brayton.spec.js — Forge-278 air-standard Brayton cycle.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-278-brayton';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const IDEAL = {
  pressureRatio: 8, intakeTemperatureK: 300, intakePressureKPa: 100,
  turbineInletTemperatureK: 1300, specificHeatRatio: 1.4,
  compressorIsentropicEff: 1.0, turbineIsentropicEff: 1.0,
};

test.describe.serial('Forge-278 · Brayton cycle', () => {
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
      !!(window.forge && window.forge.brayton
         && typeof window.forge.brayton.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Cengel Ex. 9-5 ideal: r_p=8, T_3=1300 → η=44.8% (cam #2)', async () => {
    const r = await page.evaluate((c) => window.forge.brayton.analyse(c), IDEAL);
    const exp = 0.4 / 1.4;
    expect(r.t2K).toBeCloseTo(300 * Math.pow(8, exp), 4);
    expect(r.t4K).toBeCloseTo(1300 * Math.pow(8, -exp), 4);
    expect(r.thermalEfficiency).toBeCloseTo(1 - Math.pow(8, -exp), 9);
    expect(r.backWorkRatio).toBeGreaterThan(0.3);
    expect(r.backWorkRatio).toBeLessThan(0.5);
    await shot(page, 'ideal');
  });

  test('03 Non-ideal η_c=0.8, η_t=0.85 reduces η + raises BWR (cam #3)', async () => {
    const id = await page.evaluate((c) => window.forge.brayton.analyse(c), IDEAL);
    const re = await page.evaluate((c) => window.forge.brayton.analyse({
      ...c, compressorIsentropicEff: 0.8, turbineIsentropicEff: 0.85,
    }), IDEAL);
    expect(re.t2K).toBeGreaterThan(id.t2K);
    expect(re.t4K).toBeGreaterThan(id.t4K);
    expect(re.thermalEfficiency).toBeLessThan(id.thermalEfficiency);
    expect(re.backWorkRatio).toBeGreaterThan(id.backWorkRatio);
    await shot(page, 'real');
  });

  test('04 Higher r_p raises ideal η (cam #4)', async () => {
    const r8  = await page.evaluate((c) => window.forge.brayton.analyse(c), IDEAL);
    const r16 = await page.evaluate((c) => window.forge.brayton.analyse({
      ...c, pressureRatio: 16,
    }), IDEAL);
    expect(r16.thermalEfficiency).toBeGreaterThan(r8.thermalEfficiency);
    expect(r16.thermalEfficiency).toBeCloseTo(1 - Math.pow(16, -0.4/1.4), 9);
    await shot(page, 'rp16');
  });

  test('05 r_p ≤ 1 throws (cam #5)', async () => {
    let threw = false;
    try {
      await page.evaluate((c) => window.forge.brayton.analyse({
        ...c, pressureRatio: 0.5,
      }), IDEAL);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'throw-rp');
  });

  test('06 T_3 ≤ T_2 throws (no combustion possible) (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((c) => window.forge.brayton.analyse({
        ...c, turbineInletTemperatureK: 500,  // < T_2 ≈ 543
      }), IDEAL);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'throw-T3');
  });

  test('07 Panel renders η + BWR rows', async () => {
    await page.evaluate(() => { window.__forgeOpenBraytonCycleWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-brayton-run"]').click();
    await page.waitForSelector('[data-testid="forge-brayton-result"]', { timeout: 5000 });
    const eta = await page.locator('[data-testid="forge-brayton-eta"]').innerText();
    const bwr = await page.locator('[data-testid="forge-brayton-bwr"]').innerText();
    expect(eta).toMatch(/η_th/);
    expect(bwr).toMatch(/BWR/);
  });

  test('08 Menu route opens Brayton panel', async () => {
    await page.evaluate(() => { window.__forgeCloseBraytonCycleWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.brayton' } }));
    });
    await page.waitForSelector('[data-testid="forge-brayton-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
