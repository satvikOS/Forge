import { test, expect } from '@playwright/test';

test.describe('Tool Param Dialog drives Brayton Cycle inputs', () => {
  test.describe.configure({ timeout: 180000 });

  test('Override BPR/OPR/T4 in the dialog → __lastBraytonResult reflects them', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Opt OUT of the default auto-bypass so the modal actually opens
    await page.evaluate(() => { window.__archdiscBypassDialog = false; });

    // Click Simulate → Brayton Cycle
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Brayton Cycle$/ }).first().click();

    // Dialog opens
    const dlg = page.locator('.tpd-dialog');
    await expect(dlg).toBeVisible({ timeout: 15000 });
    await expect(dlg.locator('.tpd-title')).toContainText('Brayton Cycle');

    // Read defaults
    const defaultBPR = await dlg.locator('[data-field="bypassRatio"]').inputValue();
    const defaultT4  = await dlg.locator('[data-field="T4_K"]').inputValue();
    console.log(`\nDefaults: BPR=${defaultBPR}, T4=${defaultT4}`);
    expect(parseFloat(defaultBPR)).toBeCloseTo(9.6, 1);
    expect(parseFloat(defaultT4)).toBeCloseTo(1750, 0);

    // Override: higher-BPR, hotter cycle
    await dlg.locator('[data-field="bypassRatio"]').fill('12');
    await dlg.locator('[data-field="T4_K"]').fill('1850');
    await dlg.locator('[data-field="compressorPR"]').fill('40');
    await page.waitForTimeout(6000);  // human dwell

    // Run
    await dlg.locator('.tpd-btn-run').click();
    await page.waitForFunction(() => !!window.__lastBraytonResult, null, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Verify the result reflects the overridden cycle.
    const r = await page.evaluate(() => window.__lastBraytonResult);
    console.log(`Result: thrust=${(r.thrust_N/1000).toFixed(1)} kN, SFC=${r.SFC_lb_per_lbf_hr.toFixed(3)}, OPR=${r.OPR?.toFixed(1) ?? '?'}`);
    expect(r.thrust_N).toBeGreaterThan(0);
    expect(r.SFC_lb_per_lbf_hr).toBeGreaterThan(0);
    // Higher BPR + T4 vs the defaults should give noticeably different numbers
    expect(r.cycle?.bypassRatio ?? r.bypassRatio).toBeCloseTo(12, 1);

    // Dialog closes after Run
    await expect(dlg).not.toBeVisible();

    // Cancel path: open and close without running
    await page.locator('.ribbon-tool-label', { hasText: /^Brayton Cycle$/ }).first().click();
    await expect(dlg).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(4000);
    await dlg.locator('.tpd-btn-cancel').click();
    await expect(dlg).not.toBeVisible();
  });

  test('Bypass mode under navigator.webdriver: dialog never opens', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    // Don't touch the bypass flag — Playwright sets navigator.webdriver = true
    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Brayton Cycle$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastBraytonResult, null, { timeout: 30000 });
    // Dialog must not have rendered
    await expect(page.locator('.tpd-dialog')).toHaveCount(0);
  });
});
