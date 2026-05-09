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

test('StockSimulator builds voxel grid from bbox', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { StockSimulator } = m;
    const stock = StockSimulator.buildStock(
      { minX: 0, maxX: 0.080, minY: 0, maxY: 0.050, minZ: 0, maxZ: 0.030 },
      32
    );
    return {
      nx: stock.nx, ny: stock.ny, nz: stock.nz,
      total: stock.totalVoxels,
      cellMm: (stock.cellSize * 1000).toFixed(3),
    };
  });

  expect(result.total).toBeGreaterThan(1000);
  expect(parseFloat(result.cellMm)).toBeGreaterThan(0);
});

test('StockSimulator removes voxels by tool position', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { StockSimulator } = m;
    const stock = StockSimulator.buildStock(
      { minX: -0.020, maxX: 0.020, minY: -0.020, maxY: 0.020, minZ: -0.020, maxZ: 0.020 },
      20
    );
    const removed = StockSimulator.removeAt(stock, { x: 0, y: 0, z: 0 }, 0.005);
    return {
      removed,
      removedCount: stock.removedCount,
      total: stock.totalVoxels,
    };
  });

  expect(result.removed).toBeGreaterThan(0);
  expect(result.removedCount).toBe(result.removed);
});

test('MoldFlow.analyze produces realistic injection molding results', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PrimitiveBuilder, MoldFlow } = m;
    const part = PrimitiveBuilder.box(0.080, 0.002, 0.050); // 80×2×50mm thin part
    const flow = MoldFlow.analyze(part, { material: 'ABS', wallThickness: 0.002 });
    return {
      material: flow.material,
      fillTime: flow.fillTimeSec,
      coolTime: flow.coolingTimeSec,
      cycleTime: flow.cycleTimeSec,
      clampTons: flow.clampForceTons,
      warpMm: flow.warpageMm,
      meltC: flow.meltTempC,
      pass: flow.pass,
      issues: flow.issues,
    };
  });

  console.log('Mold flow:', JSON.stringify(result, null, 2));
  expect(result.material).toBe('ABS');
  expect(parseFloat(result.fillTime)).toBeGreaterThan(0);
  expect(parseFloat(result.coolTime)).toBeGreaterThan(0);
  expect(parseFloat(result.cycleTime)).toBeGreaterThan(parseFloat(result.coolTime));
  expect(result.meltC).toBe(230); // ABS melt temp
});

test('MoldFlow.toolingEstimate computes cost and breakeven', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PrimitiveBuilder, MoldFlow } = m;
    const part = PrimitiveBuilder.box(0.060, 0.005, 0.040);
    const tooling = MoldFlow.toolingEstimate(part, { cavities: 4, annualVolume: 100000 });
    return {
      toolCost: parseFloat(tooling.toolCostUSD),
      partCost: parseFloat(tooling.partCostUSD),
      throughput: tooling.throughputPerHour,
      breakEven: tooling.breakEvenUnits,
      profitable: tooling.profitable,
    };
  });

  expect(result.toolCost).toBeGreaterThan(5000);
  expect(result.partCost).toBeGreaterThan(0);
  expect(result.throughput).toBeGreaterThan(0);
  expect(result.breakEven).toBeGreaterThan(0);
});

test('Mold Flow tool reports realistic cycle time', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 10, 'Mold Flow');

  const status = page.locator('.tool-status-bar');
  const text = await status.textContent();
  console.log('Mold Flow:', text);
  expect(text).toMatch(/Cycle|Fill|Clamp/i);
});

test('Verify Toolpath simulates stock removal', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 10, '2.5-Axis Milling');
  await page.waitForTimeout(1000);
  await clickTool(page, 10, 'Verify Against Stock');

  const status = page.locator('.tool-status-bar');
  const text = await status.textContent();
  console.log('Verify:', text);
  expect(text).toMatch(/voxels|Removed|Stock/i);
});
