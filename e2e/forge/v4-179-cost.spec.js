// v4-179-cost.spec.js — Forge-179 cost estimation engine.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-179-cost';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-179 · cost estimation · multi-view', () => {
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

  test('01 baseline + cost bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge === 'object'
      && typeof window.forge.cost === 'object'
      && typeof window.forge.cost.computeUnit === 'function');
    expect(has).toBe(true);
  });

  test('02 open Cost workbench', async () => {
    await page.evaluate(() => { window.__forgeOpenCostWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'panel-open');
    await expect(page.locator('[data-testid="forge-cost-panel"]')).toBeVisible();
  });

  test('03 compute Al6061 bracket cost', async () => {
    await page.evaluate(() => { window.__forgeOpenCostWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-cost-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'al6061-result');
    await expect(page.locator('[data-testid="forge-cost-result"]')).toBeVisible();
    const status = await page.locator('[data-testid="forge-cost-status"]').innerText();
    expect(status).toMatch(/unit \$\d/);
  });

  test('04 tornado chart visible', async () => {
    await shot(page, 'tornado');
    await expect(page.locator('[data-testid="forge-cost-tornado"]')).toBeVisible();
  });

  test('05 switch to Ti6Al4V — much higher cost', async () => {
    await page.locator('[data-testid="forge-cost-mat"]').selectOption({ index: 4 });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-cost-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'ti6al4v-result');
  });

  test('06 lathe process re-run', async () => {
    await page.locator('[data-testid="forge-cost-process"]').selectOption({ index: 1 });
    await page.locator('[data-testid="forge-cost-tool"]').fill('2');
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-cost-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'lathe');
  });

  test('07 qty scaling — batch of 1000', async () => {
    await page.locator('[data-testid="forge-cost-qty"]').fill('1000');
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-cost-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'qty-1000');
  });

  test('08 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
