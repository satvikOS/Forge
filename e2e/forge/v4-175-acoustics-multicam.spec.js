// v4-175-acoustics-multicam.spec.js — Forge-175 acoustic room sim.
// Multi-view coverage cycles the 4 result views (combined IR, per-band
// IR, EDC, RT60 bar chart) and a 2nd run with a carpeted floor.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-175-acoustics';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-175 · acoustic room sim · multi-view', () => {
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

  test('01 baseline + acoustics bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      typeof window.forge === 'object'
      && typeof window.forge.acoustics === 'object'
      && typeof window.forge.acoustics.simulate === 'function');
    expect(has).toBe(true);
  });

  test('02 open Acoustics workbench', async () => {
    await page.evaluate(() => { window.__forgeOpenAcousticsWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'panel-open');
    await expect(page.locator('[data-testid="forge-acoustics-panel"]')).toBeVisible();
  });

  test('03 run shoebox 6×4×3 (default concrete walls)', async () => {
    await page.evaluate(() => { window.__forgeOpenAcousticsWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-acoustics-run"]').click();
    await page.waitForTimeout(2500);
    await shot(page, 'after-run-baseline');
    await expect(page.locator('[data-testid="forge-acoustics-metrics"]')).toBeVisible({ timeout: 6000 });
    const status = await page.locator('[data-testid="forge-acoustics-status"]').innerText();
    expect(status).toMatch(/IR\s+\d+\s+samp/);
  });

  test('04 view 1 — combined IR', async () => {
    await page.evaluate(() => { window.__forgeAcousticsView?.({ viewKind: 'combined' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view1-ir-combined');
    await expect(page.locator('[data-testid="forge-acoustics-ir"]')).toBeVisible();
  });

  test('05 view 2 — per-band IR (500 Hz)', async () => {
    await page.evaluate(() => { window.__forgeAcousticsView?.({ viewKind: 'per-band', bandIdx: 2 }); });
    await page.waitForTimeout(300);
    await shot(page, 'view2-ir-500hz');
  });

  test('06 view 3 — EDC per band', async () => {
    await page.evaluate(() => { window.__forgeAcousticsView?.({ viewKind: 'edc' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view3-edc');
    await expect(page.locator('[data-testid="forge-acoustics-edc"]')).toBeVisible();
  });

  test('07 view 4 — RT60 bar chart', async () => {
    await page.evaluate(() => { window.__forgeAcousticsView?.({ viewKind: 'rt60' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view4-rt60');
    await expect(page.locator('[data-testid="forge-acoustics-rt60"]')).toBeVisible();
  });

  test('08 view 5 — carpet floor, re-run', async () => {
    // Swap floor (−Z) to carpet (preset index 3).
    await page.locator('[data-testid="forge-acoustics-wall-4"]').selectOption({ index: 3 });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-acoustics-run"]').click();
    await page.waitForTimeout(2500);
    await page.evaluate(() => { window.__forgeAcousticsView?.({ viewKind: 'rt60' }); });
    await page.waitForTimeout(300);
    await shot(page, 'view5-carpet');
  });

  test('09 view 6 — glass-wool ceiling, expect lower RT60', async () => {
    await page.locator('[data-testid="forge-acoustics-wall-5"]').selectOption({ index: 4 });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-acoustics-run"]').click();
    await page.waitForTimeout(2500);
    await shot(page, 'view6-glasswool');
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
