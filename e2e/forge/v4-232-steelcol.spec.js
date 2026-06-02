// v4-232-steelcol.spec.js — Forge-232 Steel column (AISC 360 §E3).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-232-steelcol';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-232 · steel column AISC 360', () => {
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
      !!(window.forge && window.forge.steelcol
         && typeof window.forge.steelcol.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 inelastic regime: W10×49 textbook (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.steelcol.analyse({
      effectiveLengthK: 1.0, unbracedLength: 4.0,
      radiusOfGyration: 0.0516, area: 9.29e-3,
      youngsModulus: 200e9, yieldStress: 250e6,
    }));
    expect(r.inelasticRegime).toBe(true);
    expect(r.slenderness).toBeCloseTo(4.0 / 0.0516, 9);
    expect(r.slendernessLimit).toBeCloseTo(4.71 * Math.sqrt(200e9 / 250e6), 9);
    expect(r.criticalStress).toBeGreaterThan(150e6);
    expect(r.criticalStress).toBeLessThan(200e6);
    expect(r.nominalStrength).toBeGreaterThan(1500000);
    expect(r.designStrengthLRFD).toBeCloseTo(0.9 * r.nominalStrength, 6);
    expect(r.allowableStrengthASD).toBeCloseTo(r.nominalStrength / 1.67, 6);
    await shot(page, 'inelastic');
  });

  test('03 elastic regime for very slender column (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.steelcol.analyse({
      effectiveLengthK: 1.0, unbracedLength: 10.0,
      radiusOfGyration: 0.0516, area: 9.29e-3,
      youngsModulus: 200e9, yieldStress: 250e6,
    }));
    expect(r.inelasticRegime).toBe(false);
    expect(r.criticalStress).toBeCloseTo(0.877 * r.eulerStress, 6);
    await shot(page, 'elastic');
  });

  test('04 LRFD = 0.9 · P_n exactly (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.steelcol.analyse({
      effectiveLengthK: 1.0, unbracedLength: 4.0,
      radiusOfGyration: 0.0516, area: 9.29e-3,
      youngsModulus: 200e9, yieldStress: 250e6,
    }));
    expect(r.designStrengthLRFD / r.nominalStrength).toBeCloseTo(0.9, 12);
    await shot(page, 'lrfd');
  });

  test('05 ASD = P_n / 1.67 exactly (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.steelcol.analyse({
      effectiveLengthK: 1.0, unbracedLength: 4.0,
      radiusOfGyration: 0.0516, area: 9.29e-3,
      youngsModulus: 200e9, yieldStress: 250e6,
    }));
    expect(r.allowableStrengthASD * 1.67 / r.nominalStrength).toBeCloseTo(1.0, 9);
    await shot(page, 'asd');
  });

  test('06 panel check renders regime banner + φPn (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenSteelColWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-steelcol-run"]').click();
    await page.waitForSelector('[data-testid="forge-steelcol-result"]', { timeout: 5000 });
    const regime = await page.locator('[data-testid="forge-steelcol-regime"]').innerText();
    expect(regime).toMatch(/INELASTIC|ELASTIC/);
    const lrfd = await page.locator('[data-testid="forge-steelcol-LRFD"]').innerText();
    expect(lrfd).toMatch(/φPn/);
    expect(lrfd).toMatch(/kN/);
    await shot(page, 'panel');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
