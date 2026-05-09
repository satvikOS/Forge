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

test('PartNumbering generates valid numbers from schemes', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PartNumbering } = m;
    PartNumbering.reset(1);
    return {
      sequential: PartNumbering.generate('sequential'),
      prefixed: PartNumbering.generate('prefixed', { prefix: 'BKT' }),
      project: PartNumbering.generate('project', { project: 'GMA001', prefix: 'BKT' }),
      intelligent: PartNumbering.generate('intelligent', { type: 'BKT', size: 80, mat: 'AL6' }),
      iso: PartNumbering.generate('iso', { category: 5 }),
      validProject: PartNumbering.validate('GMA001-BKT-0006', 'project').valid,
      validIntelligent: PartNumbering.validate('BKT-080-AL6-0007', 'intelligent').valid,
    };
  });

  console.log('Part numbers:', result);
  expect(result.sequential).toMatch(/^\d{6}$/);
  expect(result.prefixed).toMatch(/^BKT-\d{5}$/);
  expect(result.intelligent).toMatch(/^BKT-080-AL6-\d{4}$/);
  expect(result.validProject).toBe(true);
  expect(result.validIntelligent).toBe(true);
});

test('CostingEngine produces realistic cost breakdown', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CostingEngine } = m;
    return CostingEngine.analyze({
      massKg: 0.270,
      material: 'Aluminum 6061-T6',
      machineTimeMin: 8,
      process: 'cnc_3axis',
      setupTimeMin: 30,
      finishing: 'anodize_clear',
      batchSize: 100,
      marginPercent: 30,
    });
  });

  console.log('Cost analysis:', JSON.stringify(result, null, 2));
  // 270g aluminum + 8 min CNC + setup + clear anodize, batch 100
  expect(parseFloat(result.perPart.materialCost)).toBeGreaterThan(1.5);
  expect(parseFloat(result.perPart.materialCost)).toBeLessThan(3);
  expect(parseFloat(result.perPart.machiningCost)).toBeCloseTo(85 * 8 / 60, 1);
  expect(parseFloat(result.perPart.totalCost)).toBeGreaterThan(parseFloat(result.perPart.materialCost));
  expect(parseFloat(result.perPart.sellPrice)).toBeGreaterThan(parseFloat(result.perPart.totalCost));
});

test('CostingEngine.batchPricingCurve drops cost with quantity', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CostingEngine } = m;
    return CostingEngine.batchPricingCurve({
      massKg: 0.150,
      material: 'Aluminum 6061-T6',
      machineTimeMin: 5,
      process: 'cnc_3axis',
      setupTimeMin: 30,
      toolingCostUSD: 500,
    }, [1, 10, 100, 1000]);
  });

  expect(result.length).toBe(4);
  // Cost per part should drop as batch increases (setup amortization)
  expect(result[0].unitCost).toBeGreaterThan(result[3].unitCost);
});

test('Sustainability.analyze produces realistic CO2 footprint', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { Sustainability } = m;
    return Sustainability.analyze({
      massKg: 0.270,
      material: 'Aluminum 6061-T6',
      process: 'cnc_3axis',
      transportKm: 500,
      region: 'global_avg',
    });
  });

  console.log('Sustainability:', JSON.stringify(result, null, 2));
  // 270g aluminum at 11.5 kg CO2/kg = ~3.1 kg CO2 from material alone
  expect(parseFloat(result.total.co2eKg)).toBeGreaterThan(2);
  expect(parseFloat(result.total.co2eKg)).toBeLessThan(8);
  expect(['A', 'B', 'C', 'D', 'E']).toContain(result.total.rating);
  expect(result.recyclability.recyclablePercent).toBe('95'); // Al 6061
  expect(result.dominant).toBeDefined();
});

test('Sustainability.suggestAlternatives ranks by reduction', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { Sustainability } = m;
    return Sustainability.suggestAlternatives({
      massKg: 0.150,
      material: 'Aluminum 6061-T6',
      process: 'cnc_3axis',
      transportKm: 500,
      region: 'global_avg',
    });
  });

  expect(result.alternatives.length).toBeGreaterThan(2);
  expect(result.bestAlternative).toBeDefined();
  // First alternative has highest reduction (or smallest negative penalty)
  expect(result.alternatives[0]).toBe(result.bestAlternative);
});

test('Cost Estimation tool shows full breakdown', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 10, 'Cost Estimation');

  const status = page.locator('.tool-status-bar');
  const text = await status.textContent();
  console.log('Cost Estimation:', text);
  expect(text).toContain('Material');
  expect(text).toContain('Machining');
  expect(text).toContain('Sell');
});

test('Sustainability tool reports CO2 + score + rating', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 10, 'Sustainability Check');

  const status = page.locator('.tool-status-bar');
  const text = await status.textContent();
  console.log('Sustainability:', text);
  expect(text).toContain('CO');
  expect(text).toMatch(/Score|Rating|Recyclable/i);
});
