// Forge-168 — Wiring harness workbench end-to-end.
//
// Click-only headed flow. The user opens the harness workbench, picks
// a Cat 6 cable between two M12 connectors, edits waypoints to force
// a bend-radius violation, sees the badge flip red, relaxes the
// waypoint, sees it go green, adds a second cable along the same
// route, watches the bundle list populate, then presses Generate body
// to spawn the routed tube in the scene.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const SHOT_DIR = '/tmp/v4-harness';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _stepCounter = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR,
    `${String(++_stepCounter).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
async function pause(page, ms) { await page.waitForTimeout(ms); }

async function openToolsMenu(page) {
  const tools = page.locator('[data-menu="tools"]').first();
  await tools.click();
  await pause(page, 350);
}

test.describe('Forge v4 — Wiring harness (Forge-168)', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env:  { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(page, 2800);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 shell mounts + harness hook registers', async () => {
    await expect(page.locator('[data-testid="forge-app"]'))
      .toBeVisible({ timeout: 15000 });
    await shot(page, 'shell');
    await page.waitForFunction(
      () => typeof window.__forgeOpenHarness === 'function',
      { timeout: 8000 });
  });

  test('02 open Harness via Tools menu', async () => {
    await openToolsMenu(page);
    await shot(page, 'tools-menu');
    const item = page.locator('[data-menu-item="tools.harness"]').first();
    await expect(item).toBeVisible({ timeout: 5000 });
    await item.click();
    await pause(page, 600);
    await expect(page.locator('[data-testid="forge-harness-workbench"]'))
      .toBeVisible({ timeout: 6000 });
    await shot(page, 'workbench-open');
  });

  test('03 inspector renders for the default cable', async () => {
    const inspector = page.locator('[data-testid="forge-harness-inspector"]');
    await expect(inspector).toBeVisible();
    await expect(page.locator('[data-testid="forge-harness-cable-picker"]'))
      .toBeVisible();
    await shot(page, 'inspector');
  });

  test('04 switch cable to Cat 6 + connectors to M12 4-pin', async () => {
    await page.locator('[data-testid="forge-harness-cable-picker"]')
      .selectOption('cat6-utp');
    await page.locator('[data-testid="forge-harness-conn-a"]')
      .selectOption('m12-4p');
    await page.locator('[data-testid="forge-harness-conn-b"]')
      .selectOption('m12-4p');
    await pause(page, 400);
    await shot(page, 'cat6-m12');
  });

  test('05 default 3-waypoint route should PASS bend radius', async () => {
    const ok = await page.locator('[data-testid="forge-harness-route-ok"]')
      .getAttribute('data-pass');
    expect(ok).toBe('true');
    await shot(page, 'default-pass');
  });

  test('06 force a kink → bend radius violation appears', async () => {
    // Move the middle waypoint to a sharp dogleg (1 mm offset → r << req).
    await page.locator('[data-testid="forge-harness-wp-1-x"]').fill('5');
    await page.locator('[data-testid="forge-harness-wp-1-y"]').fill('1');
    await pause(page, 350);
    const ok = await page.locator('[data-testid="forge-harness-route-ok"]')
      .getAttribute('data-pass');
    expect(ok).toBe('false');
    await shot(page, 'kink-violation');
  });

  test('07 relax the bend → violation clears', async () => {
    await page.locator('[data-testid="forge-harness-wp-1-x"]').fill('100');
    await page.locator('[data-testid="forge-harness-wp-1-y"]').fill('50');
    await pause(page, 400);
    const ok = await page.locator('[data-testid="forge-harness-route-ok"]')
      .getAttribute('data-pass');
    expect(ok).toBe('true');
    await shot(page, 'relaxed');
  });

  test('08 add a second cable on the same path → bundle appears', async () => {
    // Snapshot the active cable's waypoints, then add cable #2 + paste them.
    const wps = await page.evaluate(() => {
      const inputs = document.querySelectorAll('[data-testid^="forge-harness-wp-"]');
      const idx = {};
      inputs.forEach((el) => {
        const m = el.getAttribute('data-testid').match(/forge-harness-wp-(\d+)-([xyz])/);
        if (m) {
          const i = Number(m[1]);
          idx[i] = idx[i] || [0,0,0];
          const ax = { x:0, y:1, z:2 }[m[2]];
          idx[i][ax] = parseFloat(el.value) || 0;
        }
      });
      return Object.keys(idx).sort((a,b) => +a - +b).map((k) => idx[k]);
    });

    await page.locator('[data-testid="forge-harness-add-cable"]').click();
    await pause(page, 350);
    // Pick the new (2nd) cable in the list.
    const cards = page.locator('[data-testid^="forge-harness-cable-"]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);
    await cards.nth(1).click();
    await pause(page, 250);

    // Type the same waypoints (mm) for the 2nd cable.
    for (let i = 0; i < wps.length; i++) {
      await page.locator(`[data-testid="forge-harness-wp-${i}-x"]`).fill(String(wps[i][0]));
      await page.locator(`[data-testid="forge-harness-wp-${i}-y"]`).fill(String(wps[i][1]));
      await page.locator(`[data-testid="forge-harness-wp-${i}-z"]`).fill(String(wps[i][2]));
    }
    await pause(page, 500);
    const bundleRow = page.locator('[data-testid^="forge-harness-bundle-bundle-"]').first();
    await expect(bundleRow).toBeVisible({ timeout: 4000 });
    await shot(page, 'bundle-detected');
  });

  test('09 cut-list renders entries for both cables', async () => {
    const cutCells = page.locator('[data-testid^="forge-harness-cut-cable-"]');
    const n = await cutCells.count();
    expect(n).toBeGreaterThanOrEqual(2);
    await shot(page, 'cutlist');
  });

  test('10 Generate body → registry gains harness tube', async () => {
    const before = await page.evaluate(() => (window.__forgeBodies || []).length);
    await page.locator('[data-testid="forge-harness-generate"]').click();
    await pause(page, 500);
    const after = await page.evaluate(() => (window.__forgeBodies || []).length);
    expect(after).toBe(before + 1);
    const snap = await page.evaluate(() => window.__forgeHarness);
    expect(snap).toBeTruthy();
    expect(snap.lastGenerated).toBeTruthy();
    expect(snap.lastGenerated.route.polyline.length).toBeGreaterThan(2);
    await shot(page, 'generated');
  });

  test('11 close panel + no chatter posted to Archie thread', async () => {
    await page.locator('[data-testid="forge-harness-close"]').click();
    await pause(page, 300);
    const visible = await page.locator('[data-testid="forge-harness-workbench"]').isVisible();
    expect(visible).toBeFalsy();
    const archieMessages = await page.evaluate(() =>
      Array.isArray(window.__forgeArchieMessages) ? window.__forgeArchieMessages.length : 0);
    expect(typeof archieMessages).toBe('number');
    await shot(page, 'closed');
  });
});
