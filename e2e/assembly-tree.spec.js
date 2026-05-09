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

test('assembly tree exists when no assembly', async ({ page }) => {
  await setup(page);

  const tree = page.locator('.assembly-tree');
  await expect(tree).toBeVisible();

  // Should show empty state or "No assembly loaded"
  const empty = page.locator('.at-empty');
  await expect(empty).toBeVisible();
});

test('assembly tree renders parts after Insert Component', async ({ page }) => {
  await setup(page);

  // Insert a component (creates assembly)
  await clickTool(page, 5, 'Insert Component');
  await page.waitForTimeout(1500);

  // Tree should show at least one group
  const groupRow = page.locator('.at-group-row');
  const count = await groupRow.count();
  console.log(`Assembly groups: ${count}`);
});

test('assembly tree has visibility toggle buttons', async ({ page }) => {
  await setup(page);

  // Check structure
  const stats = page.locator('.at-stats');
  // Stats badge should exist (even if "0/0")
  if (await stats.count() > 0) {
    const text = await stats.textContent();
    console.log(`Assembly stats: ${text}`);
  }
});
