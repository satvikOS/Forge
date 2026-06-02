// v4-231-fan.spec.js — Forge-231 fan / blower sizing + affinity.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-231-fan';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-231 · fan / blower', () => {
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
      !!(window.forge && window.forge.fan
         && typeof window.forge.fan.analyse === 'function'
         && typeof window.forge.fan.scaleByAffinity === 'function'));
    expect(has).toBe(true);
  });

  test('02 sizing exact for textbook fixture (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.fan.analyse({
      flowRate: 2.0, deltaPStatic: 500, density: 1.2,
      outletArea: 0.2, fanEfficiency: 0.7,
    }));
    expect(r.velocityOutlet).toBeCloseTo(10, 9);
    expect(r.velocityPressure).toBeCloseTo(60, 9);
    expect(r.totalPressure).toBeCloseTo(560, 9);
    expect(r.hydraulicPower).toBeCloseTo(1120, 6);
    expect(r.shaftPower).toBeCloseTo(1600, 6);
    await shot(page, 'sizing');
  });

  test('03 doubling rpm → Q×2, Δp×4, P×8 (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.fan.scaleByAffinity({
      Q1: 2.0, dP1: 560, P1: 1600, N1: 1500, rho1: 1.2,
      N2: 3000, rho2: 1.2,
    }));
    expect(r.Q2).toBeCloseTo(4, 9);
    expect(r.dP2).toBeCloseTo(560 * 4, 6);
    expect(r.P2).toBeCloseTo(1600 * 8, 6);
    await shot(page, 'affinity-N');
  });

  test('04 density change at constant N: Q unchanged, Δp + P scale (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.fan.scaleByAffinity({
      Q1: 2.0, dP1: 560, P1: 1600, N1: 1500, rho1: 1.2,
      N2: 1500, rho2: 0.9,
    }));
    expect(r.Q2).toBeCloseTo(2.0, 12);
    expect(r.dP2).toBeCloseTo(560 * 0.75, 9);
    expect(r.P2).toBeCloseTo(1600 * 0.75, 9);
    await shot(page, 'affinity-rho');
  });

  test('05 N₂ = 0 → Q₂ = 0, Δp₂ = 0, P₂ = 0 (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.fan.scaleByAffinity({
      Q1: 2.0, dP1: 560, P1: 1600, N1: 1500, rho1: 1.2,
      N2: 0, rho2: 1.2,
    }));
    expect(r.Q2).toBeCloseTo(0, 12);
    expect(r.dP2).toBeCloseTo(0, 12);
    expect(r.P2).toBeCloseTo(0, 12);
    await shot(page, 'N-zero');
  });

  test('06 panel compute renders shaft P + affinity card (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenFanWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-fan-run"]').click();
    await page.waitForSelector('[data-testid="forge-fan-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-fan-shaft"]').innerText();
    expect(text).toMatch(/Shaft P/);
    expect(text).toMatch(/kW/);
    const fullText = await page.locator('[data-testid="forge-fan-result"]').innerText();
    expect(fullText).toMatch(/Affinity-scaled/);
    await shot(page, 'panel');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
