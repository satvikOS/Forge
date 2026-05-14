import { test, expect } from '@playwright/test';

test.describe('Design History Panel', () => {
  test.describe.configure({ timeout: 180000 });

  test('Foundation tool clicks populate the history panel', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // History panel renders, starts empty
    const panel = page.locator('.design-history-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.dh-empty')).toBeVisible();

    // Click Simulate tab → Brayton Cycle
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.waitForTimeout(600);
    await page.locator('.ribbon-tool-label', { hasText: /^Brayton Cycle$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastBraytonResult, null, { timeout: 30000 });
    await page.waitForTimeout(7000); // dwell so a human sees the row pop in

    let rows = panel.locator('.dh-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.dh-tool')).toHaveText('Brayton Cycle');
    await expect(rows.first().locator('.dh-headline')).not.toBeEmpty();

    // Click Combustor
    await page.locator('.ribbon-tool-label', { hasText: /^Combustor$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastCombustorResult, null, { timeout: 30000 });
    await page.waitForTimeout(7000);

    rows = panel.locator('.dh-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).locator('.dh-tool')).toHaveText('Combustor');

    // Click Blade Cooling
    await page.locator('.ribbon-tool-label', { hasText: /^Blade Cooling$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastBladeCoolingResult, null, { timeout: 30000 });
    await page.waitForTimeout(7000);

    rows = panel.locator('.dh-row');
    await expect(rows).toHaveCount(3);
    const headlines = await rows.locator('.dh-headline').allTextContents();
    console.log('\nDesign history headlines:');
    for (const h of headlines) console.log(`  ${h}`);
    // Every row must show a non-empty headline
    for (const h of headlines) expect(h.length).toBeGreaterThan(0);

    // Clear and confirm empty state
    await panel.locator('.dh-clear-btn').click();
    await page.waitForTimeout(1500);
    await expect(panel.locator('.dh-empty')).toBeVisible();
  });
});
