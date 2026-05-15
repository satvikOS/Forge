import { test, expect } from '@playwright/test';

test.describe('Section View inline preview', () => {
  test.describe.configure({ timeout: 180000 });

  test('Extrude Boss → Section View opens a hatched cross-section preview', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 1. Make a body
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. Drawing tab → Section View
    await page.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Section View$/ }).first().click();

    const dlg = page.locator('.spp-dialog');
    await expect(dlg).toBeVisible({ timeout: 15000 });
    await expect(dlg.locator('.spp-title')).toContainText('Section View');

    // 3. Inline SVG with hatch pattern + section label
    const body = dlg.locator('[data-spp-body]');
    const html = await body.innerHTML();
    expect(html).toContain('<svg');
    expect(html).toContain('hatch');                  // hatch pattern def
    expect(html).toContain('fill-rule="evenodd"');     // holes punched correctly
    expect(html.toUpperCase()).toContain('SECTION A-A');

    // Metadata stash from the handler
    const meta = await page.evaluate(() => window.__lastSectionView);
    console.log(`\nSection at z=${meta.zMid.toFixed(2)} mm: ${meta.polygonCount} polys (${meta.outerLoops} outer + ${meta.innerLoops} inner), perimeter ${meta.perimeter.toFixed(1)} mm`);
    expect(meta.polygonCount).toBeGreaterThan(0);
    expect(meta.perimeter).toBeGreaterThan(0);

    // Human dwell
    await page.waitForTimeout(5000);

    // 4. Download SVG
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.locator('[data-action="spp-download"]').dispatchEvent('click'),
    ]);
    const name = dl.suggestedFilename();
    console.log(`Section SVG download: ${name}`);
    expect(name).toMatch(/archdisc-section-\d{4}-\d{2}-\d{2}\.svg/);
    const fs = await import('fs');
    const downloaded = fs.readFileSync(await dl.path(), 'utf8');
    expect(downloaded).toContain('<?xml');
    expect(downloaded).toContain('<svg');
    expect(downloaded).toContain('SECTION A-A');

    // 5. Close
    await dlg.locator('[data-action="spp-close"]').dispatchEvent('click');
    await expect(dlg).not.toBeVisible();
  });
});
