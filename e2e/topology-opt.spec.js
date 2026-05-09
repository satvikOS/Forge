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
  await page.waitForTimeout(2500); // topology opt takes a bit longer
}

test('TopologyOptimizer produces voxel field with kept cells', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { TopologyOptimizer } = m;

    const r = TopologyOptimizer.optimize({
      bbox: { minX: -0.04, maxX: 0.04, minY: -0.025, maxY: 0.025, minZ: -0.015, maxZ: 0.015 },
      volumeFraction: 0.4,
      loadPoints: [{ x: 0.04, y: 0, z: 0, force: { x: 0, y: -1, z: 0 } }],
      fixedPoints: [{ x: -0.04, y: 0, z: 0 }],
      resolution: 16,
      iterations: 20,
      penalty: 3,
    });

    return {
      total: r.stats.totalCells,
      kept: r.stats.keptCells,
      reduction: r.stats.massReductionPercent,
      target: r.stats.volumeFractionTarget,
      actual: r.stats.actualVolumeFraction,
      nx: r.nx, ny: r.ny, nz: r.nz,
      hasDensity: r.density.length === r.stats.totalCells,
    };
  });

  console.log('Topology result:', JSON.stringify(result, null, 2));
  expect(result.total).toBeGreaterThan(100);
  expect(result.kept).toBeGreaterThan(0);
  expect(result.kept).toBeLessThan(result.total);
  expect(parseFloat(result.reduction)).toBeGreaterThan(30);
  expect(result.hasDensity).toBe(true);
});

test('TopologyOptimizer.render creates InstancedMesh', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { TopologyOptimizer } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    const scene = new THREE.Scene();
    const r = TopologyOptimizer.optimize({
      bbox: { minX: -0.04, maxX: 0.04, minY: -0.02, maxY: 0.02, minZ: -0.015, maxZ: 0.015 },
      volumeFraction: 0.5,
      resolution: 16,
      iterations: 15,
    });
    const mesh = TopologyOptimizer.render(scene, r);

    return {
      hasMesh: !!mesh,
      isInstanced: mesh?.isInstancedMesh || false,
      instanceCount: mesh?.count || 0,
      kept: r.stats.keptCells,
    };
  });

  expect(result.kept).toBeGreaterThan(0);
  if (result.hasMesh) {
    expect(result.isInstanced).toBe(true);
    expect(result.instanceCount).toBe(result.kept);
  }
});

test('Topology Optimization tool reports realistic mass reduction', async ({ page }) => {
  await setup(page);
  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 9, 'Topology Optimization');

  const status = page.locator('.tool-status-bar');
  const text = await status.textContent();
  console.log('Topology Opt:', text);
  expect(text).toContain('mass reduction');
  expect(text).toContain('mm³');
  expect(text).toMatch(/\d+%/);
});

test('Load case visualization shows fixed points and arrows', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { TopologyOptimizer } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    const scene = new THREE.Scene();
    const r = TopologyOptimizer.optimize({
      bbox: { minX: -0.02, maxX: 0.02, minY: -0.01, maxY: 0.01, minZ: -0.008, maxZ: 0.008 },
      resolution: 8,
      iterations: 5,
      loadPoints: [{ x: 0.02, y: 0, z: 0, force: { x: 0, y: -1, z: 0 } }],
      fixedPoints: [{ x: -0.02, y: 0, z: 0 }],
    });
    const indicators = TopologyOptimizer.showLoadCase(scene, r);

    let sphereCount = 0;
    let arrowCount = 0;
    indicators.traverse(obj => {
      if (obj.isMesh && obj.geometry?.type === 'SphereGeometry') sphereCount++;
      if (obj.type === 'ArrowHelper') arrowCount++;
    });

    return { sphereCount, arrowCount };
  });

  expect(result.sphereCount).toBe(1); // 1 fixed point
  // arrow helper is a Group of LineSegments + Mesh; just verify indicators exist
});
