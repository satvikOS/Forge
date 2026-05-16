import { test, expect } from '@playwright/test';

// Drive a ribbon tool after stashing orchestration-plan params on
// window.__archdiscPlanParams — exactly what the PlanExecutor does.
async function runTool(page, tab, tool, params) {
  await page.locator('.ribbon-tab', { hasText: tab }).first().click();
  await page.waitForTimeout(400);
  if (params) {
    await page.evaluate(({ t, p }) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams[t] = p;
    }, { t: tool, p: params });
  }
  await page.locator('.ribbon-tool-label', { hasText: new RegExp(`^${tool}$`) }).first().click();
  await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
  return page.evaluate(() => window.__lastFoundationManifold.volume());
}

test.describe('Parametric geometry tools — orchestration plan params', () => {
  test.describe.configure({ timeout: 120000 });

  test('Extrude Boss honors plan params (the keystone of orchestration)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    // Default — no params: the canonical 80×50×25 box, V = 100,000.
    const vDefault = await runTool(page, 'Part', 'Extrude Boss', null);
    console.log(`\nExtrude Boss default volume: ${vDefault.toFixed(0)} mm³`);
    expect(vDefault).toBeCloseTo(100000, -1);

    // Plan params: a 100×40×30 box → V = 120,000. The plan changed
    // the geometry, not a hardcoded demo.
    const vParam = await runTool(page, 'Part', 'Extrude Boss', { width: 100, depth: 40, height: 30 });
    console.log(`Extrude Boss param volume: ${vParam.toFixed(0)} mm³ (expected 120000)`);
    expect(vParam).toBeCloseTo(120000, -1);

    // An explicit profile polygon — a 60 mm equilateral-ish triangle.
    const vProfile = await runTool(page, 'Part', 'Extrude Boss', {
      profile: [[-30, -17.32], [30, -17.32], [0, 34.64]], height: 10,
    });
    console.log(`Extrude Boss custom-profile volume: ${vProfile.toFixed(0)} mm³`);
    // Triangle area ≈ ½·60·51.96 = 1558.8 mm²; ×10 ≈ 15588 mm³.
    expect(vProfile).toBeGreaterThan(14000);
    expect(vProfile).toBeLessThan(17000);
  });

  test('Circular Pattern honors the plan count', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    // Seed cube [2,6,10] = 120 mm³. Default count 6 → 720.
    const v6 = await runTool(page, 'Part', 'Circular Pattern', null);
    console.log(`\nCircular Pattern default: ${v6.toFixed(0)} mm³`);
    expect(v6).toBeCloseTo(720, -1);

    // Plan count 8 → 8 × 120 = 960. The plan drove the pattern.
    const v8 = await runTool(page, 'Part', 'Circular Pattern', { count: 8 });
    console.log(`Circular Pattern count=8: ${v8.toFixed(0)} mm³ (expected 960)`);
    expect(v8).toBeCloseTo(960, -1);
  });

  test('Linear Pattern honors plan count + spacing', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    // Default 4× Ø6×15 cylinder seed.
    const v4 = await runTool(page, 'Part', 'Linear Pattern', null);
    // Plan: 7 copies → volume is 7/4 of the default (same seed, no overlap).
    const v7 = await runTool(page, 'Part', 'Linear Pattern', { count: 7, spacing: 25 });
    console.log(`\nLinear Pattern: 4→${v4.toFixed(0)} mm³, 7→${v7.toFixed(0)} mm³`);
    expect(v7 / v4).toBeCloseTo(7 / 4, 1);
  });
});
