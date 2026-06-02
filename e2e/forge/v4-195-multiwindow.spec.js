// v4-195-multiwindow.spec.js — Forge-195 multi-window.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-195-mw';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-195 · multi-window', () => {
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

  test('01 forge.win bridge wired + new-window button visible', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge?.win?.newWindow === 'function'
      && typeof window.__forgeNewWindow === 'function');
    expect(has).toBe(true);
    await expect(page.locator('[data-testid="forge-newwindow-button"]')).toBeVisible();
  });

  test('02 spawn a secondary window with initial workbench = drawings', async () => {
    const result = await page.evaluate(() =>
      window.__forgeNewWindow({ initialWb: 'drawing', width: 900, height: 700 }));
    expect(result.ok).toBe(true);
    expect(typeof result.id).toBe('string');
    await page.waitForTimeout(1500);
    const list = await page.evaluate(() => window.__forgeListWindows());
    expect(list.count).toBeGreaterThanOrEqual(1);
    await shot(page, 'after-spawn');
  });

  test('03 close the secondary window via the API', async () => {
    const list = await page.evaluate(() => window.__forgeListWindows());
    const id = list.ids[0];
    const r = await page.evaluate(async (id) =>
      await window.forge.win.closeWindow(id), id);
    expect(r.ok).toBe(true);
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => window.__forgeListWindows());
    expect(after.count).toBe(0);
  });

  test('04 spawn 3 windows in a row', async () => {
    for (const wb of ['mech', 'drawing', 'sim']) {
      await page.evaluate((wb) => window.__forgeNewWindow({ initialWb: wb }), wb);
      await page.waitForTimeout(700);
    }
    const list = await page.evaluate(() => window.__forgeListWindows());
    expect(list.count).toBeGreaterThanOrEqual(3);
    await shot(page, 'three-windows');
  });

  test('05 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
