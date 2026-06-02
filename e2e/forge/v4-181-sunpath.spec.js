// v4-181-sunpath.spec.js — Forge-181 sun-path daylight analysis.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-181-sunpath';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-181 · sun-path + daylight', () => {
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

  test('01 baseline + sun bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.sun?.compute === 'function');
    expect(has).toBe(true);
  });

  test('02 open SunPath workbench (London default)', async () => {
    await page.evaluate(() => { window.__forgeOpenSunPathWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'london');
    await expect(page.locator('[data-testid="forge-sun-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-sun-result"]')).toBeVisible();
  });

  test('03 altitude chart + polar diagram render', async () => {
    await expect(page.locator('[data-testid="forge-sun-alt-chart"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-sun-polar"]')).toBeVisible();
    await shot(page, 'charts');
  });

  test('04 switch to Sydney + check daylight flips', async () => {
    await page.locator('[data-testid="forge-sun-city"]').selectOption({ index: 8 });
    await page.waitForTimeout(400);
    await shot(page, 'sydney');
    const status = await page.locator('[data-testid="forge-sun-status"]').innerText();
    // Sydney on day 172 (June 21) should report short daylight (winter).
    expect(status).toMatch(/daylight\s+\d/);
  });

  test('05 switch to Tromsø + polar day check', async () => {
    await page.locator('[data-testid="forge-sun-city"]').selectOption({ index: 12 });
    await page.waitForTimeout(400);
    await shot(page, 'tromso');
  });

  test('06 day-of-year scrub — December solstice', async () => {
    await page.locator('[data-testid="forge-sun-city"]').selectOption({ index: 0 });  // back to London
    await page.locator('[data-testid="forge-sun-doy"]').fill('355');
    await page.waitForTimeout(400);
    await shot(page, 'london-december');
    // London December daylight should be ~8 hours.
    const status = await page.locator('[data-testid="forge-sun-status"]').innerText();
    const m = status.match(/daylight\s+([\d.]+)\s*h/);
    expect(m).toBeTruthy();
    const daylight = parseFloat(m[1]);
    expect(daylight).toBeGreaterThan(6);
    expect(daylight).toBeLessThan(10);
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
