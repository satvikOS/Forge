// v4-172-moldflow-multicam.spec.js — Forge-172 Hele-Shaw mould flow.
// Multi-view coverage cycles 3 result fields (fill time, peak pressure,
// fill fraction) over 2 cavity shapes (disc, plate) + an alternate
// polymer preset.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-172-moldflow';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-172 · injection mould flow · multi-view', () => {
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

  test('01 baseline + mold bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge === 'object'
      && typeof window.forge.mold === 'object'
      && typeof window.forge.mold.heleShawFill === 'function');
    expect(has).toBe(true);
  });

  test('02 open MoldFlow workbench', async () => {
    await page.evaluate(() => { window.__forgeOpenMoldFlowWorkbench?.(); });
    await page.waitForTimeout(700);
    await shot(page, 'panel-open');
    await expect(page.locator('[data-testid="forge-mold-panel"]')).toBeVisible();
  });

  test('03 raw disc cavity rendered (pre-run)', async () => {
    await shot(page, 'cavity-disc-raw');
    await expect(page.locator('[data-testid="forge-mold-cavity"]')).toBeVisible();
  });

  test('04 run Hele-Shaw fill (ABS, disc)', async () => {
    await page.evaluate(() => { window.__forgeOpenMoldFlowWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-mold-run"]').click();
    await page.waitForTimeout(3000);
    await shot(page, 'after-run-fill');
    await expect(page.locator('[data-testid="forge-mold-result"]')).toBeVisible({ timeout: 8000 });
    const status = await page.locator('[data-testid="forge-mold-status"]').innerText();
    expect(status).toMatch(/total fill\s+\d/);
  });

  test('05 view 1 — fill-time field', async () => {
    await page.evaluate(() => { window.__forgeMoldFlowView?.({ field: 'fill' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view1-fill');
  });

  test('06 view 2 — peak pressure field', async () => {
    await page.evaluate(() => { window.__forgeMoldFlowView?.({ field: 'pressure' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view2-pressure');
  });

  test('07 view 3 — filled fraction field', async () => {
    await page.evaluate(() => { window.__forgeMoldFlowView?.({ field: 'fraction' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view3-fraction');
  });

  test('08 view 4 — alternate polymer (PP)', async () => {
    await page.locator('[data-testid="forge-mold-polymer"]').selectOption({ index: 1 });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-mold-run"]').click();
    await page.waitForTimeout(3000);
    await shot(page, 'view4-pp');
  });

  test('09 view 5 — plate cavity, corner gate', async () => {
    await page.locator('[data-testid="forge-mold-cavity-kind"]').selectOption({ value: 'plate' });
    await page.waitForTimeout(400);
    await page.locator('[data-testid="forge-mold-run"]').click();
    await page.waitForTimeout(4000);
    await shot(page, 'view5-plate');
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
