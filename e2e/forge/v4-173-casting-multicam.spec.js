// v4-173-casting-multicam.spec.js — Forge-173 casting solidification
// workbench. Multi-view coverage by cycling through 3 axis slices + 3
// scalar fields (solidification time, peak T, Niyama) and a cooling
// curve at the probe.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-173-casting';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-173 · casting solidification · multi-view', () => {
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

  test('01 baseline + casting bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge === 'object'
      && typeof window.forge.casting === 'object'
      && typeof window.forge.casting.solidify === 'function');
    expect(has).toBe(true);
  });

  test('02 open Casting workbench', async () => {
    await page.evaluate(() => { window.__forgeOpenCastingWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'panel-open');
    await expect(page.locator('[data-testid="forge-casting-panel"]')).toBeVisible();
  });

  test('03 run solidification (A356, box demo)', async () => {
    await page.evaluate(() => { window.__forgeOpenCastingWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-casting-run"]').click();
    await page.waitForTimeout(2500);
    await shot(page, 'after-run');
    await expect(page.locator('[data-testid="forge-casting-result"]')).toBeVisible({ timeout: 6000 });
    const status = await page.locator('[data-testid="forge-casting-status"]').innerText();
    expect(status).toMatch(/solidified \d+\/\d+ cells/);
  });

  test('04 view 1 — z-slice solidification-time heatmap', async () => {
    await page.evaluate(() => { window.__forgeCastingView?.({ axis: 'z', field: 'solid', sliceIdx: 4 }); });
    await page.waitForTimeout(300);
    await shot(page, 'view1-z-solid');
    await expect(page.locator('[data-testid="forge-casting-slice"]')).toBeVisible();
  });

  test('05 view 2 — y-slice peak temperature', async () => {
    await page.evaluate(() => { window.__forgeCastingView?.({ axis: 'y', field: 'peak', sliceIdx: 4 }); });
    await page.waitForTimeout(300);
    await shot(page, 'view2-y-peak');
  });

  test('06 view 3 — x-slice Niyama porosity', async () => {
    await page.evaluate(() => { window.__forgeCastingView?.({ axis: 'x', field: 'niyama', sliceIdx: 8 }); });
    await page.waitForTimeout(300);
    await shot(page, 'view3-x-niyama');
  });

  test('07 view 4 — cooling curve at centre probe', async () => {
    await shot(page, 'view4-cooling-curve');
    await expect(page.locator('[data-testid="forge-casting-cooling-curve"]')).toBeVisible();
  });

  test('08 view 5 — slower wall (h=500) re-run', async () => {
    await page.locator('[data-testid="forge-casting-hwall"]').fill('500');
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-casting-run"]').click();
    await page.waitForTimeout(3000);
    await page.evaluate(() => { window.__forgeCastingView?.({ axis: 'z', field: 'solid', sliceIdx: 4 }); });
    await page.waitForTimeout(300);
    await shot(page, 'view5-slow-wall');
  });

  test('09 alternate alloy — stainless 304', async () => {
    await page.locator('[data-testid="forge-casting-alloy"]').selectOption({ index: 2 });
    await page.locator('[data-testid="forge-casting-tpour"]').fill('1500');
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-casting-run"]').click();
    await page.waitForTimeout(3000);
    await shot(page, 'view6-stainless');
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
