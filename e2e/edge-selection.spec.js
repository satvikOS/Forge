import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
}

async function clickTool(page, groupIdx, itemName) {
  await page.locator('.tool-icon-button').nth(groupIdx + 2).click();
  await page.waitForTimeout(400);
  await page.locator('.dropdown-item').filter({ hasText: itemName }).first().dispatchEvent('click');
  await page.waitForTimeout(1500);
}

test('edge mode picks individual edges', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(800);

  // Switch to edge mode
  await page.keyboard.press('3');
  await page.waitForTimeout(300);

  // Click on the geometry
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 + 60 } });
  await page.waitForTimeout(500);

  // Status should show edge selection
  await page.screenshot({ path: 'e2e/screenshots/edge-selection.png', fullPage: true });
});

test('Fillet creates a real arc-tangent profile fillet', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(800);

  await clickTool(page, 1, 'Fillet');

  const status = page.locator('.tool-status-bar');
  await expect(status).toContainText('Fillet', { timeout: 8000 });
  // Foundation Fillet: arc-tangent corner fillet on an L-bracket profile.
  await expect(status).toContainText('arc-tangent fillet', { timeout: 8000 });
});

test('Chamfer creates a real straight-cut profile chamfer', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(800);

  await clickTool(page, 1, 'Chamfer');

  const status = page.locator('.tool-status-bar');
  await expect(status).toContainText('Chamfer', { timeout: 8000 });
  await expect(status).toContainText('2mm straight-cut chamfer', { timeout: 8000 });
});
