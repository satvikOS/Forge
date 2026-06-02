// v4-216-beam.spec.js — Forge-216 beam deflection calculator.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-216-beam';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-216 · beam deflection', () => {
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
      !!(window.forge && window.forge.beam
         && typeof window.forge.beam.solve === 'function'));
    expect(has).toBe(true);
  });

  test('02 cantilever-point closed form (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.beam.solve({
      config: 'cantilever-point', length: 1.0, load: 100,
      youngsModulus: 1000, secondMomentI: 1.0,
    }));
    expect(r.deflectionMax).toBeCloseTo(100 / 3000, 12);
    expect(r.slopeMax).toBeCloseTo(0.05, 12);
    expect(r.momentMax).toBeCloseTo(100, 12);
    await shot(page, 'cantilever-point');
  });

  test('03 cantilever-UDL closed form (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.beam.solve({
      config: 'cantilever-udl', length: 1.0, load: 10,
      youngsModulus: 1000, secondMomentI: 1.0,
    }));
    expect(r.deflectionMax).toBeCloseTo(10 / 8000, 12);
    expect(r.momentMax).toBeCloseTo(5, 12);
    await shot(page, 'cantilever-udl');
  });

  test('04 SS-UDL closed form (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.beam.solve({
      config: 'ss-udl', length: 1.0, load: 10,
      youngsModulus: 1000, secondMomentI: 1.0,
    }));
    expect(r.deflectionMax).toBeCloseTo(5 * 10 / 384000, 12);
    expect(r.momentMax).toBeCloseTo(10 / 8, 12);
    await shot(page, 'ss-udl');
  });

  test('05 fixed-fixed is 5× stiffer than SS-UDL (cam #4)', async () => {
    const r = await page.evaluate(() => {
      const ss = window.forge.beam.solve({
        config: 'ss-udl', length: 1.0, load: 10,
        youngsModulus: 1000, secondMomentI: 1.0,
      });
      const ff = window.forge.beam.solve({
        config: 'ff-udl', length: 1.0, load: 10,
        youngsModulus: 1000, secondMomentI: 1.0,
      });
      return { ratio: ss.deflectionMax / ff.deflectionMax };
    });
    expect(r.ratio).toBeCloseTo(5, 9);
    await shot(page, 'ff-vs-ss');
  });

  test('06 panel solve renders result card (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenBeamWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-beam-run"]').click();
    await page.waitForSelector('[data-testid="forge-beam-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-beam-result"]').innerText();
    expect(text).toMatch(/δ_max/);
    expect(text).toMatch(/M_max/);
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
