// v4-261-fin.spec.js — Forge-261 fin efficiency.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-261-fin';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-261 · fin efficiency', () => {
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
      !!(window.forge && window.forge.fin
         && typeof window.forge.fin.rectangular === 'function'
         && typeof window.forge.fin.pin === 'function'));
    expect(has).toBe(true);
  });

  test('02 Rectangular textbook: η_f ≈ 0.849, q_f ≈ 89 W (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.fin.rectangular({
      heightM: 0.05, thicknessM: 0.005, widthM: 0.1,
      thermalConductivity: 200, convectionH: 100, temperatureDiffK: 100,
    }));
    expect(r.parameter_m).toBeCloseTo(14.142, 1);
    expect(r.correctedLength).toBeCloseTo(0.0525, 4);
    expect(r.finEfficiency).toBeCloseTo(0.849, 2);
    expect(r.heatRateW).toBeCloseTo(89.1, 0);
    expect(r.finEffectiveness).toBeCloseTo(17.8, 0);
    await shot(page, 'rect');
  });

  test('03 Pin textbook: η_f ≈ 0.753 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.fin.pin({
      lengthM: 0.05, diameterM: 0.005,
      thermalConductivity: 200, convectionH: 100, temperatureDiffK: 100,
    }));
    expect(r.parameter_m).toBeCloseTo(20, 1);
    expect(r.finEfficiency).toBeCloseTo(0.753, 2);
    expect(r.heatRateW).toBeCloseTo(6.06, 1);
    await shot(page, 'pin');
  });

  test('04 thicker fin → lower m → higher η_f (cam #3)', async () => {
    const thin = await page.evaluate(() => window.forge.fin.rectangular({
      heightM: 0.05, thicknessM: 0.005, widthM: 0.1,
      thermalConductivity: 200, convectionH: 100, temperatureDiffK: 100,
    }));
    const thick = await page.evaluate(() => window.forge.fin.rectangular({
      heightM: 0.05, thicknessM: 0.01, widthM: 0.1,
      thermalConductivity: 200, convectionH: 100, temperatureDiffK: 100,
    }));
    expect(thick.parameter_m).toBeLessThan(thin.parameter_m);
    expect(thick.finEfficiency).toBeGreaterThan(thin.finEfficiency);
    await shot(page, 'thick');
  });

  test('05 q_f linear in ΔT (cam #4)', async () => {
    const r50 = await page.evaluate(() => window.forge.fin.rectangular({
      heightM: 0.05, thicknessM: 0.005, widthM: 0.1,
      thermalConductivity: 200, convectionH: 100, temperatureDiffK: 50,
    }));
    const r100 = await page.evaluate(() => window.forge.fin.rectangular({
      heightM: 0.05, thicknessM: 0.005, widthM: 0.1,
      thermalConductivity: 200, convectionH: 100, temperatureDiffK: 100,
    }));
    expect(r100.heatRateW / r50.heatRateW).toBeCloseTo(2.0, 6);
    expect(r100.finEfficiency).toBeCloseTo(r50.finEfficiency, 9);
    await shot(page, 'dT-scale');
  });

  test('06 higher h → lower η_f (cam #5)', async () => {
    const lowH = await page.evaluate(() => window.forge.fin.rectangular({
      heightM: 0.05, thicknessM: 0.005, widthM: 0.1,
      thermalConductivity: 200, convectionH: 50, temperatureDiffK: 100,
    }));
    const highH = await page.evaluate(() => window.forge.fin.rectangular({
      heightM: 0.05, thicknessM: 0.005, widthM: 0.1,
      thermalConductivity: 200, convectionH: 200, temperatureDiffK: 100,
    }));
    expect(highH.finEfficiency).toBeLessThan(lowH.finEfficiency);
    await shot(page, 'h-effect');
  });

  test('07 zero L throws', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.fin.rectangular({
        heightM: 0, thicknessM: 0.005, widthM: 0.1,
        thermalConductivity: 200, convectionH: 100, temperatureDiffK: 100,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel tab-switch renders η_f + q_f rows', async () => {
    await page.evaluate(() => { window.__forgeOpenFinWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-fin-run"]').click();
    await page.waitForSelector('[data-testid="forge-fin-eta"]', { timeout: 5000 });
    await page.locator('[data-testid="forge-fin-tab-pin"]').click();
    await page.locator('[data-testid="forge-fin-run"]').click();
    await page.waitForSelector('[data-testid="forge-fin-q"]', { timeout: 5000 });
    const q = await page.locator('[data-testid="forge-fin-q"]').innerText();
    expect(q).toMatch(/q_f/);
  });

  test('09 menu route fires fin workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseFinWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.fin' } }));
    });
    await page.waitForSelector('[data-testid="forge-fin-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
