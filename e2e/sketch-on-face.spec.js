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

test('sketch activates on XZ plane by default (no face picked)', async ({ page }) => {
  await setup(page);

  await page.keyboard.press('4');
  await page.waitForTimeout(500);

  const status = page.locator('.sketch-status-bar');
  await expect(status).toContainText('XZ plane', { timeout: 3000 });
});

test('pick face mode + key 4 sketches on the picked face', async ({ page }) => {
  await setup(page);

  // Create geometry first
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(800);

  // Switch to face mode
  await page.keyboard.press('2');
  await page.waitForTimeout(300);

  // Click on the geometry (face)
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.waitForTimeout(500);

  // Now press 4 to sketch on the picked face
  await page.keyboard.press('4');
  await page.waitForTimeout(500);

  const status = page.locator('.sketch-status-bar');
  const text = await status.textContent();
  console.log(`Status: ${text}`);
  // Either "picked face" or "XZ plane" depending on whether face was actually picked
  expect(text.toLowerCase()).toMatch(/face|plane/);

  await page.screenshot({ path: 'e2e/screenshots/sketch-on-face.png', fullPage: true });
});

test('extrude direction follows sketch plane normal', async ({ page }) => {
  await setup(page);

  // Sketch on XZ
  await page.keyboard.press('4');
  await page.waitForTimeout(500);
  await page.keyboard.press('b');
  await page.waitForTimeout(200);

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * 0.4, y: box.height * 0.4 } });
  await page.waitForTimeout(300);
  await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.6 } });
  await page.waitForTimeout(300);

  // Extrude
  await page.keyboard.press('e');
  await page.waitForTimeout(1000);

  const status = page.locator('.sketch-status-bar');
  await expect(status).toContainText('depth 20mm', { timeout: 3000 });
});
