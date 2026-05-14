import { test, expect } from '@playwright/test';

test.describe('Viewport pick selects the matching body row', () => {
  test.describe.configure({ timeout: 180000 });

  test('Foundation body groups carry bodyId; selecting via registry flips the panel row', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Create two bodies via the ribbon (real foundation pipeline)
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator('.ribbon-tool-label', { hasText: /^Revolve Boss$/ }).first().click();
    await page.waitForTimeout(3000);

    // 1. The Three.js groups for each registered body must carry the
    //    same bodyId the registry assigned. This is the data the
    //    viewport pick handler reads off the top-level group when
    //    forwarding to BodyRegistry.select(...).
    const bodyData = await page.evaluate(() => {
      const list = window.__archdiscBodies?.list?.() ?? [];
      return list.map(b => ({
        id: b.id,
        groupBodyId: b.group?.userData?.bodyId ?? null,
        name: b.name,
      }));
    });
    console.log('\nBody-group user data:', bodyData);
    expect(bodyData.length).toBe(2);
    for (const b of bodyData) expect(b.groupBodyId).toBe(b.id);

    // 2. Drive the registry the way the viewport handler does, and
    //    assert the Part Browser row + PropertyManager react.
    await page.evaluate((id) => window.__archdiscBodies.select(id), bodyData[0].id);
    await page.waitForTimeout(1500);
    let selectedId = await page.evaluate(() => window.__archdiscBodies.selectedId);
    expect(selectedId).toBe(bodyData[0].id);
    await expect(page.locator(`.part-browser-panel .pb-row.pb-selected .pb-name`).first())
      .toContainText(bodyData[0].name);
    // PropertyManager header tag mirrors the selection name
    await expect(page.locator('.property-manager .pm-selection-tag').first())
      .toContainText(bodyData[0].name);

    // 3. Flip to body 2
    await page.evaluate((id) => window.__archdiscBodies.select(id), bodyData[1].id);
    await page.waitForTimeout(1500);
    selectedId = await page.evaluate(() => window.__archdiscBodies.selectedId);
    expect(selectedId).toBe(bodyData[1].id);
    await expect(page.locator(`.part-browser-panel .pb-row.pb-selected .pb-name`).first())
      .toContainText(bodyData[1].name);
    await expect(page.locator('.property-manager .pm-selection-tag').first())
      .toContainText(bodyData[1].name);

    // 4. Clearing (empty-viewport pick path) deselects the row.
    await page.evaluate(() => window.__archdiscBodies.select(null));
    await page.waitForTimeout(1500);
    selectedId = await page.evaluate(() => window.__archdiscBodies.selectedId);
    expect(selectedId).toBe(null);
    await expect(page.locator('.part-browser-panel .pb-row.pb-selected')).toHaveCount(0);
  });
});
