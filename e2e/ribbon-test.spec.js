import { test, expect } from '@playwright/test';

test('ribbon toolbar renders with tabs and tools', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  // Verify ribbon exists
  const ribbon = page.locator('.ribbon-container');
  await expect(ribbon).toBeVisible();

  // Verify tabs
  const tabs = page.locator('.ribbon-tab');
  const tabCount = await tabs.count();
  console.log(`Ribbon tabs: ${tabCount}`);
  expect(tabCount).toBeGreaterThanOrEqual(5);

  // Verify tools in default tab (Part)
  const tools = page.locator('.ribbon-tool');
  const toolCount = await tools.count();
  console.log(`Tools in Part tab: ${toolCount}`);
  expect(toolCount).toBeGreaterThanOrEqual(10);

  // Click Sketch tab
  await page.locator('.ribbon-tab').filter({ hasText: 'Sketch' }).click();
  await page.waitForTimeout(300);
  const sketchTools = await page.locator('.ribbon-tool').count();
  console.log(`Tools in Sketch tab: ${sketchTools}`);

  // Click Simulate tab
  await page.locator('.ribbon-tab').filter({ hasText: 'Simulate' }).click();
  await page.waitForTimeout(300);
  const simTools = await page.locator('.ribbon-tool').count();
  console.log(`Tools in Simulate tab: ${simTools}`);

  // Click a tool from the ribbon
  await page.locator('.ribbon-tab').filter({ hasText: 'Part' }).click();
  await page.waitForTimeout(300);
  await page.locator('.ribbon-tool').filter({ hasText: 'Extrude Boss' }).click();
  await page.waitForTimeout(1500);

  const status = page.locator('.tool-status-bar');
  await expect(status).toContainText('Extrude Boss', { timeout: 5000 });

  await page.screenshot({ path: 'e2e/screenshots/ribbon-ui.png', fullPage: true });
});
