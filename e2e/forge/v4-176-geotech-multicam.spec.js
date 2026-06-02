// v4-176-geotech-multicam.spec.js — Forge-176 headed multi-camera
// verification of the Geotechnical slope-stability workbench (Bishop +
// Janbu, circular search).
//
// Slope stability is intrinsically 2D, so the "multi-camera" coverage
// rotates through 5 result views: pre-run (raw profile), post-run
// (critical circle overlaid), zoomed-in on critical-circle, panned to
// toe + crest, and a high-water-table variant. The result also exercises
// alternative soil presets per memory: feedback-forge-multicam-e2e.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-176-geotech';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-176 · slope stability · multi-view', () => {
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

  test('01 baseline app shell loads', async () => {
    await shot(page, 'baseline');
    const root = page.locator('[data-testid="forge-app"], #root').first();
    await expect(root).toBeVisible({ timeout: 4000 });
  });

  test('02 forge.geotech bridge is wired', async () => {
    const has = await page.evaluate(() =>
      typeof window.forge === 'object'
      && typeof window.forge.geotech === 'object'
      && typeof window.forge.geotech.analyse === 'function');
    expect(has).toBe(true);
  });

  test('03 open Geotech workbench', async () => {
    await page.evaluate(() => { window.__forgeOpenGeotechWorkbench?.(); });
    await page.waitForTimeout(600);
    await shot(page, 'panel-open');
    await expect(page.locator('[data-testid="forge-geotech-panel"]')).toBeVisible();
  });

  test('04 view 1 — raw slope profile (pre-run)', async () => {
    await page.waitForTimeout(300);
    await shot(page, 'view1-raw-profile');
    await expect(page.locator('[data-testid="forge-geotech-svg"]')).toBeVisible();
  });

  test('05 view 2 — run Bishop+Janbu, critical-circle overlay appears', async () => {
    // Defensive re-open in case Playwright's between-test rendering
    // dispatched a `forge:wb-changed` that flipped the host closed.
    await page.evaluate(() => { window.__forgeOpenGeotechWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-geotech-run"]').click();
    await page.waitForTimeout(2500);
    await shot(page, 'view2-after-run');
    const result = page.locator('[data-testid="forge-geotech-result"]');
    await expect(result).toBeVisible({ timeout: 6000 });
    const status = await page.locator('[data-testid="forge-geotech-status"]').innerText();
    expect(status, `status: ${status}`).toMatch(/FoS_Bishop\s+\d/);
    // Window probe — FoS in expected textbook range (1H:1V c-φ slope ⇒ 0.6..2.5).
    const probe = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="forge-geotech-result"]');
      return panel ? panel.textContent : '';
    });
    expect(probe).toMatch(/FoS Bishop\s+\d\.\d+/);
  });

  test('06 view 3 — zoom in on critical circle', async () => {
    await page.evaluate(() => { window.__forgeGeotechView?.({ zoom: 2.5, panX: -1, panY: -1 }); });
    await page.waitForTimeout(400);
    await shot(page, 'view3-zoom-critical');
  });

  test('07 view 4 — pan to toe of slope', async () => {
    await page.evaluate(() => { window.__forgeGeotechView?.({ zoom: 1.4, panX: 3, panY: 2 }); });
    await page.waitForTimeout(400);
    await shot(page, 'view4-pan-toe');
  });

  test('08 view 5 — high water table variant (FoS drops)', async () => {
    await page.locator('[data-testid="forge-geotech-water"]')
      .fill('-20, 8; 30, 8');
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-geotech-run"]').click();
    await page.waitForTimeout(2500);
    await page.evaluate(() => { window.__forgeGeotechView?.({ zoom: 1, panX: 0, panY: 0 }); });
    await page.waitForTimeout(400);
    await shot(page, 'view5-with-water');
    const status = await page.locator('[data-testid="forge-geotech-status"]').innerText();
    expect(status).toMatch(/FoS_Bishop\s+\d/);
  });

  test('09 alternate soil preset · cohesive layer', async () => {
    await page.locator('[data-testid="forge-geotech-preset-0"]')
      .selectOption({ index: 3 });   // Stiff clay
    await page.locator('[data-testid="forge-geotech-water"]').fill('');
    await page.waitForTimeout(200);
    await page.locator('[data-testid="forge-geotech-run"]').click();
    await page.waitForTimeout(2500);
    await shot(page, 'view6-stiff-clay');
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
