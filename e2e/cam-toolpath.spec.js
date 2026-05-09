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

test('ToolLibrary creates tools with proper specs', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { ToolLibrary } = m;
    const endmill = ToolLibrary.createTool('endmill_flat', 0.006, null, 4);
    const ball = ToolLibrary.createTool('endmill_ball', 0.004, null, 2);
    const drill = ToolLibrary.createTool('drill_twist', 0.005, null, 2);
    return {
      endmill: { name: endmill.typeName, dia: endmill.diameterMm, flutes: endmill.flutes },
      ball: { name: ball.typeName, dia: ball.diameterMm, cornerRadius: ball.cornerRadius },
      drill: { name: drill.typeName, dia: drill.diameterMm, pointAngle: drill.pointAngle },
      types: ToolLibrary.availableTypes(),
      materials: ToolLibrary.availableMaterials(),
    };
  });

  expect(result.endmill.name).toContain('Flat');
  expect(parseFloat(result.endmill.dia)).toBeCloseTo(6, 1);
  expect(result.endmill.flutes).toBe(4);
  expect(result.ball.cornerRadius).toBeCloseTo(0.002, 5); // dia/2 for ball nose
  expect(result.drill.pointAngle).toBe(118);
  expect(result.types.length).toBeGreaterThanOrEqual(7);
  expect(result.materials.length).toBeGreaterThanOrEqual(5);
});

test('ToolLibrary recommends realistic speeds and feeds', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { ToolLibrary } = m;
    const tool = ToolLibrary.createTool('endmill_flat', 0.010, null, 4);
    const al = ToolLibrary.recommendSpeedsFeeds(tool, 'Aluminum 6061-T6');
    const steel = ToolLibrary.recommendSpeedsFeeds(tool, 'Steel AISI 1020');
    const ti = ToolLibrary.recommendSpeedsFeeds(tool, 'Titanium Ti-6Al-4V');
    return { al, steel, ti };
  });

  // Aluminum should have highest RPM, titanium lowest
  expect(result.al.rpm).toBeGreaterThan(result.steel.rpm);
  expect(result.steel.rpm).toBeGreaterThan(result.ti.rpm);
  expect(result.al.feedRate).toBeGreaterThan(0);
  expect(result.al.coolant).toBe('flood');
});

test('CAMVisualizer parses G-code into moves', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CAMVisualizer } = m;
    const gcode = `
G90 G21
G0 X10 Y10 Z5
G1 Z-2 F100
G1 X50 F800
G1 Y50
G0 Z5
G0 X0 Y0
M30
`;
    const moves = CAMVisualizer.parseGCode(gcode);
    const stats = CAMVisualizer.stats(moves);
    return {
      moveCount: moves.length,
      types: moves.map(m => m.type),
      stats,
    };
  });

  console.log('CAM parse result:', JSON.stringify(result, null, 2));
  expect(result.moveCount).toBeGreaterThan(0);
  expect(result.stats.rapidMoves).toBeGreaterThan(0);
  expect(result.stats.cutMoves).toBeGreaterThan(0);
});

test('2.5-Axis Milling renders toolpath in scene with realistic params', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 10, '2.5-Axis Milling');

  const status = page.locator('.tool-status-bar');
  const text = await status.textContent();
  console.log('Milling status:', text);
  expect(text).toContain('RPM');
  expect(text).toContain('mm/min');
  expect(text).toContain('moves');
  expect(text).toContain('min');
});

test('toolpath segments are color-coded by type', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CAMVisualizer } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    const scene = new THREE.Scene();
    const moves = CAMVisualizer.parseGCode(`
G90 G21
G0 X10 Y10 Z5
G1 Z-2 F100
G1 X50 F800
G1 Y50
G0 Z5
M30
`);
    const group = CAMVisualizer.renderToolpath(scene, moves);

    // Find LineSegments by toolpath type
    const types = [];
    group.traverse(obj => {
      if (obj.userData?.toolpathType) types.push(obj.userData.toolpathType);
    });

    return { types, segmentCount: group.userData.segmentCount };
  });

  expect(result.types.length).toBeGreaterThan(0);
  expect(result.types).toContain('rapid');
});
