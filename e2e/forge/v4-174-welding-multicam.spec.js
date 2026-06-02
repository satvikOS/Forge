// v4-174-welding-multicam.spec.js — Forge-174 thermo-mechanical FEA.
// Multi-view coverage cycles the 4 result fields (peak HAZ, Mises,
// displacement, plastic strain) + alternate materials.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-174-welding';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-174 · welding distortion · multi-view', () => {
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

  test('01 baseline + welding bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge === 'object'
      && typeof window.forge.welding === 'object'
      && typeof window.forge.welding.simulateWeld === 'function');
    expect(has).toBe(true);
  });

  test('02 open WeldFEA workbench', async () => {
    await page.evaluate(() => { window.__forgeOpenWeldingDistortionWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'panel-open');
    await expect(page.locator('[data-testid="forge-welding-panel"]')).toBeVisible();
  });

  test('03 run baseline weld (S235, 60×20×4 mm)', async () => {
    await page.evaluate(() => { window.__forgeOpenWeldingDistortionWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-welding-run"]').click();
    await page.waitForTimeout(3000);
    await shot(page, 'after-run');
    await expect(page.locator('[data-testid="forge-welding-result"]')).toBeVisible({ timeout: 8000 });
    const status = await page.locator('[data-testid="forge-welding-status"]').innerText();
    expect(status).toMatch(/peak\s+\d+\s+°C/);
  });

  test('04 view 1 — peak HAZ temperature heatmap', async () => {
    await page.evaluate(() => { window.__forgeWeldingView?.({ field: 'haz' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view1-haz');
    await expect(page.locator('[data-testid="forge-welding-field"]')).toBeVisible();
  });

  test('05 view 2 — Mises stress field', async () => {
    await page.evaluate(() => { window.__forgeWeldingView?.({ field: 'mises' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view2-mises');
  });

  test('06 view 3 — displacement magnitude', async () => {
    await page.evaluate(() => { window.__forgeWeldingView?.({ field: 'disp' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view3-disp');
  });

  test('07 view 4 — equivalent plastic strain', async () => {
    await page.evaluate(() => { window.__forgeWeldingView?.({ field: 'plastic' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view4-plastic');
  });

  test('08 view 5 — S355 mild steel, re-run', async () => {
    await page.locator('[data-testid="forge-welding-mat"]').selectOption({ index: 1 });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-welding-run"]').click();
    await page.waitForTimeout(3000);
    await shot(page, 'view5-s355');
  });

  test('09 view 6 — stainless 304, re-run', async () => {
    await page.locator('[data-testid="forge-welding-mat"]').selectOption({ index: 2 });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-welding-run"]').click();
    await page.waitForTimeout(3000);
    await shot(page, 'view6-304');
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
