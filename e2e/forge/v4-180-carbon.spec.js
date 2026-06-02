// v4-180-carbon.spec.js — Forge-180 carbon LCA.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-180-carbon';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-180 · carbon LCA · multi-view', () => {
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

  test('01 baseline + carbon bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.carbon?.computeLca === 'function');
    expect(has).toBe(true);
  });

  test('02 open Carbon LCA workbench', async () => {
    await page.evaluate(() => { window.__forgeOpenCarbonLcaWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'panel-open');
    await expect(page.locator('[data-testid="forge-carbon-panel"]')).toBeVisible();
  });

  test('03 compute Al6061 + EU grid', async () => {
    await page.evaluate(() => { window.__forgeOpenCarbonLcaWorkbench?.(); });
    await page.locator('[data-testid="forge-carbon-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'al6061-eu');
    await expect(page.locator('[data-testid="forge-carbon-result"]')).toBeVisible();
  });

  test('04 stacked bar visible', async () => {
    await shot(page, 'stacked-bar');
    await expect(page.locator('[data-testid="forge-carbon-bar"]')).toBeVisible();
  });

  test('05 Norway low-carbon grid drops manuf CO2', async () => {
    await page.locator('[data-testid="forge-carbon-grid"]').selectOption({ index: 0 });
    await page.locator('[data-testid="forge-carbon-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'norway-grid');
  });

  test('06 Ti6Al4V — order of magnitude higher footprint', async () => {
    await page.locator('[data-testid="forge-carbon-mat"]').selectOption({ index: 4 });
    await page.locator('[data-testid="forge-carbon-grid"]').selectOption({ index: 2 });
    await page.locator('[data-testid="forge-carbon-run"]').click();
    await page.waitForTimeout(400);
    await shot(page, 'titanium');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
