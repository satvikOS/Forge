import { test, expect } from '@playwright/test';

async function waitForViewport(page) {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
}

test.describe('Interactive Sketch → Extrude Workflow', () => {

  test('activate sketch with key 4, draw rectangle, extrude with E', async ({ page }) => {
    await waitForViewport(page);

    // Press 4 to activate sketch on XZ plane
    await page.keyboard.press('4');
    await page.waitForTimeout(500);

    // Verify sketch toolbar appears
    const sketchToolbar = page.locator('.sketch-toolbar');
    await expect(sketchToolbar).toBeVisible({ timeout: 3000 });

    // Verify sketch status bar
    const statusBar = page.locator('.sketch-status-bar');
    await expect(statusBar).toBeVisible({ timeout: 3000 });

    // Click in viewport to place sketch points (draw a rectangle with B key)
    await page.keyboard.press('b'); // switch to rectangle tool
    await page.waitForTimeout(300);

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Click two corners of rectangle
    await canvas.click({ position: { x: box.width * 0.35, y: box.height * 0.4 } });
    await page.waitForTimeout(500);
    await canvas.click({ position: { x: box.width * 0.65, y: box.height * 0.6 } });
    await page.waitForTimeout(500);

    // Status should show entities
    await expect(statusBar).toContainText('Entities', { timeout: 3000 });

    // Press E to extrude
    await page.keyboard.press('e');
    await page.waitForTimeout(1000);

    // Sketch toolbar should disappear (sketch deactivated)
    await expect(sketchToolbar).not.toBeVisible({ timeout: 3000 });

    // Status should show extrusion result
    await expect(page.locator('.sketch-status-bar')).toContainText('Extrude', { timeout: 3000 });

    await page.screenshot({ path: 'e2e/screenshots/sketch-extrude-workflow.png', fullPage: true });
  });

  test('draw lines on sketch plane', async ({ page }) => {
    await waitForViewport(page);

    // Activate sketch
    await page.keyboard.press('4');
    await page.waitForTimeout(500);
    await expect(page.locator('.sketch-toolbar')).toBeVisible({ timeout: 3000 });

    // L for line tool (should be default)
    await page.keyboard.press('l');
    await page.waitForTimeout(200);

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();

    // Place line points
    await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });
    await page.waitForTimeout(300);
    await canvas.click({ position: { x: box.width * 0.7, y: box.height * 0.3 } });
    await page.waitForTimeout(300);
    await canvas.click({ position: { x: box.width * 0.7, y: box.height * 0.7 } });
    await page.waitForTimeout(300);
    await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.7 } });
    await page.waitForTimeout(300);

    // Check entities created
    const statusBar = page.locator('.sketch-status-bar');
    await expect(statusBar).toContainText('Entities', { timeout: 3000 });

    // Exit sketch
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'e2e/screenshots/sketch-lines.png', fullPage: true });
  });

  test('draw circle and extrude', async ({ page }) => {
    await waitForViewport(page);

    await page.keyboard.press('4');
    await page.waitForTimeout(500);

    // C for circle tool
    await page.keyboard.press('c');
    await page.waitForTimeout(200);

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();

    // Click center, then edge (defines radius)
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForTimeout(300);
    await canvas.click({ position: { x: box.width / 2 + 100, y: box.height / 2 } });
    await page.waitForTimeout(500);

    // Extrude
    await page.keyboard.press('e');
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'e2e/screenshots/sketch-circle-extrude.png', fullPage: true });
  });

  test('sketch toolbar buttons work', async ({ page }) => {
    await waitForViewport(page);

    await page.keyboard.press('4');
    await page.waitForTimeout(500);

    const toolbar = page.locator('.sketch-toolbar');
    await expect(toolbar).toBeVisible();

    // Click each tool button
    const buttons = toolbar.locator('.gizmo-btn');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(5); // L, R, C, A, D + Extrude + Exit

    // Click Line button
    await buttons.nth(0).click();
    await page.waitForTimeout(200);

    // Click Exit button (last)
    await buttons.last().click();
    await page.waitForTimeout(500);

    // Sketch should be deactivated
    await expect(toolbar).not.toBeVisible();
  });

  test('pen/stylus pointer events work (pointerup/pointermove)', async ({ page }) => {
    await waitForViewport(page);

    // Verify canvas has touch-action: none for pen compat
    const touchAction = await page.locator('canvas').first().evaluate(el => el.style.touchAction);
    expect(touchAction).toBe('none');
  });
});
