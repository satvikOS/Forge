import { test, expect } from '@playwright/test';

test.describe('Manufacture preview panel — G-code overlay + download', () => {
  test.describe.configure({ timeout: 180000 });

  test('3-Axis Milling generates G-code, panel pops with stats + download', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click Manufacture tab → 3-Axis Milling
    await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^3-Axis Milling$/ }).first().click();

    const dlg = page.locator('.mpp-dialog');
    await expect(dlg).toBeVisible({ timeout: 15000 });
    await expect(dlg.locator('.mpp-title')).toContainText('3-Axis Milling');

    // Stats: 6 cells, all numeric
    const stats = dlg.locator('[data-mpp-stats] .mpp-stat-value');
    await expect(stats).toHaveCount(6);
    const values = await stats.allTextContents();
    console.log(`\nStats: ${values.join(' | ')}`);
    const totalLines = parseInt(values[0], 10);
    const g0 = parseInt(values[1], 10);
    const g1 = parseInt(values[2], 10);
    expect(totalLines).toBeGreaterThan(10);
    expect(g0 + g1).toBeGreaterThan(5);
    expect(values[4]).toMatch(/\d+\.\d+ mm/);   // cut length
    expect(values[5]).toMatch(/\d+\.\d+ (s|min)/);  // estimated time

    // G-code body has real ISO instructions
    const body = dlg.locator('[data-mpp-body]');
    const gcode = await body.textContent();
    expect(gcode).toMatch(/G0\s/);
    expect(gcode).toMatch(/G1\s/);
    expect(gcode).toMatch(/T1|T2/);            // tool select
    expect(gcode.length).toBeGreaterThan(200);

    // Human dwell
    await page.waitForTimeout(5000);

    // Download .nc and confirm filename + body
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.locator('[data-action="mpp-download"]').dispatchEvent('click'),
    ]);
    const name = dl.suggestedFilename();
    console.log(`G-code download: ${name}`);
    expect(name).toMatch(/archdisc-3-axis-milling-\d{4}-\d{2}-\d{2}\.nc/);
    const fs = await import('fs');
    const downloaded = fs.readFileSync(await dl.path(), 'utf8');
    expect(downloaded).toContain('G0');
    expect(downloaded.length).toBe(gcode.length);

    // Close → switch to 2.5-Axis Milling → preview reflects the new program
    await dlg.locator('[data-action="mpp-close"]').dispatchEvent('click');
    await expect(dlg).not.toBeVisible();

    await page.locator('.ribbon-tool-label', { hasText: /^2\.5-Axis Milling$/ }).first().click();
    await expect(dlg).toBeVisible({ timeout: 15000 });
    await expect(dlg.locator('.mpp-title')).toContainText('2.5-Axis Milling');

    // The 2.5-axis program should differ from the 3-axis one
    const gcode25 = await dlg.locator('[data-mpp-body]').textContent();
    expect(gcode25).not.toBe(gcode);
    expect(gcode25.length).toBeGreaterThan(200);

    // Window slot mirrors the latest program
    const latest = await page.evaluate(() => window.__lastCAMProgram);
    expect(latest.source).toBe('2.5-Axis Milling');
    expect(latest.stats.totalLines).toBeGreaterThan(10);
  });
});
