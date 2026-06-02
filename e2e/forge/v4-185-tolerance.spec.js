// v4-185-tolerance.spec.js — Forge-185 tolerance stack-up.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-185-tolerance';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-185 · tolerance stack-up', () => {
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

  test('01 baseline + tolerance bridge', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.tolerance?.compute === 'function');
    expect(has).toBe(true);
  });

  test('02 open Tolerance workbench + default 4-link stack runs', async () => {
    await page.evaluate(() => { window.__forgeOpenToleranceWorkbench?.(); });
    await page.waitForTimeout(700);
    await shot(page, 'default-stack');
    await expect(page.locator('[data-testid="forge-tol-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-tol-result"]')).toBeVisible({ timeout: 4000 });
    const status = await page.locator('[data-testid="forge-tol-status"]').innerText();
    expect(status).toMatch(/Cp\s+\d/);
  });

  test('03 distribution bar visible', async () => {
    await expect(page.locator('[data-testid="forge-tol-bar"]')).toBeVisible();
    await shot(page, 'bar');
  });

  test('04 tighten spec — yield drops below 100%', async () => {
    await page.locator('[data-testid="forge-tol-usl"]').fill('40.05');
    await page.locator('[data-testid="forge-tol-lsl"]').fill('39.95');
    await page.locator('[data-testid="forge-tol-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'tight-spec');
    const status = await page.locator('[data-testid="forge-tol-status"]').innerText();
    expect(status).toMatch(/Cp\s+\d/);
  });

  test('05 add a 5th link → larger stack', async () => {
    await page.locator('[data-testid="forge-tol-add"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-tol-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'fifth-link');
  });

  test('06 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
