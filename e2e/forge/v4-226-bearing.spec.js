// v4-226-bearing.spec.js — Forge-226 Bearing L10 life (ISO 281).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-226-bearing';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-226 · bearing L10', () => {
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
      !!(window.forge && window.forge.bearing
         && typeof window.forge.bearing.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 ball bearing L10 = (C/P)^3 (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.bearing.analyse({
      C: 30000, Fr: 5000, Fa: 0, X: 1, Y: 0,
      kind: 'ball', reliabilityPercent: 90, rpm: 1500,
    }));
    expect(r.equivalentLoad).toBeCloseTo(5000, 9);
    expect(r.L10MegaRev).toBeCloseTo(216, 9);
    expect(r.L10Hours).toBeCloseTo(216 * 1e6 / (60 * 1500), 6);
    await shot(page, 'ball');
  });

  test('03 roller exponent is 10/3 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.bearing.analyse({
      C: 30000, Fr: 5000, Fa: 0, X: 1, Y: 0,
      kind: 'roller', reliabilityPercent: 90,
    }));
    expect(r.L10MegaRev).toBeCloseTo(Math.pow(6, 10/3), 6);
    await shot(page, 'roller');
  });

  test('04 reliability factor table (cam #3)', async () => {
    const r = await page.evaluate(() => ({
      r90:  window.forge.bearing.analyse({ C:30000, Fr:5000, Fa:0, X:1, Y:0, kind:'ball', reliabilityPercent:90 }).reliabilityFactor,
      r95:  window.forge.bearing.analyse({ C:30000, Fr:5000, Fa:0, X:1, Y:0, kind:'ball', reliabilityPercent:95 }).reliabilityFactor,
      r99:  window.forge.bearing.analyse({ C:30000, Fr:5000, Fa:0, X:1, Y:0, kind:'ball', reliabilityPercent:99 }).reliabilityFactor,
      r999: window.forge.bearing.analyse({ C:30000, Fr:5000, Fa:0, X:1, Y:0, kind:'ball', reliabilityPercent:99.9 }).reliabilityFactor,
    }));
    expect(r.r90).toBeCloseTo(1.00, 9);
    expect(r.r95).toBeCloseTo(0.62, 9);
    expect(r.r99).toBeCloseTo(0.21, 9);
    expect(r.r999).toBeCloseTo(0.04, 9);
    await shot(page, 'a1-table');
  });

  test('05 combined load P = X·Fr + Y·Fa (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.bearing.analyse({
      C: 30000, Fr: 5000, Fa: 2000, X: 0.56, Y: 1.5,
      kind: 'ball', reliabilityPercent: 90,
    }));
    expect(r.equivalentLoad).toBeCloseTo(0.56 * 5000 + 1.5 * 2000, 9);
    expect(r.L10MegaRev).toBeCloseTo(Math.pow(30000 / (0.56*5000 + 1.5*2000), 3), 9);
    await shot(page, 'combined');
  });

  test('06 panel analyse renders L10 / Lna (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenBearingWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-bearing-run"]').click();
    await page.waitForSelector('[data-testid="forge-bearing-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-bearing-result"]').innerText();
    expect(text).toMatch(/L10/);
    expect(text).toMatch(/Lna/);
    await shot(page, 'panel');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
