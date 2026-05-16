import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.locator('.ribbon-tab', { hasText: 'Assembly' }).first().click();
  await page.waitForTimeout(500);
}

test.describe('Motion ribbon tools', () => {
  test.describe.configure({ timeout: 120000 });

  test('Motion Study ribbon → live slider-crank kinematics', async ({ page }) => {
    await openApp(page);
    await page.locator('.ribbon-tool-label', { hasText: /^Motion Study$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastMotionStudy, null, { timeout: 20000 });

    const r = await page.evaluate(() => window.__lastMotionStudy);
    console.log(`\nMotion Study: ${r.mechanism}, DOF ${r.dof}, ${r.frameCount} frames, ` +
      `stroke ${r.pistonStrokeMM.toFixed(1)} mm, converged=${r.allConverged}`);
    expect(r.mechanism).toBe('slider-crank');
    expect(r.dof).toBe(1);
    expect(r.frameCount).toBe(120);
    expect(r.allConverged).toBe(true);
    // Slider-crank stroke is exactly 2·r = 80 mm.
    expect(r.pistonStrokeMM).toBeGreaterThan(79);
    expect(r.pistonStrokeMM).toBeLessThan(80.5);
    expect(r.maxLinearSpeed).toBeGreaterThan(0);
    expect(r.animating).toBe(true);

    // The animation loop is running and a mechanism group is in the scene.
    expect(await page.evaluate(() => !!window.__archdiscAnimRAF)).toBe(true);
  });

  test('Assembly Animation ribbon → mate-graph assembly sequence', async ({ page }) => {
    await openApp(page);
    await page.locator('.ribbon-tool-label', { hasText: /^Assembly Animation$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastAssemblyAnimation, null, { timeout: 20000 });

    const r = await page.evaluate(() => window.__lastAssemblyAnimation);
    console.log(`\nAssembly Animation: order [${r.order.join(' → ')}], ${r.partCount} parts, ${r.frameCount} frames`);
    expect(r.partCount).toBe(4);
    expect(r.frameCount).toBe(96);
    // Base first; the gear (mated only to the shaft) comes after the shaft.
    expect(r.order[0]).toBe('base');
    expect(r.order.indexOf('gear')).toBeGreaterThan(r.order.indexOf('shaft'));
    expect(r.animating).toBe(true);
    expect(await page.evaluate(() => !!window.__archdiscAnimRAF)).toBe(true);
  });
});
