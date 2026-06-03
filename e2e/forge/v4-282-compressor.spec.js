// v4-282-compressor.spec.js — Forge-282 reciprocating compressor sizing.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-282-compressor';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const AIR = {
  inletPressurePa: 1e5, inletTemperatureK: 300,
  dischargePressurePa: 8e5, massFlowKgS: 0.5,
  polytropicIndexN: 1.35, polytropicEfficiency: 0.80,
  clearanceRatioC: 0.05, gasConstantJkgK: 287,
};

test.describe.serial('Forge-282 · reciprocating compressor', () => {
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
      !!(window.forge && window.forge.compressor
         && typeof window.forge.compressor.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Air 8:1 polytropic n=1.35: T_2 + H_p + η_v + P (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.compressor.analyse(b), AIR);
    expect(r.pressureRatio).toBeCloseTo(8, 9);
    expect(r.dischargeTemperatureK).toBeCloseTo(300 * Math.pow(8, 0.35/1.35), 4);
    expect(r.polytropicHeadJkg).toBeCloseTo(
      (1.35/0.35) * 287 * 300 * (Math.pow(8, 0.35/1.35) - 1), 1
    );
    expect(r.volumetricEfficiency).toBeCloseTo(
      1.05 - 0.05 * Math.pow(8, 1/1.35), 6
    );
    expect(r.brakePowerW).toBeCloseTo(
      0.5 * r.polytropicHeadJkg / 0.80, 1
    );
    await shot(page, 'reference');
  });

  test('03 Isentropic n=1.4 raises T_2 + H_p vs polytropic (cam #3)', async () => {
    const poly = await page.evaluate((b) => window.forge.compressor.analyse(b), AIR);
    const isen = await page.evaluate((b) => window.forge.compressor.analyse({
      ...b, polytropicIndexN: 1.4,
    }), AIR);
    expect(isen.dischargeTemperatureK).toBeGreaterThan(poly.dischargeTemperatureK);
    expect(isen.polytropicHeadJkg).toBeGreaterThan(poly.polytropicHeadJkg);
    await shot(page, 'isentropic');
  });

  test('04 Isothermal n=1 limit: ΔT=0, H = R·T·ln π (cam #4)', async () => {
    const r = await page.evaluate((b) => window.forge.compressor.analyse({
      ...b, polytropicIndexN: 1.0,
    }), AIR);
    expect(r.temperatureRiseK).toBeCloseTo(0, 9);
    expect(r.polytropicHeadJkg).toBeCloseTo(287 * 300 * Math.log(8), 3);
    expect(r.polytropicHeadJkg).toBeCloseTo(r.isothermalEquivalentHeadJkg, 9);
    await shot(page, 'isothermal');
  });

  test('05 Higher π drops η_v (re-expansion losses) (cam #5)', async () => {
    const lo = await page.evaluate((b) => window.forge.compressor.analyse(b), AIR);
    const hi = await page.evaluate((b) => window.forge.compressor.analyse({
      ...b, dischargePressurePa: 20e5,
    }), AIR);
    expect(hi.volumetricEfficiency).toBeLessThan(lo.volumetricEfficiency);
    expect(hi.temperatureRiseK).toBeGreaterThan(lo.temperatureRiseK);
    await shot(page, 'high-pi');
  });

  test('06 p_2 ≤ p_1 throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((b) => window.forge.compressor.analyse({
        ...b, dischargePressurePa: 5e4,
      }), AIR);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'throw');
  });

  test('07 Panel renders η_v + P_brake rows', async () => {
    await page.evaluate(() => { window.__forgeOpenReciprocatingCompressorWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-compressor-run"]').click();
    await page.waitForSelector('[data-testid="forge-compressor-result"]', { timeout: 5000 });
    const ev = await page.locator('[data-testid="forge-compressor-etav"]').innerText();
    const P  = await page.locator('[data-testid="forge-compressor-P"]').innerText();
    expect(ev).toMatch(/η_v/);
    expect(P).toMatch(/P_brake/);
  });

  test('08 Menu route opens compressor panel', async () => {
    await page.evaluate(() => { window.__forgeCloseReciprocatingCompressorWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.compressor' } }));
    });
    await page.waitForSelector('[data-testid="forge-compressor-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
