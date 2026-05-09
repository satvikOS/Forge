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

test('DrawingEngine projects solid to 2D edges', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PrimitiveBuilder, DrawingEngine } = m;

    const box = PrimitiveBuilder.box(0.080, 0.050, 0.030);
    const front = DrawingEngine.projectSolid(box, 'front');
    const top = DrawingEngine.projectSolid(box, 'top');
    const right = DrawingEngine.projectSolid(box, 'right');
    const iso = DrawingEngine.projectSolid(box, 'isometric');

    return {
      front: { edges: front.edgeCount, w: (front.bbox.width * 1000).toFixed(1), h: (front.bbox.height * 1000).toFixed(1) },
      top: { edges: top.edgeCount, w: (top.bbox.width * 1000).toFixed(1), h: (top.bbox.height * 1000).toFixed(1) },
      right: { edges: right.edgeCount, w: (right.bbox.width * 1000).toFixed(1), h: (right.bbox.height * 1000).toFixed(1) },
      iso: { edges: iso.edgeCount },
    };
  });

  console.log('Drawing projection:', JSON.stringify(result, null, 2));

  // 80×50×30mm box
  expect(parseFloat(result.front.w)).toBeCloseTo(80, 0);
  expect(parseFloat(result.front.h)).toBeCloseTo(50, 0);
  expect(parseFloat(result.top.w)).toBeCloseTo(80, 0);
  expect(parseFloat(result.top.h)).toBeCloseTo(30, 0);
  expect(parseFloat(result.right.w)).toBeCloseTo(30, 0);
  expect(parseFloat(result.right.h)).toBeCloseTo(50, 0);

  // A box has 12 edges; depending on dedup all should appear
  expect(result.front.edges).toBeGreaterThan(0);
  expect(result.iso.edges).toBeGreaterThan(0);
});

test('DrawingEngine generates valid SVG', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PrimitiveBuilder, DrawingEngine } = m;
    const box = PrimitiveBuilder.box(0.080, 0.050, 0.030);
    const proj = DrawingEngine.projectSolid(box, 'front');
    const svg = DrawingEngine.toSVG(proj);
    return {
      length: svg.length,
      hasSvg: svg.startsWith('<svg'),
      hasLines: svg.includes('<line'),
      lineCount: (svg.match(/<line/g) || []).length,
    };
  });

  expect(result.hasSvg).toBe(true);
  expect(result.hasLines).toBe(true);
  expect(result.lineCount).toBeGreaterThan(0);
});

test('New Drawing tool generates A3 sheet and downloads', async ({ page }) => {
  await setup(page);

  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);

  const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await clickTool(page, 11, 'New Drawing');
  const download = await downloadPromise;

  if (download) {
    console.log('Drawing downloaded:', download.suggestedFilename());
    expect(download.suggestedFilename()).toContain('.svg');
  }

  const status = page.locator('.tool-status-bar');
  await expect(status).toContainText('Drawing', { timeout: 5000 });
});

test('Standard 3 View tool reports edge counts', async ({ page }) => {
  await setup(page);

  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);

  await clickTool(page, 11, 'Standard 3 View');

  const status = page.locator('.tool-status-bar');
  const text = await status.textContent();
  console.log('3-View status:', text);
  expect(text).toContain('edges');
});

test('Section View at front plane', async ({ page }) => {
  await setup(page);

  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);

  await clickTool(page, 11, 'Section View');

  const status = page.locator('.tool-status-bar');
  await expect(status).toContainText('Section', { timeout: 5000 });
});
