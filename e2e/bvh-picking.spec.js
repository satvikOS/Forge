import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
}

test('BVH builds tree from objects', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const { BVH } = await import('/src/kernel/index.js');
    const THREE = await import('/node_modules/.vite/deps/three.js');

    // Create 100 random meshes
    const objs = [];
    for (let i = 0; i < 100; i++) {
      const geo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
      const mat = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5
      );
      mesh.updateMatrixWorld();
      objs.push(mesh);
    }

    const t0 = performance.now();
    const bvh = BVH.build(objs);
    const t1 = performance.now();

    const stats = bvh.stats();

    // Test raycast
    const ray = new THREE.Ray(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
    const t2 = performance.now();
    const candidates = bvh.raycast(ray);
    const t3 = performance.now();

    return {
      ok: true,
      buildMs: (t1 - t0).toFixed(3),
      stats,
      raycastMs: (t3 - t2).toFixed(3),
      candidates: candidates.length,
      total: objs.length,
    };
  });

  console.log('BVH stats:', JSON.stringify(result, null, 2));

  expect(result.ok).toBe(true);
  expect(result.stats.items).toBe(100);
  expect(result.stats.depth).toBeGreaterThan(2);
  expect(result.stats.depth).toBeLessThan(20);
  expect(parseFloat(result.buildMs)).toBeLessThan(50);
  expect(parseFloat(result.raycastMs)).toBeLessThan(5);
});

test('BVH raycast filters non-intersecting objects', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const { BVH } = await import('/src/kernel/index.js');
    const THREE = await import('/node_modules/.vite/deps/three.js');

    // 50 objects far away on +X, 50 close to origin
    const objs = [];
    for (let i = 0; i < 50; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.005));
      m.position.set(10 + i * 0.01, 0, 0);
      m.updateMatrixWorld();
      objs.push(m);
    }
    for (let i = 0; i < 50; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 0.005));
      m.position.set(0, 0, i * 0.01);
      m.updateMatrixWorld();
      objs.push(m);
    }

    const bvh = BVH.build(objs);

    // Ray straight up from origin (only hits Z-axis objects)
    const ray = new THREE.Ray(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, 1)
    );
    const candidates = bvh.raycast(ray);

    return { total: objs.length, candidates: candidates.length };
  });

  console.log('BVH filter result:', result);
  expect(result.candidates).toBeLessThan(result.total); // BVH filters out far objects
});
