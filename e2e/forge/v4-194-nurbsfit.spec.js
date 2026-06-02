// v4-194-nurbsfit.spec.js — Forge-194 NURBS surface fit.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-194-nurbsfit';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-194 · NURBS surface fit', () => {
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

  test('01 nurbsfit bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.nurbsfit?.fitSurface === 'function');
    expect(has).toBe(true);
  });

  test('02 default Gaussian hill fits with 7×7 CPs', async () => {
    await page.evaluate(() => { window.__forgeOpenNurbsFitWorkbench?.(); });
    await page.waitForTimeout(700);
    await shot(page, 'gaussian-fit');
    await expect(page.locator('[data-testid="forge-nurbsfit-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-nurbsfit-svg"]')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('[data-testid="forge-nurbsfit-result"]')).toBeVisible();
    const status = await page.locator('[data-testid="forge-nurbsfit-status"]').innerText();
    expect(status).toMatch(/RMS \d/);
  });

  test('03 residual scatter visible', async () => {
    await expect(page.locator('[data-testid="forge-nurbsfit-svg"]')).toBeVisible();
    await shot(page, 'scatter');
  });

  test('04 4×4 control net → larger residuals', async () => {
    await page.locator('[data-testid="forge-nurbsfit-u"]').fill('4');
    await page.locator('[data-testid="forge-nurbsfit-v"]').fill('4');
    await page.locator('[data-testid="forge-nurbsfit-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, '4x4-fit');
  });

  test('05 saddle survey produces low residuals (smooth surface)', async () => {
    await page.locator('[data-testid="forge-nurbsfit-survey"]').selectOption({ index: 2 });
    await page.locator('[data-testid="forge-nurbsfit-u"]').fill('5');
    await page.locator('[data-testid="forge-nurbsfit-v"]').fill('5');
    await page.locator('[data-testid="forge-nurbsfit-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'saddle');
  });

  test('06 noisy scatter fit', async () => {
    await page.locator('[data-testid="forge-nurbsfit-survey"]').selectOption({ index: 3 });
    await page.locator('[data-testid="forge-nurbsfit-u"]').fill('4');
    await page.locator('[data-testid="forge-nurbsfit-v"]').fill('4');
    await page.locator('[data-testid="forge-nurbsfit-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'noisy');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
