import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
}

test('NACA 4-digit airfoil generates valid coordinates', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { NACA } = m;
    const naca0012 = NACA.fourDigit('0012', 0.1, 60);
    const naca4412 = NACA.fourDigit('4412', 0.1, 60);
    return {
      n0012Count: naca0012.length,
      n4412Count: naca4412.length,
      n0012Symmetric: naca0012.every((p, i) => {
        const mirror = naca0012[naca0012.length - 1 - i];
        return Math.abs(p.x - mirror.x) < 1e-6;
      }),
      n4412NonSymmetric: !naca4412.every(p => p.y === 0),
      maxYn4412: Math.max(...naca4412.map(p => p.y)).toFixed(4),
    };
  });
  expect(result.n0012Count).toBeGreaterThan(50);
  expect(result.n0012Symmetric).toBe(true);  // symmetric airfoil
  expect(result.n4412NonSymmetric).toBe(true); // cambered airfoil
});

test('TurbomachineryBlade.fanBlade generates 9 stations', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { TurbomachineryBlade } = m;
    const fan = TurbomachineryBlade.fanBlade(0.4, 1.4, 0.18);
    const ipc = TurbomachineryBlade.compressorBlade(0.36, 0.42, 0.04, 1, 8);
    const hpt = TurbomachineryBlade.turbineBlade(0.42, 0.50, 0.045, 1, 1);
    return {
      fanStations: fan.profiles.length,
      fanType: fan.sectionType,
      fanRootChord: fan.spec.rootChord,
      fanTipChord: fan.spec.tipChord,
      fanRootStagger: fan.spec.rootStagger,
      ipcStations: ipc.profiles.length,
      hptStations: hpt.profiles.length,
      hptCamber: hpt.spec.rootCamberPct,
    };
  });
  expect(result.fanStations).toBe(9);
  expect(result.fanType).toBe('fan');
  expect(result.fanRootStagger).toBe(65);
  expect(result.fanTipChord).toBeGreaterThan(result.fanRootChord);
  expect(result.hptCamber).toBeGreaterThan(10);
});

test('Fir-tree root has 3 teeth', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { TurbomachineryBlade } = m;
    const root = TurbomachineryBlade.firTreeRoot(0.025, 0.030);
    return {
      pointCount: root.length,
      depth: Math.min(...root.map(p => p.y)),
    };
  });
  expect(result.pointCount).toBeGreaterThan(15); // 3 teeth × 4 points × 2 sides + extras
  expect(result.depth).toBeCloseTo(-0.030, 3);
});

test('LODManager initializes and updates', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { LODManager } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // Add 50 small spheres at various distances
    for (let i = 0; i < 50; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.01, 8, 6),
        new THREE.MeshBasicMaterial()
      );
      mesh.position.set((Math.random()-0.5)*4, (Math.random()-0.5)*4, -i * 0.5);
      mesh.updateMatrixWorld();
      scene.add(mesh);
    }

    const lod = new LODManager(scene, camera);
    const stats = lod.update();
    return stats;
  });
  expect(result).toBeDefined();
  expect(result.total).toBeGreaterThan(40);
});
