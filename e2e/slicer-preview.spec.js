import { test, expect } from '@playwright/test';

test.describe('Slicer layer preview', () => {
  test.describe.configure({ timeout: 180000 });

  test('Extrude Boss → Slice Preview opens a scrubable layer viewer', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 1. Build a body
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. Manufacture tab → Slice Preview
    await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Slice Preview$/ }).first().click();

    const dlg = page.locator('.slp-dialog');
    await expect(dlg).toBeVisible({ timeout: 15000 });
    await expect(dlg.locator('.slp-title')).toContainText('Slice Preview');

    // 3. Layer data on window
    const data = await page.evaluate(() => window.__lastSliceLayers);
    console.log(`\nSlice: ${data.layerCount} layers @ ${data.layerHeight} mm, ${data.sampled} sampled`);
    expect(data.layerCount).toBeGreaterThan(10);
    expect(data.layers.length).toBeGreaterThan(0);
    expect(data.layers[0].loops.length).toBeGreaterThan(0);

    // SVG renders the first layer
    const svg = dlg.locator('[data-slp-svg]');
    await expect(svg).toBeVisible();
    expect(await svg.locator('path').count()).toBeGreaterThan(0);

    // 4. Scrub the slider to the last layer
    const slider = dlg.locator('[data-slp-slider]');
    const maxVal = await slider.getAttribute('max');
    console.log(`Slider max = ${maxVal}`);
    expect(parseInt(maxVal, 10)).toBeGreaterThan(5);
    await slider.fill(maxVal);
    await page.waitForTimeout(500);
    const zText = await dlg.locator('[data-slp-z]').textContent();
    console.log(`Last-layer z: ${zText}`);
    // Top layer z should be ~ the part height (Extrude Boss is 25 mm)
    const z = parseFloat(zText.replace(/[^\d.]/g, ''));
    expect(z).toBeGreaterThan(5);

    // 5. Toggle to Stack (isometric) mode — scrub to a mid layer first
    //    so the stack has several layers to project.
    await slider.fill(String(Math.floor(parseInt(maxVal, 10) / 2)));
    await page.waitForTimeout(400);
    await dlg.locator('[data-action="slp-mode"]').click();
    await page.waitForTimeout(500);
    const isoSvg = dlg.locator('[data-slp-iso]');
    await expect(isoSvg).toBeVisible();
    // The stack draws every layer up to idx → many more paths than
    // a single flat layer.
    const isoPaths = await isoSvg.locator('path').count();
    console.log(`Iso stack paths at mid layer: ${isoPaths}`);
    expect(isoPaths).toBeGreaterThan(10);
    // Toggle back to flat
    await dlg.locator('[data-action="slp-mode"]').click();
    await page.waitForTimeout(400);
    await expect(dlg.locator('[data-slp-iso]')).toHaveCount(0);

    // 6. Play button animates
    await dlg.locator('[data-action="slp-play"]').click();
    await page.waitForTimeout(2500);
    await expect(dlg.locator('.slp-title')).toContainText('Slice Preview');

    // Human dwell
    await page.waitForTimeout(3000);

    // 6. Close
    await dlg.locator('[data-action="slp-close"]').dispatchEvent('click');
    await expect(dlg).not.toBeVisible();
  });
});
