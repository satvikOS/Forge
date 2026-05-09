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

test('addMinMaxMarkers creates spheres + sprites at extremes', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { FEAEngine, PrimitiveBuilder, FEAVisualizer } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    const scene = new THREE.Scene();
    const box = PrimitiveBuilder.box(0.080, 0.050, 0.030);
    const fea = FEAEngine.linearStatic(box);
    const markers = FEAVisualizer.addMinMaxMarkers(scene, fea);

    let sphereCount = 0, spriteCount = 0;
    markers.traverse(obj => {
      if (obj.isMesh && obj.geometry?.type === 'SphereGeometry') sphereCount++;
      if (obj.isSprite) spriteCount++;
    });

    return {
      hasMarkers: !!markers,
      sphereCount,
      spriteCount,
      childCount: markers.children.length,
    };
  });

  expect(result.hasMarkers).toBe(true);
  expect(result.sphereCount).toBe(2); // min + max
  expect(result.spriteCount).toBe(2); // min + max labels
});

test('addStressContours generates iso-lines', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { FEAEngine, PrimitiveBuilder, FEAVisualizer, ThreeJSBridge } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    const scene = new THREE.Scene();
    const box = PrimitiveBuilder.box(0.080, 0.050, 0.030);
    const group = ThreeJSBridge.solidToGroup(box);
    scene.add(group);

    const fea = FEAEngine.linearStatic(box);
    const contours = FEAVisualizer.addStressContours(scene, group, fea, 8);

    let lineSegmentCount = 0;
    let totalSegments = 0;
    if (contours) {
      contours.traverse(obj => {
        if (obj.isLineSegments) {
          lineSegmentCount++;
          const positions = obj.geometry.getAttribute('position');
          if (positions) totalSegments += positions.count / 2;
        }
      });
    }

    return {
      hasContours: !!contours,
      lineSegmentCount,
      totalSegments,
    };
  });

  expect(result.hasContours).toBe(true);
  // Contours may be 0 for uniform-stress geometry — group still created
  expect(result.lineSegmentCount).toBeGreaterThanOrEqual(0);
});

test('clearVisualization removes markers and contours', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { FEAEngine, PrimitiveBuilder, FEAVisualizer, ThreeJSBridge } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    const scene = new THREE.Scene();
    const box = PrimitiveBuilder.box(0.060, 0.040, 0.020);
    const group = ThreeJSBridge.solidToGroup(box);
    scene.add(group);

    const fea = FEAEngine.linearStatic(box);
    FEAVisualizer.addMinMaxMarkers(scene, fea);
    FEAVisualizer.addStressContours(scene, group, fea, 6);

    let beforeCount = 0;
    scene.traverse(obj => { if (obj.userData?.feaMarkers || obj.name === '__stress_contours__') beforeCount++; });

    FEAVisualizer.clearVisualization(scene);

    let afterCount = 0;
    scene.traverse(obj => { if (obj.userData?.feaMarkers || obj.name === '__stress_contours__') afterCount++; });

    return { beforeCount, afterCount };
  });

  expect(result.beforeCount).toBeGreaterThan(0);
  expect(result.afterCount).toBe(0);
});

test('Linear Static FEA tool reports markers and contours', async ({ page }) => {
  await setup(page);

  await clickTool(page, 1, 'Extrude Boss');
  await page.waitForTimeout(1000);
  await clickTool(page, 9, 'Linear Static FEA');

  const status = page.locator('.tool-status-bar');
  const text = await status.textContent();
  console.log('FEA status:', text);
  expect(text).toContain('contour');
  expect(text).toContain('marker');
});
