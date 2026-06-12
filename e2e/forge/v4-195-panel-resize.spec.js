// Forge-195 — drag-to-resize right panel (parity ledger UIUX gap).
const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

test('Forge-195 · right panel drag-resize + persistence', async () => {
  test.setTimeout(120000);
  const app = await _electron.launch({ args: [ELECTRON_MAIN, '--no-sandbox'], env: { ...process.env, FORGE_E2E: '1' } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {} });
  await page.reload();
  await page.waitForSelector('[data-testid="forge-right"]', { timeout: 20000 });

  const before = await page.locator('[data-testid="forge-right"]').boundingBox();
  const handle = await page.locator('[data-testid="forge-right-resize"]').boundingBox();
  await page.mouse.move(handle.x + 3, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x - 120, handle.y + 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.locator('[data-testid="forge-right"]').boundingBox();
  expect(after.width).toBeGreaterThan(before.width + 80);

  // Persistence across reload
  await page.reload();
  await page.waitForSelector('[data-testid="forge-right"]', { timeout: 20000 });
  const reloaded = await page.locator('[data-testid="forge-right"]').boundingBox();
  expect(Math.abs(reloaded.width - after.width)).toBeLessThan(8);

  await app.close();
});
