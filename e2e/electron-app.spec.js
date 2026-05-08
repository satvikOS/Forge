import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import path from 'path';

/**
 * E2E tests for the ArchDisc Electron desktop app.
 * Launches the app, verifies viewport, creates geometry, runs analysis.
 */

test.describe('ArchDisc Desktop App', () => {

  let electronApp;
  let page;

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..', 'electron', 'main.js')],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    page = await electronApp.firstWindow();
    await page.waitForTimeout(5000); // wait for app to fully load
  });

  test.afterAll(async () => {
    if (electronApp) await electronApp.close();
  });

  test('app window opens with correct title', async () => {
    const title = await page.title();
    expect(title).toContain('ArchDisc');
  });

  test('viewport canvas renders', async () => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(200);
    expect(box.height).toBeGreaterThan(200);
  });

  test('toolbar is visible with tool buttons', async () => {
    const tools = page.locator('.tool-icon-button');
    const count = await tools.count();
    expect(count).toBeGreaterThan(5);
  });

  test('create geometry via Extrude Boss', async () => {
    const toolButtons = page.locator('.tool-icon-button');
    await toolButtons.nth(3).click(); // Part Design
    await page.waitForTimeout(500);
    const item = page.locator('.dropdown-item').filter({ hasText: 'Extrude Boss' }).first();
    await item.dispatchEvent('click');
    await page.waitForTimeout(1000);

    const status = page.locator('.tool-status-bar');
    await expect(status).toContainText('Extrude Boss', { timeout: 5000 });
  });

  test('feature tree updates', async () => {
    const items = page.locator('.feature-tree-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('display mode cycling works', async () => {
    await page.keyboard.press('z');
    await page.waitForTimeout(300);
    const label = page.locator('.selection-mode-label').last();
    await expect(label).toContainText('Wire');
  });

  test('FEA analysis runs', async () => {
    const toolButtons = page.locator('.tool-icon-button');
    await toolButtons.nth(11).click(); // Simulation
    await page.waitForTimeout(500);
    const fea = page.locator('.dropdown-item').filter({ hasText: 'Linear Static FEA' }).first();
    await fea.dispatchEvent('click');
    await page.waitForTimeout(1000);

    const status = page.locator('.tool-status-bar');
    await expect(status).toContainText('MPa', { timeout: 5000 });
  });

  test('screenshot of desktop app', async () => {
    await page.screenshot({ path: 'e2e/screenshots/electron-desktop-app.png', fullPage: true });
  });
});
