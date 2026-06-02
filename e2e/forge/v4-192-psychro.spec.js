// v4-192-psychro.spec.js — Forge-192 HVAC psychrometric calculator.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-192-psychro';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-192 · HVAC psychrometric chart', () => {
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

  test('01 psychro bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.psychro?.stateFromTwo === 'function');
    expect(has).toBe(true);
  });

  test('02 open + default (25 °C, 50 % RH) state computed', async () => {
    await page.evaluate(() => { window.__forgeOpenPsychrometricWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'default-state');
    await expect(page.locator('[data-testid="forge-psy-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-psy-result"]')).toBeVisible({ timeout: 4000 });
    const status = await page.locator('[data-testid="forge-psy-status"]').innerText();
    expect(status).toMatch(/Tdb 25\.0 · RH 50\.0 %/);
  });

  test('03 chart renders with iso-RH curves', async () => {
    await expect(page.locator('[data-testid="forge-psy-chart"]')).toBeVisible();
    await shot(page, 'chart');
  });

  test('04 hot humid 35 °C 80 % RH → wet bulb > 30 °C (heatstroke risk)', async () => {
    await page.locator('[data-testid="forge-psy-valA"]').fill('35');
    await page.locator('[data-testid="forge-psy-valB"]').fill('0.80');
    await page.locator('[data-testid="forge-psy-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'hot-humid');
    const result = await page.locator('[data-testid="forge-psy-result"]').innerText();
    expect(result).toMatch(/Twb \(wet bulb\)\s+3[01-3]\.\d/);
  });

  test('05 input pair switch — (Tdb, h)', async () => {
    await page.locator('[data-testid="forge-psy-pickB"]').selectOption({ value: 'h' });
    await page.locator('[data-testid="forge-psy-valA"]').fill('25');
    await page.locator('[data-testid="forge-psy-valB"]').fill('50.4');
    await page.locator('[data-testid="forge-psy-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'tdb-h');
    const result = await page.locator('[data-testid="forge-psy-result"]').innerText();
    // h = 50.4 kJ/kg at 25 °C → W ≈ 0.0099, RH ≈ 50 %.
    expect(result).toMatch(/RH\s+5\d\./);
  });

  test('06 input pair switch — (Tdb, Tdp)', async () => {
    await page.locator('[data-testid="forge-psy-pickB"]').selectOption({ value: 'tdp' });
    await page.locator('[data-testid="forge-psy-valA"]').fill('25');
    await page.locator('[data-testid="forge-psy-valB"]').fill('14');
    await page.locator('[data-testid="forge-psy-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'tdb-tdp');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
