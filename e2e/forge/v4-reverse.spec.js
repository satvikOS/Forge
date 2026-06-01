// Forge-161 — Reverse Engineering headed e2e (click-only).
//
// Strict headed Mac-Electron flow per project memory
// feedback-headed-tests.
//
// Flow:
//   01 launch + baseline
//   02 open Tools → Reverse Engineering…
//   03 load the built-in sample sphere cloud
//   04 click Fit Sphere — assert primitive row appears
//   05 click Auto-segment — assert ≥ 1 primitive
//   06 click Poisson mesh — assert mesh summary shows verts/tris
//   07 toggle theme + capture
//   08 history list is populated

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-reverse';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-161 · Reverse Engineering workbench headed', () => {
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

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 baseline · shell mounted', async () => {
    await shot(page, 'baseline');
    await expect(page.locator('[data-testid="forge-wb-rail"]')).toBeVisible();
  });

  test('02 open Reverse Engineering via Tools menu', async () => {
    await page.click('[data-menu="tools"]');
    await page.waitForTimeout(250);
    const item = page.locator('[role="menuitem"]', { hasText: /Reverse Engineering/i }).first();
    await expect(item).toBeVisible({ timeout: 2000 });
    await item.click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="forge-reverse-workbench"]'))
      .toBeVisible({ timeout: 3000 });
    await shot(page, 'reverse-open');
  });

  test('03 load sample sphere cloud', async () => {
    await page.click('[data-testid="forge-reverse-load-sample"]');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-reverse-preview"]'))
      .toBeVisible({ timeout: 1500 });
    await expect(page.locator('[data-testid="forge-reverse-status"]'))
      .toContainText(/synthetic sphere/);
    await shot(page, 'cloud-loaded');
  });

  test('04 fit sphere — primitive appears in table', async () => {
    await page.click('[data-testid="forge-reverse-fit-sphere"]');
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="forge-reverse-primitives-table"]'))
      .toBeVisible({ timeout: 2000 });
    await expect(page.locator('[data-testid="forge-reverse-primitives-table"] tbody tr'))
      .toHaveCount(1, { timeout: 1500 });
    await shot(page, 'sphere-fit');
  });

  test('05 auto-segment scan into multiple primitives', async () => {
    await page.click('[data-testid="forge-reverse-segment"]');
    await page.waitForTimeout(1500);
    const rows = await page.locator('[data-testid="forge-reverse-primitives-table"] tbody tr').count();
    expect(rows).toBeGreaterThanOrEqual(1);
    await shot(page, 'segmented');
  });

  test('06 Poisson mesh reconstruction', async () => {
    await page.click('[data-testid="forge-reverse-poisson"]');
    // Poisson on the sample sphere with gridRes=40 runs in ~1-2s.
    await page.waitForTimeout(2500);
    await expect(page.locator('[data-testid="forge-reverse-mesh-summary"]'))
      .toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="forge-reverse-mesh-summary"]'))
      .toContainText(/triangles/);
    await shot(page, 'poisson-mesh');
  });

  test('07 toggle theme', async () => {
    await page.click('[data-menu="view"]');
    await page.waitForTimeout(200);
    await page.locator('[role="menuitem"]', { hasText: /Toggle theme/i }).first().click();
    await page.waitForTimeout(400);
    await shot(page, 'light-theme');
    await page.click('[data-menu="view"]');
    await page.waitForTimeout(200);
    await page.locator('[role="menuitem"]', { hasText: /Toggle theme/i }).first().click();
    await page.waitForTimeout(400);
  });

  test('08 history list shows events', async () => {
    await expect(page.locator('[data-testid="forge-reverse-history"]')).toBeVisible();
    const text = await page.locator('[data-testid="forge-reverse-history"]').innerText();
    expect(text.length).toBeGreaterThan(20);
    await shot(page, 'final');
  });
});
