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

test('Section View generates hatch lines', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PrimitiveBuilder, DrawingEngine } = m;
    const box = PrimitiveBuilder.box(0.080, 0.050, 0.030);
    const sec = DrawingEngine.sectionView(box, 'front', { axis: 'z', value: 0 });
    return {
      isSection: sec.isSection,
      hatchCount: sec.hatchCount,
      edgeCount: sec.edgeCount,
      sectionAxis: sec.sectionLine.axis,
    };
  });

  expect(result.isSection).toBe(true);
  expect(result.hatchCount).toBeGreaterThan(20);
  expect(result.sectionAxis).toBe('z');
});

test('Detail View magnifies a region', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PrimitiveBuilder, DrawingEngine } = m;
    const box = PrimitiveBuilder.box(0.080, 0.050, 0.030);
    const proj = DrawingEngine.projectSolid(box, 'front');
    const detail = DrawingEngine.detailView(proj, { x: 0, y: 0 }, 0.020, 3);
    return {
      isDetail: detail.isDetail,
      magnification: detail.magnification,
      edgeCount: detail.edgeCount,
      bboxW: detail.bbox.width,
    };
  });

  expect(result.isDetail).toBe(true);
  expect(result.magnification).toBe(3);
  expect(result.bboxW).toBeCloseTo(0.020 * 2 * 3, 5); // diameter * mag
});

test('BOM Table renders rows for parts', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { DrawingEngine } = m;
    const items = [
      { item: 1, name: 'Bracket', material: 'Al 6061', qty: 1, mass: 0.27 },
      { item: 2, name: 'Bolt M8', material: 'Steel', qty: 4, mass: 0.012 },
      { item: 3, name: 'Washer', material: 'Steel', qty: 4, mass: 0.003 },
    ];
    const svg = DrawingEngine.bomTable(items, { x: 0, y: 0 });
    return {
      hasGroup: svg.includes('<g'),
      hasRect: svg.includes('<rect'),
      rectCount: (svg.match(/<rect/g) || []).length,
      hasItem: svg.includes('Bracket'),
      hasMaterial: svg.includes('Al 6061'),
    };
  });

  expect(result.hasGroup).toBe(true);
  expect(result.hasItem).toBe(true);
  expect(result.hasMaterial).toBe(true);
  expect(result.rectCount).toBeGreaterThan(3);
});

test('Revision Table renders revision history', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { DrawingEngine } = m;
    const revs = [
      { rev: '01', ecn: 'INIT', date: '2026-05-01', by: 'AD' },
      { rev: '02', ecn: 'ECN-2891', date: '2026-05-08', by: 'AD' },
    ];
    const svg = DrawingEngine.revisionTable(revs);
    return {
      hasGroup: svg.includes('<g'),
      hasInit: svg.includes('INIT'),
      hasEcn: svg.includes('ECN-2891'),
    };
  });

  expect(result.hasInit).toBe(true);
  expect(result.hasEcn).toBe(true);
});

test('Section View tool reports hatch and edges', async ({ page }) => {
  await setup(page);

  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 11, 'Section View');

  const status = page.locator('.tool-status-bar');
  await expect(status).toContainText('Section', { timeout: 5000 });
  const text = await status.textContent();
  expect(text).toMatch(/hatch/i);
});

test('Detail View tool produces 2:1 inset', async ({ page }) => {
  await setup(page);

  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 11, 'Detail View');

  const status = page.locator('.tool-status-bar');
  await expect(status).toContainText('Detail', { timeout: 5000 });
});

test('Sheet with options.bomItems includes BOM table', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PrimitiveBuilder, DrawingEngine } = m;
    const box = PrimitiveBuilder.box(0.060, 0.040, 0.020);
    const items = [{ item: 1, name: 'Test Bracket', material: 'Al 6061-T6', qty: 1, mass: 0.135 }];
    const svg = DrawingEngine.generateSheet(box, {
      partName: 'Test Bracket',
      sheetSize: 'A3',
      bomItems: items,
      revisions: [{ rev: '01', ecn: 'INIT', date: '2026-05-08', by: 'AD' }],
    });
    return {
      length: svg.length,
      hasBom: svg.includes('Test Bracket') && svg.includes('Al 6061-T6'),
      hasRev: svg.includes('REV') && svg.includes('INIT'),
    };
  });

  expect(result.hasBom).toBe(true);
  expect(result.hasRev).toBe(true);
});
