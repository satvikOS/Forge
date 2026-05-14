import { test, expect } from '@playwright/test';

test.describe('Body selection wires PropertyManager', () => {
  test.describe.configure({ timeout: 180000 });

  test('Selecting a body in the Part Browser updates PropertyManager values', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Create body 1: Extrude Boss (V = 100000 mm³)
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Create body 2: Revolve Boss (different volume)
    await page.locator('.ribbon-tool-label', { hasText: /^Revolve Boss$/ }).first().click();
    await page.waitForTimeout(5000);

    // Confirm two bodies exist
    const bodies = await page.evaluate(() => window.__archdiscBodies?.list?.());
    expect(bodies.length).toBe(2);
    const v1 = bodies[0].volume_mm3;
    const v2 = bodies[1].volume_mm3;
    console.log(`\nBody 1 (${bodies[0].name}): ${v1.toFixed(0)} mm³`);
    console.log(`Body 2 (${bodies[1].name}): ${v2.toFixed(0)} mm³`);
    expect(Math.abs(v1 - v2)).toBeGreaterThan(1000);   // visibly different

    const rows = page.locator('.part-browser-panel .pb-row');
    await expect(rows).toHaveCount(2);

    // PropertyManager: select body 1, read displayed volume
    await rows.first().click();
    await page.waitForTimeout(1500);
    await expect(rows.first()).toHaveClass(/pb-selected/);
    const volRow1 = await readPmVolumeMm3(page);
    console.log(`PM with body 1 selected: ${volRow1.toFixed(0)} mm³`);
    expect(Math.abs(volRow1 - v1) / v1).toBeLessThan(0.01); // 1% tolerance

    // Select body 2
    await rows.nth(1).click();
    await page.waitForTimeout(1500);
    await expect(rows.nth(1)).toHaveClass(/pb-selected/);
    await expect(rows.first()).not.toHaveClass(/pb-selected/);
    const volRow2 = await readPmVolumeMm3(page);
    console.log(`PM with body 2 selected: ${volRow2.toFixed(0)} mm³`);
    expect(Math.abs(volRow2 - v2) / v2).toBeLessThan(0.01);

    // Selection-tag header reflects the body name
    const tag = await page.locator('.property-manager .pm-selection-tag').first().textContent();
    console.log(`PM header tag: "${tag}"`);
    expect(tag).toMatch(/Revolve Boss|Extrude Boss|Body/);
  });
});

/** Parse the Volume row in PropertyManager back into mm³. */
async function readPmVolumeMm3(page) {
  const rows = page.locator('.property-manager .pm-section.expanded .pm-row');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const label = (await rows.nth(i).locator('span').first().textContent())?.trim();
    if (label === 'Volume') {
      const val = (await rows.nth(i).locator('.pm-value').textContent())?.trim() ?? '';
      const m = val.match(/([0-9]+\.?[0-9]*)\s*(mm³|cm³|m³)/);
      if (!m) throw new Error(`Could not parse PM volume row: "${val}"`);
      const x = parseFloat(m[1]);
      if (m[2] === 'cm³') return x * 1000;
      if (m[2] === 'm³')  return x * 1e9;
      return x;
    }
  }
  throw new Error('Volume row not found in PropertyManager');
}
