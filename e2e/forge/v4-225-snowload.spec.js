// v4-225-snowload.spec.js — Forge-225 Snow load (ASCE 7).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-225-snowload';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-225 · snow load (ASCE 7)', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.snowload
         && typeof window.forge.snowload.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 flat roof formula 0.7·C_e·C_t·I_s·p_g (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.snowload.analyse({
      groundSnowPa: 1500, exposure: 'partially', thermal: 'heated',
      risk: 'II', slopeDeg: 0,
    }));
    expect(r.flatRoofPa).toBeCloseTo(0.7 * 1.0 * 1.0 * 1.0 * 1500, 9);
    expect(r.slopeFactor).toBeCloseTo(1.0, 12);
    expect(r.slopedRoofPa).toBeCloseTo(r.flatRoofPa, 12);
    await shot(page, 'flat');
  });

  test('03 C_s warm roof piecewise (cam #2)', async () => {
    const r = await page.evaluate(() => ({
      at20:  window.forge.snowload.analyse({ groundSnowPa: 1000, exposure: 'partially', thermal: 'heated', risk: 'II', slopeDeg: 20 }).slopeFactor,
      at50:  window.forge.snowload.analyse({ groundSnowPa: 1000, exposure: 'partially', thermal: 'heated', risk: 'II', slopeDeg: 50 }).slopeFactor,
      at70:  window.forge.snowload.analyse({ groundSnowPa: 1000, exposure: 'partially', thermal: 'heated', risk: 'II', slopeDeg: 70 }).slopeFactor,
    }));
    expect(r.at20).toBeCloseTo(1.0, 12);
    expect(r.at50).toBeCloseTo(0.5, 12);
    expect(r.at70).toBeCloseTo(0.0, 12);
    await shot(page, 'cs-warm');
  });

  test('04 cold roof breakpoint shifts to 45°/70° (cam #3)', async () => {
    const r = await page.evaluate(() => ({
      warm40: window.forge.snowload.analyse({ groundSnowPa: 1000, exposure: 'partially', thermal: 'heated',   risk: 'II', slopeDeg: 40 }).slopeFactor,
      cold40: window.forge.snowload.analyse({ groundSnowPa: 1000, exposure: 'partially', thermal: 'unheated', risk: 'II', slopeDeg: 40 }).slopeFactor,
    }));
    expect(r.warm40).toBeCloseTo(0.75, 12);
    expect(r.cold40).toBeCloseTo(1.0,  12);
    await shot(page, 'cs-cold');
  });

  test('05 risk + exposure multiply (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.snowload.analyse({
      groundSnowPa: 1500, exposure: 'sheltered', thermal: 'unheated',
      risk: 'IV', slopeDeg: 0,
    }));
    expect(r.flatRoofPa).toBeCloseTo(0.7 * 1.2 * 1.2 * 1.2 * 1500, 9);
    await shot(page, 'sheltered-unheated');
  });

  test('06 panel compute renders p_f/C_s/p_s (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenSnowLoadWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-snowload-run"]').click();
    await page.waitForSelector('[data-testid="forge-snowload-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-snowload-result"]').innerText();
    expect(text).toMatch(/p_f/);
    expect(text).toMatch(/C_s/);
    expect(text).toMatch(/p_s/);
    await shot(page, 'panel');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
