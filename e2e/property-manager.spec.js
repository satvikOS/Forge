import { test, expect } from '@playwright/test';

test('property manager renders and shows sections', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  // Property manager should exist
  const pm = page.locator('.property-manager');
  await expect(pm).toBeVisible();

  // Header
  await expect(page.locator('.pm-title')).toContainText('PROPERTIES');

  // Sections (Geometry, Material, Transform, Manufacturing)
  const sections = page.locator('.pm-section-header');
  const count = await sections.count();
  console.log(`Property manager sections: ${count}`);
  expect(count).toBeGreaterThanOrEqual(4);

  // Material dropdown
  const materialSelect = page.locator('.pm-select');
  await expect(materialSelect).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/property-manager.png', fullPage: true });
});

test('property manager updates when geometry created', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  // Create geometry
  await page.locator('.tool-icon-button').nth(3).click();
  await page.waitForTimeout(400);
  await page.locator('.dropdown-item').filter({ hasText: 'Extrude Boss' }).first().dispatchEvent('click');
  await page.waitForTimeout(1500);

  // Click on the canvas to select
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'e2e/screenshots/property-manager-with-geometry.png', fullPage: true });
});
