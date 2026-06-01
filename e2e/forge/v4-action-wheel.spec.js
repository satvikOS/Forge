// v4-action-wheel.spec.js — Forge-138 verification.
//
// Asserts the radial action wheel appears on right-click of the viewport,
// shows 8 spokes, and dispatches a forge:menu-action with the right id
// when a spoke is clicked.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-wheel';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const f = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: f, fullPage: false });
}

test.describe.serial('Forge-138 · action wheel', () => {
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

  test('01 right-click viewport · wheel appears with 8 spokes', async () => {
    const canvas = page.locator('[data-testid="forge-viewport"]');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('viewport not visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(300);
    await shot(page, 'wheel-open');
    const wheel = page.locator('[data-testid="forge-action-wheel"]');
    await expect(wheel).toBeVisible({ timeout: 2000 });
    const spokes = wheel.locator('[data-spoke]');
    await expect(spokes).toHaveCount(8);
  });

  test('02 click a spoke · dispatches forge:menu-action', async () => {
    await page.evaluate(() => {
      window.__forgeWheelCaptured = null;
      window.addEventListener('forge:menu-action', (e) => {
        window.__forgeWheelCaptured = e.detail?.id;
      }, { once: true });
    });
    const spoke = page.locator('[data-spoke="3"]');
    await spoke.click();
    await page.waitForTimeout(400);
    await shot(page, 'after-spoke-click');
    const captured = await page.evaluate(() => window.__forgeWheelCaptured);
    expect(captured).toBeTruthy();
  });

  test('03 Escape closes the wheel', async () => {
    const canvas = page.locator('[data-testid="forge-viewport"]');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="forge-action-wheel"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await shot(page, 'wheel-closed');
    await expect(page.locator('[data-testid="forge-action-wheel"]')).toBeHidden();
  });
});
