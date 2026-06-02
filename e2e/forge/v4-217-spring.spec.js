// v4-217-spring.spec.js — Forge-217 compression spring design.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-217-spring';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-217 · compression spring', () => {
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
      !!(window.forge && window.forge.spring
         && typeof window.forge.spring.design === 'function'));
    expect(has).toBe(true);
  });

  test('02 spring index C = D/d (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.spring.design({
      wireDiameter: 0.002, meanDiameter: 0.016,
      activeCoils: 10, totalCoils: 12,
      shearModulus: 80e9, appliedForce: 50,
    }));
    expect(r.springIndex).toBeCloseTo(8, 12);
    await shot(page, 'spring-index');
  });

  test('03 Wahl factor closed form (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.spring.design({
      wireDiameter: 0.002, meanDiameter: 0.016,
      activeCoils: 10, totalCoils: 12,
      shearModulus: 80e9, appliedForce: 50,
    }));
    const expected = 31/28 + 0.615/8;   // K_W for C=8
    expect(r.wahlFactor).toBeCloseTo(expected, 9);
    await shot(page, 'wahl');
  });

  test('04 rate k matches Gd⁴/(8D³Na) (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.spring.design({
      wireDiameter: 0.002, meanDiameter: 0.016,
      activeCoils: 10, totalCoils: 12,
      shearModulus: 80e9, appliedForce: 50,
    }));
    const expected = 80e9 * Math.pow(0.002, 4) / (8 * Math.pow(0.016, 3) * 10);
    expect(r.rate).toBeCloseTo(expected, 1);
    await shot(page, 'rate');
  });

  test('05 solid height = Nt × d (cam #4)', async () => {
    const r = await page.evaluate(() => window.forge.spring.design({
      wireDiameter: 0.002, meanDiameter: 0.016,
      activeCoils: 10, totalCoils: 12,
      shearModulus: 80e9, appliedForce: 50,
    }));
    expect(r.solidHeight).toBeCloseTo(12 * 0.002, 12);
    await shot(page, 'solid');
  });

  test('06 panel design renders result card (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenSpringWorkbench?.(); });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-spring-run"]').click();
    await page.waitForSelector('[data-testid="forge-spring-result"]', { timeout: 5000 });
    const text = await page.locator('[data-testid="forge-spring-result"]').innerText();
    expect(text).toMatch(/K_W/);
    expect(text).toMatch(/τ_max/);
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
