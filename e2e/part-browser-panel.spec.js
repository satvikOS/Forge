import { test, expect } from '@playwright/test';

test.describe('Part Browser Panel', () => {
  test.describe.configure({ timeout: 180000 });

  test('Extruding two bosses populates the Bodies panel with rows + toggles', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    const panel = page.locator('.part-browser-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pb-empty')).toBeVisible();

    // Click Part tab → Extrude Boss
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(5000);  // dwell

    let rows = panel.locator('.pb-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.pb-name')).toContainText('Extrude Boss');
    const vol1 = await rows.first().locator('.pb-vol').textContent();
    console.log(`\nBody 1 volume: ${vol1}`);
    expect(vol1).toMatch(/cm³|mm³/);

    // Add a second body by extrude-cutting (also produces a manifold).
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Cut$/ }).first().click();
    await page.waitForTimeout(5000);

    rows = panel.locator('.pb-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).locator('.pb-name')).toContainText('Extrude Cut');

    // Hide first body — eye toggle
    const eye0 = rows.first().locator('.pb-eye');
    const before = await eye0.textContent();
    await eye0.click();
    await page.waitForTimeout(2000);
    const after = await eye0.textContent();
    expect(before).not.toEqual(after);
    // Row gets the pb-hidden class
    await expect(rows.first()).toHaveClass(/pb-hidden/);

    // Click the row again to show
    await eye0.click();
    await page.waitForTimeout(1000);
    await expect(rows.first()).not.toHaveClass(/pb-hidden/);

    // Header count chip mirrors the body count
    const countText = await panel.locator('.pb-count').textContent();
    expect(countText).toBe('2');

    // Show-all button (header) leaves visibility unchanged but is clickable
    await panel.locator('.pb-action-btn').click();
    await page.waitForTimeout(1000);

    // Verify the window registry mirrors the panel rows
    const stored = await page.evaluate(() => window.__archdiscBodies?.list?.()?.length ?? 0);
    expect(stored).toBe(2);
  });
});
