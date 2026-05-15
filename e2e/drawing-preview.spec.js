import { test, expect } from '@playwright/test';

test.describe('Drawing preview panel + download', () => {
  test.describe.configure({ timeout: 180000 });

  test('Extrude Boss → Standard 3 View opens preview with 3 views + title block', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 1. Create a body via Extrude Boss so the drawing has real geometry.
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. Drawing tab → Standard 3 View
    await page.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Standard 3 View$/ }).first().click();

    // Preview overlay must appear
    const dlg = page.locator('.dpp-dialog');
    await expect(dlg).toBeVisible({ timeout: 15000 });
    await expect(dlg.locator('.dpp-title')).toContainText('Engineering Drawing');

    // Inline SVG with the 3 view labels
    const body = dlg.locator('[data-dpp-body]');
    const html = await body.innerHTML();
    expect(html).toContain('<svg');
    expect(html.toUpperCase()).toContain('FRONT');
    expect(html.toUpperCase()).toContain('TOP');
    expect(html.toUpperCase()).toContain('SIDE');
    expect(html.toUpperCase()).toContain('ISO');
    expect(html).toContain('Material');     // title block

    // Metadata stash
    const meta = await page.evaluate(() => window.__last3ViewResult);
    console.log(`\nDrawing: ${(meta.sizeBytes / 1024).toFixed(1)} KB, ${meta.numLines} lines, ${meta.numPolylines} polylines, title block: ${meta.hasTitleBlock}`);
    expect(meta.hasTitleBlock).toBe(true);
    expect(meta.numLines + meta.numPolylines).toBeGreaterThan(10);

    // Human dwell so the user watching the headed run sees the drawing
    await page.waitForTimeout(5000);

    // 3. Click Download SVG and capture the download
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.locator('[data-action="dpp-download"]').dispatchEvent('click'),
    ]);
    const name = dl.suggestedFilename();
    console.log(`SVG download: ${name}`);
    expect(name).toMatch(/archdisc-drawing-\d{4}-\d{2}-\d{2}\.svg/);
    const fs = await import('fs');
    const downloaded = fs.readFileSync(await dl.path(), 'utf8');
    expect(downloaded).toContain('<?xml');
    expect(downloaded).toContain('<svg');
    expect(downloaded.length).toBe(meta.sizeBytes);

    // 4. Close button
    await dlg.locator('[data-action="dpp-close"]').dispatchEvent('click');
    await expect(dlg).not.toBeVisible();
  });
});
