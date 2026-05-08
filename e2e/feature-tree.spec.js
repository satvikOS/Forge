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

test('feature tree has new header and sections', async ({ page }) => {
  await setup(page);

  const header = page.locator('.feature-tree-title');
  await expect(header).toContainText('Feature Manager');

  // Action buttons
  const actions = page.locator('.feature-tree-actions .ft-action-btn');
  expect(await actions.count()).toBeGreaterThanOrEqual(2);
});

test('right-click shows context menu', async ({ page }) => {
  await setup(page);

  // Create a feature
  await clickTool(page, 1, 'Extrude Boss');

  // Right-click on it
  const item = page.locator('.feature-tree-item').first();
  await item.click({ button: 'right' });
  await page.waitForTimeout(300);

  const menu = page.locator('.ft-context-menu');
  await expect(menu).toBeVisible();

  // Menu has expected items
  await expect(menu).toContainText('Edit Parameters');
  await expect(menu).toContainText('Rename');
  await expect(menu).toContainText('Suppress');
  await expect(menu).toContainText('Delete');

  await page.screenshot({ path: 'e2e/screenshots/feature-tree-context-menu.png', fullPage: true });
});

test('rollback marker visible on each feature', async ({ page }) => {
  await setup(page);

  // Create 3 features
  await clickTool(page, 1, 'Extrude Boss');
  await clickTool(page, 1, 'Revolve Boss');
  await clickTool(page, 1, 'Fillet');

  const markers = page.locator('.rollback-marker');
  const count = await markers.count();
  console.log(`Rollback markers: ${count}`);
  expect(count).toBeGreaterThanOrEqual(3);
});

test('search filter visible with 4+ features', async ({ page }) => {
  await setup(page);

  for (let i = 0; i < 4; i++) {
    await clickTool(page, 1, 'Extrude Boss');
  }

  const search = page.locator('.ft-search');
  await expect(search).toBeVisible();

  // Filter for nothing
  await search.fill('xyznotreal');
  await page.waitForTimeout(300);

  const empty = page.locator('.feature-tree-empty');
  await expect(empty).toBeVisible();
});

test('double-click name enables rename', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');

  const name = page.locator('.feature-tree-name').first();
  await name.dblclick();
  await page.waitForTimeout(300);

  const renameInput = page.locator('.ft-rename-input');
  await expect(renameInput).toBeVisible();

  await renameInput.fill('My Custom Name');
  await renameInput.press('Enter');
  await page.waitForTimeout(300);

  await expect(page.locator('.feature-tree-name').first()).toContainText('My Custom Name');
});
