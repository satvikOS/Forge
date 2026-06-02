// v4-193-tsviewer.spec.js — Forge-193 time-series log viewer.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-193-tsviewer';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-193 · time-series log viewer', () => {
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

  test('01 open viewer + default FEA demo loads', async () => {
    await page.evaluate(() => { window.__forgeOpenTimeSeriesViewerWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'fea');
    await expect(page.locator('[data-testid="forge-tsv-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-tsv-chart"]')).toBeVisible();
    const status = await page.locator('[data-testid="forge-tsv-result"]').innerText();
    expect(status).toMatch(/FEA Newton residuals/);
  });

  test('02 swap to CFD lift demo + change Y axis to linear', async () => {
    await page.locator('[data-testid="forge-tsv-demo"]').selectOption({ index: 1 });
    await page.waitForTimeout(300);
    await shot(page, 'cfd');
    await page.locator('[data-testid="forge-tsv-axis"]').selectOption({ value: 'linear' });
    await page.waitForTimeout(300);
    await shot(page, 'cfd-linear');
  });

  test('03 toggle series visibility', async () => {
    // CFD demo has 2 series (CL, CD). Untick the second.
    await page.locator('[data-testid="forge-tsv-series-1"]').uncheck();
    await page.waitForTimeout(200);
    await shot(page, 'one-series');
  });

  test('04 casting cooling curve demo', async () => {
    await page.locator('[data-testid="forge-tsv-demo"]').selectOption({ index: 2 });
    await page.waitForTimeout(300);
    await shot(page, 'casting');
  });

  test('05 acoustics EDC demo', async () => {
    await page.locator('[data-testid="forge-tsv-demo"]').selectOption({ index: 3 });
    await page.waitForTimeout(300);
    await shot(page, 'edc');
  });

  test('06 hover crosshair updates cursor readout', async () => {
    const chart = page.locator('[data-testid="forge-tsv-chart"]');
    const box = await chart.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
      await page.waitForTimeout(150);
      await shot(page, 'crosshair');
      const result = await page.locator('[data-testid="forge-tsv-result"]').innerText();
      expect(result).toMatch(/cursor @ /);
    }
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
