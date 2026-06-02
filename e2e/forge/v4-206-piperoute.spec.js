// v4-206-piperoute.spec.js — Forge-206 pipe routing.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-206-piperoute';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-206 · pipe routing', () => {
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

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.piperoute
         && typeof window.forge.piperoute.route === 'function'));
    expect(has).toBe(true);
  });

  test('02 direct straight route, 0 elbows (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.piperoute.route({
      start: { position: [0, 0, 0],  direction: [1, 0, 0] },
      end:   { position: [10, 0, 0], direction: [1, 0, 0] },
      obstacles: [],
      gridSpacing: 1.0, elbowPenalty: 0.5, bbMargin: 4, maxIterations: 50000,
    }));
    expect(r.found).toBe(true);
    expect(r.totalLength).toBeCloseTo(10, 6);
    expect(r.elbowCount).toBe(0);
    await shot(page, 'direct');
  });

  test('03 L-shape route, 1 elbow (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.piperoute.route({
      start: { position: [0, 0, 0], direction: [1, 0, 0] },
      end:   { position: [5, 5, 0], direction: [0, 1, 0] },
      obstacles: [],
      gridSpacing: 1.0, elbowPenalty: 0.5, bbMargin: 4, maxIterations: 50000,
    }));
    expect(r.found).toBe(true);
    expect(r.totalLength).toBeCloseTo(10, 6);
    expect(r.elbowCount).toBe(1);
    await shot(page, 'L-shape');
  });

  test('04 detour around obstacle (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.piperoute.route({
      start: { position: [0, 0, 0],  direction: [1, 0, 0] },
      end:   { position: [10, 0, 0], direction: [1, 0, 0] },
      obstacles: [{ min: [3, -2, -2], max: [7, 2, 2] }],
      gridSpacing: 1.0, elbowPenalty: 0.5, bbMargin: 6, maxIterations: 200000,
    }));
    expect(r.found).toBe(true);
    expect(r.totalLength).toBeGreaterThan(10);
    expect(r.elbowCount).toBeGreaterThanOrEqual(2);
    await shot(page, 'detour');
  });

  test('05 panel open (cam #4)', async () => {
    await page.evaluate(() => { window.__forgeOpenPipeRouteWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-piperoute-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-piperoute-run"]')).toBeVisible();
    await shot(page, 'panel-open');
  });

  test('06 panel route + SVG views (cam #5)', async () => {
    await page.locator('[data-testid="forge-piperoute-run"]').click();
    await page.waitForSelector('[data-testid="forge-piperoute-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-piperoute-result"]')).toBeVisible();
    const polylines = await page.locator('[data-testid="forge-piperoute-panel"] svg polyline').count();
    expect(polylines).toBeGreaterThanOrEqual(2);
    await shot(page, 'panel-routed');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
