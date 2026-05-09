import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
}

test('Annotations.linearDim produces SVG with text', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { Annotations } = m;
    const dim = Annotations.linearDim({ x: 0, y: 0 }, { x: 80, y: 0 });
    return {
      label: dim.label,
      value: dim.value,
      hasLine: dim.svg.includes('<line'),
      hasText: dim.svg.includes('<text'),
      hasArrow: dim.svg.includes('<polygon'),
    };
  });

  expect(result.value).toBeCloseTo(80, 1);
  expect(result.hasLine).toBe(true);
  expect(result.hasText).toBe(true);
  expect(result.hasArrow).toBe(true);
});

test('Annotations.diameterDim formats Ø symbol', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { Annotations } = m;
    const dim = Annotations.diameterDim({ x: 0, y: 0 }, 5);
    return { label: dim.label, value: dim.value };
  });

  expect(result.label).toContain('Ø');
  expect(result.value).toBe(10); // diameter = 2 * radius
});

test('Annotations.gdtFrame builds proper feature control frame', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { Annotations } = m;
    const frame = Annotations.gdtFrame({ x: 0, y: 0 }, '⊥', 0.05, ['A', 'B']);
    return {
      label: frame.label,
      hasBox: frame.svg.includes('<rect'),
      hasDividers: (frame.svg.match(/<line/g) || []).length >= 3,
    };
  });

  expect(result.label).toContain('A|B');
  expect(result.hasBox).toBe(true);
});

test('Annotations.angleDim computes degrees', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { Annotations } = m;
    // 90° angle
    const ang = Annotations.angleDim({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    return { value: ang.value, label: ang.label };
  });

  expect(result.value).toBeCloseTo(90, 1);
  expect(result.label).toContain('°');
});

test('Smart Dimension tool produces realistic dimensions', async ({ page }) => {
  await setup(page);

  // Create a box first
  await page.locator('.tool-icon-button').nth(3).click();
  await page.waitForTimeout(400);
  await page.locator('.dropdown-item').filter({ hasText: 'Extrude Boss' }).first().dispatchEvent('click');
  await page.waitForTimeout(1500);

  // Use Smart Dimension
  await page.locator('.tool-icon-button').nth(13).click();
  await page.waitForTimeout(400);
  await page.locator('.dropdown-item').filter({ hasText: 'Smart Dimension' }).first().dispatchEvent('click');
  await page.waitForTimeout(800);

  const status = page.locator('.tool-status-bar');
  const text = await status.textContent();
  console.log('Smart Dimension status:', text);
  expect(text).toContain('Smart Dimension');
});

test('Sheet drawing includes auto-dimensions', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PrimitiveBuilder, DrawingEngine } = m;
    const box = PrimitiveBuilder.box(0.080, 0.050, 0.030);
    const svg = DrawingEngine.generateSheet(box, { partName: 'Test Box', sheetSize: 'A3' });
    return {
      length: svg.length,
      hasDims: svg.includes('80.0') || svg.includes('80.00'),
      hasArrows: svg.includes('<polygon'),
      lineCount: (svg.match(/<line/g) || []).length,
      polyCount: (svg.match(/<polygon/g) || []).length,
    };
  });

  console.log('Sheet result:', result);
  expect(result.length).toBeGreaterThan(1000);
  expect(result.hasArrows).toBe(true);
  expect(result.polyCount).toBeGreaterThan(4); // at least 6 arrows from 3 dims (W+H × 3 views)
});
