import { test, expect } from '@playwright/test';

async function waitForViewport(page) {
  await page.goto('/');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
  return canvas;
}

async function clickToolGroup(page, groupIndex) {
  const btn = page.locator('.tool-icon-button').nth(groupIndex + 2);
  await btn.click();
  await page.waitForTimeout(500);
}

async function clickDropdownItem(page, name) {
  const item = page.locator('.dropdown-item').filter({ hasText: name }).first();
  await item.click();
  await page.waitForTimeout(1000);
}

test.describe('EUV Lithography Machine', () => {

  test('build complete EUV lithography machine', async ({ page }) => {
    await waitForViewport(page);

    // First click = EUV (index cycles to 0 which is EUV)
    await clickToolGroup(page, 5); // Assembly
    await clickDropdownItem(page, 'Insert Component');

    // Verify EUV assembly loaded
    const status = page.locator('.tool-status-bar');
    await expect(status).toContainText('EUV Lithography', { timeout: 10000 });

    // Wait for all parts to render
    await page.waitForTimeout(5000);

    // Screenshot
    await page.screenshot({ path: 'e2e/screenshots/euv-lithography-assembled.png', fullPage: true });
  });

  test('explode EUV machine to see all components', async ({ page }) => {
    await waitForViewport(page);

    // Build EUV
    await clickToolGroup(page, 5);
    await clickDropdownItem(page, 'Insert Component');
    await page.waitForTimeout(5000);

    // Explode
    await clickToolGroup(page, 5);
    await clickDropdownItem(page, 'Exploded View');

    const status = page.locator('.tool-status-bar');
    await expect(status).toContainText('Exploded', { timeout: 5000 });

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e/screenshots/euv-lithography-exploded.png', fullPage: true });
  });

  test('run FEA on EUV component', async ({ page }) => {
    await waitForViewport(page);

    // Create a base structure
    await clickToolGroup(page, 1); // Part Design
    await clickDropdownItem(page, 'Extrude Boss');
    await page.waitForTimeout(1000);

    // Run FEA
    await clickToolGroup(page, 9); // Simulation
    await clickDropdownItem(page, 'Linear Static FEA');

    const status = page.locator('.tool-status-bar');
    await expect(status).toContainText('MPa', { timeout: 5000 });

    await page.screenshot({ path: 'e2e/screenshots/euv-fea-analysis.png', fullPage: true });
  });

  test('display mode cycling works with EUV', async ({ page }) => {
    await waitForViewport(page);

    // Build EUV
    await clickToolGroup(page, 5);
    await clickDropdownItem(page, 'Insert Component');
    await page.waitForTimeout(5000);

    // Wireframe
    await page.keyboard.press('z');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/euv-wireframe.png', fullPage: true });

    // X-Ray
    await page.keyboard.press('z');
    await page.waitForTimeout(300);
    await page.keyboard.press('z');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/euv-xray.png', fullPage: true });
  });
});
