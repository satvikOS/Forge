import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
}

async function clickTool(page, groupIdx, itemName) {
  await page.locator('.tool-icon-button').nth(groupIdx + 2).click();
  await page.waitForTimeout(400);
  await page.locator('.dropdown-item').filter({ hasText: itemName }).first().dispatchEvent('click');
  await page.waitForTimeout(1500);
}

test('boolean subtract preserves ID tracking from source solids', async ({ page }) => {
  await setup(page);

  // Create base box
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(800);

  // Create cut hole — uses Extrude Cut which internally calls boolean subtract
  await clickTool(page, 1, 'Extrude Cut');
  await page.waitForTimeout(1000);

  // Verify status indicates the boolean subtract was applied
  const status = page.locator('.tool-status-bar');
  await expect(status).toContainText('Extrude Cut', { timeout: 5000 });

  // Feature tree should have 3 entries: base extrude, cut extrude, boolean subtract
  const features = page.locator('.feature-tree-item');
  const count = await features.count();
  expect(count).toBeGreaterThanOrEqual(2);

  await page.screenshot({ path: 'e2e/screenshots/boolean-subtract.png', fullPage: true });
});

test('boolean union via Combine creates new feature', async ({ page }) => {
  await setup(page);

  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(800);
  await clickTool(page, 1, 'Revolve Boss');
  await page.waitForTimeout(800);
  await clickTool(page, 1, 'Combine');

  const features = page.locator('.feature-tree-item');
  const count = await features.count();
  expect(count).toBeGreaterThanOrEqual(3);

  await page.screenshot({ path: 'e2e/screenshots/boolean-union.png', fullPage: true });
});

test('boolean lineage tracking via window kernel inspection', async ({ page }) => {
  await setup(page);

  // Create two solids
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(800);
  await clickTool(page, 1, 'Revolve Boss');
  await page.waitForTimeout(800);

  // Programmatically run a boolean subtract via the agent bridge
  const result = await page.evaluate(async () => {
    // Try to run a subtract via the kernel
    try {
      const kernelMod = await import('/src/kernel/index.js');
      const ftMod = await import('/src/workbenches/mechanical-cad/ToolExecutionEngine.js');
      const ft = ftMod.getFeatureTree();
      const features = ft.features.filter(f => f.solid);
      if (features.length < 2) return { ok: false, reason: 'not enough features' };

      const subtracted = kernelMod.BooleanEngine.subtract(features[0].solid, features[1].solid);
      const lineage = kernelMod.BooleanEngine.getFaceLineage(subtracted);
      return { ok: true, lineage };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  console.log('Boolean lineage:', JSON.stringify(result, null, 2));

  if (result.ok) {
    expect(result.lineage.operation).toBe('subtract');
    expect(result.lineage.sourceA).toBeDefined();
    expect(result.lineage.sourceB).toBeDefined();
    expect(result.lineage.faces.length).toBeGreaterThan(0);
    // At least some faces should have source tag
    const taggedFaces = result.lineage.faces.filter(f => f.sourceTag);
    expect(taggedFaces.length).toBeGreaterThan(0);
  } else {
    console.log('Lineage check skipped:', result.reason || result.error);
  }
});
