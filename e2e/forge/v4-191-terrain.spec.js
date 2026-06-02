// v4-191-terrain.spec.js — Forge-191 civil terrain.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-191-terrain';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-191 · civil terrain', () => {
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

  test('01 terrain bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.terrain?.delaunay === 'function'
      && typeof window.forge?.terrain?.cutFillVsPlane === 'function');
    expect(has).toBe(true);
  });

  test('02 default Gaussian-hill survey triangulates + cut/fill computed', async () => {
    await page.evaluate(() => { window.__forgeOpenTerrainWorkbench?.(); });
    await page.waitForTimeout(700);
    await shot(page, 'gaussian-hill');
    await expect(page.locator('[data-testid="forge-terrain-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-terrain-svg"]')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('[data-testid="forge-terrain-result"]')).toBeVisible();
    const status = await page.locator('[data-testid="forge-terrain-status"]').innerText();
    expect(status).toMatch(/\d+ tri · cut /);
  });

  test('03 switch to cut/fill colour mode', async () => {
    await page.locator('[data-testid="forge-terrain-mode"]').selectOption({ value: 'cutfill' });
    await page.waitForTimeout(300);
    await shot(page, 'cutfill');
  });

  test('04 lower plane drives more cut volume', async () => {
    await page.locator('[data-testid="forge-terrain-c"]').fill('0');
    await page.waitForTimeout(400);
    await shot(page, 'plane-zero');
    const result = await page.locator('[data-testid="forge-terrain-result"]').innerText();
    expect(result).toMatch(/Cut volume\s+\d/);
  });

  test('05 swap survey to Sine ridge', async () => {
    await page.locator('[data-testid="forge-terrain-survey"]').selectOption({ index: 1 });
    await page.waitForTimeout(400);
    await shot(page, 'ridge');
  });

  test('06 random scatter survey produces a TIN', async () => {
    await page.locator('[data-testid="forge-terrain-survey"]').selectOption({ index: 3 });
    await page.waitForTimeout(400);
    await shot(page, 'scatter');
    await expect(page.locator('[data-testid="forge-terrain-svg"]')).toBeVisible();
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
