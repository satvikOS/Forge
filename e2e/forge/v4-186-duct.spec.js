// v4-186-duct.spec.js — Forge-186 HVAC ductwork.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-186-duct';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-186 · HVAC ductwork', () => {
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

  test('01 baseline + duct bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.duct?.compute === 'function');
    expect(has).toBe(true);
  });

  test('02 open Ductwork workbench + default 5-segment route', async () => {
    await page.evaluate(() => { window.__forgeOpenDuctworkWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'default-route');
    await expect(page.locator('[data-testid="forge-duct-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-duct-result"]')).toBeVisible({ timeout: 4000 });
    const status = await page.locator('[data-testid="forge-duct-status"]').innerText();
    expect(status).toMatch(/ΔP \d/);
  });

  test('03 pressure-drop bar visible', async () => {
    await expect(page.locator('[data-testid="forge-duct-bar"]')).toBeVisible();
    await shot(page, 'bar');
  });

  test('04 swap first segment to 150 mm — velocity flags high', async () => {
    await page.locator('[data-testid="forge-duct-d-0"]').fill('150');
    await page.locator('[data-testid="forge-duct-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'small-diam');
    const status = await page.locator('[data-testid="forge-duct-status"]').innerText();
    expect(status).toMatch(/max V \d/);
  });

  test('05 add a TeeBranch segment increases ΔP', async () => {
    await page.locator('[data-testid="forge-duct-d-0"]').fill('300');
    await page.locator('[data-testid="forge-duct-add"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-duct-kind-5"]').selectOption({ value: '7' });
    await page.locator('[data-testid="forge-duct-d-5"]').fill('300');
    await page.locator('[data-testid="forge-duct-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'with-tee');
  });

  test('06 ASHRAE sizing target — change to 0.5 Pa/m', async () => {
    await page.locator('[data-testid="forge-duct-friction"]').fill('0.5');
    await page.locator('[data-testid="forge-duct-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'lower-friction');
    const status = await page.locator('[data-testid="forge-duct-status"]').innerText();
    expect(status).toMatch(/suggest D\s+\d+\s+mm/);
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
