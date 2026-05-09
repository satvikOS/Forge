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
  await page.waitForTimeout(2000);
}

test('CFDEngine.analyze produces realistic Reynolds and drag', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CFDEngine, PrimitiveBuilder } = m;
    const obstacle = PrimitiveBuilder.box(0.05, 0.05, 0.05);
    return CFDEngine.analyze({ solid: obstacle, fluid: 'air', inletVelocity: 30 });
  });

  console.log('CFD analysis:', JSON.stringify(result, null, 2));
  // 50mm cube at 30 m/s in air: Re ~ 1.013e+5
  expect(parseFloat(result.reynolds)).toBeGreaterThan(1e4);
  expect(parseFloat(result.reynolds)).toBeLessThan(1e7);
  expect(['turbulent (low)', 'turbulent (high)', 'laminar', 'transitional'].some(r => result.regime.includes(r.split(' ')[0]))).toBe(true);
  expect(parseFloat(result.dragCoefficient)).toBeGreaterThan(0.3);
  expect(parseFloat(result.dragForceN)).toBeGreaterThan(0);
});

test('Different fluids produce expected Reynolds differences', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CFDEngine, PrimitiveBuilder } = m;
    const obstacle = PrimitiveBuilder.box(0.02, 0.02, 0.02);
    return {
      air: CFDEngine.analyze({ solid: obstacle, fluid: 'air', inletVelocity: 5 }),
      water: CFDEngine.analyze({ solid: obstacle, fluid: 'water', inletVelocity: 5 }),
      honey: CFDEngine.analyze({ solid: obstacle, fluid: 'honey', inletVelocity: 5 }),
    };
  });

  // Water has lower viscosity than honey at same velocity, so Re should be much higher
  expect(parseFloat(result.water.reynolds)).toBeGreaterThan(parseFloat(result.honey.reynolds));
  // Air much less dense — Re depends on ρL/μ ratio (kinematic viscosity)
  console.log('Re air/water/honey:', result.air.reynolds, result.water.reynolds, result.honey.reynolds);
});

test('CFDEngine.streamlines traces lines around obstacle', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CFDEngine } = m;
    const lines = CFDEngine.streamlines({
      bbox: { min: { x: -0.1, y: -0.05, z: -0.05 }, max: { x: 0.1, y: 0.05, z: 0.05 } },
      inletVelocity: 10,
      flowDirection: '+x',
      seedCount: 9,
      obstacleCenter: { x: 0, y: 0, z: 0 },
      obstacleRadius: 0.015,
    });
    return {
      count: lines.length,
      avgLength: lines.reduce((s, l) => s + l.length, 0) / lines.length,
      hasVelocityData: lines[0]?.[0]?.vMag !== undefined,
    };
  });

  console.log('Streamlines:', result);
  expect(result.count).toBeGreaterThan(0);
  expect(result.avgLength).toBeGreaterThan(2);
  expect(result.hasVelocityData).toBe(true);
});

test('CFDEngine.renderStreamlines creates colored Line objects', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CFDEngine } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    const scene = new THREE.Scene();
    const lines = CFDEngine.streamlines({
      bbox: { min: { x: -0.05, y: -0.025, z: -0.025 }, max: { x: 0.05, y: 0.025, z: 0.025 } },
      inletVelocity: 5,
      seedCount: 9,
      obstacleCenter: { x: 0, y: 0, z: 0 },
      obstacleRadius: 0.008,
    });
    const renderResult = CFDEngine.renderStreamlines(scene, lines);

    let lineCount = 0;
    if (renderResult?.group) {
      renderResult.group.traverse(obj => { if (obj.isLine) lineCount++; });
    }
    return {
      hasGroup: !!renderResult?.group,
      lineCount,
      minV: parseFloat(renderResult?.minV || 0),
      maxV: parseFloat(renderResult?.maxV || 0),
    };
  });

  expect(result.hasGroup).toBe(true);
  expect(result.lineCount).toBeGreaterThan(0);
  expect(result.maxV).toBeGreaterThanOrEqual(result.minV);
});

test('CFD Flow Simulation tool reports realistic flow data', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 9, 'CFD Flow Simulation');

  const status = page.locator('.tool-status-bar');
  const text = await status.textContent();
  console.log('CFD tool:', text);
  expect(text).toMatch(/Re|Reynolds/);
  expect(text).toContain('Cd');
  expect(text).toContain('streamlines');
});
