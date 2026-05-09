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

test('FEAVisualizer color mapping covers full gradient', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { FEAVisualizer } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    const c0 = new THREE.Color(); FEAVisualizer._mapColor(0, c0);
    const c25 = new THREE.Color(); FEAVisualizer._mapColor(0.25, c25);
    const c50 = new THREE.Color(); FEAVisualizer._mapColor(0.5, c50);
    const c100 = new THREE.Color(); FEAVisualizer._mapColor(1, c100);

    return {
      blue: c0.getHex().toString(16),
      cyan: c25.getHex().toString(16),
      green: c50.getHex().toString(16),
      red: c100.getHex().toString(16),
    };
  });

  expect(result.blue).toContain('ff'); // 0x0000ff = blue
  expect(result.green).toContain('ff00'); // 0x00ff00 = green
  expect(result.red).toMatch(/^ff/); // 0xff0000 = red
});

test('FEAVisualizer.legendSVG produces gradient legend', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { FEAEngine, PrimitiveBuilder, FEAVisualizer } = m;
    const box = PrimitiveBuilder.box(0.080, 0.050, 0.030);
    const fea = FEAEngine.linearStatic(box);
    const svg = FEAVisualizer.legendSVG(fea);
    return {
      hasSvg: svg.startsWith('<svg'),
      hasGradient: svg.includes('<linearGradient'),
      hasStops: (svg.match(/<stop/g) || []).length,
      hasLabel: svg.includes('Von Mises Stress'),
    };
  });

  expect(result.hasSvg).toBe(true);
  expect(result.hasGradient).toBe(true);
  expect(result.hasStops).toBe(5); // 5 color stops
  expect(result.hasLabel).toBe(true);
});

test('FEAVisualizer.probePoint returns stress at location', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { FEAEngine, PrimitiveBuilder, FEAVisualizer } = m;
    const box = PrimitiveBuilder.box(0.080, 0.050, 0.030);
    const fea = FEAEngine.linearStatic(box);

    const probe1 = FEAVisualizer.probePoint(fea, { x: 0, y: 0, z: 0 });
    const probe2 = FEAVisualizer.probePoint(fea, { x: 0.04, y: 0.025, z: 0.015 });

    return {
      probe1: { stress: probe1?.vonMisesMPa, dist: probe1?.distanceFromQuery },
      probe2: { stress: probe2?.vonMisesMPa, dist: probe2?.distanceFromQuery },
    };
  });

  expect(parseFloat(result.probe1.stress)).toBeGreaterThanOrEqual(0);
  expect(result.probe1.dist).toBeDefined();
});

test('Linear Static FEA tool applies stress field to mesh and reports element count', async ({ page }) => {
  await setup(page);

  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 9, 'Linear Static FEA');

  const status = page.locator('.tool-status-bar');
  await expect(status).toContainText('elem', { timeout: 5000 });
  const text = await status.textContent();
  expect(text).toMatch(/\d+ elem/);
});
