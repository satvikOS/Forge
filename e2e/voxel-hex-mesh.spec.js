import { test, expect } from '@playwright/test';
import { voxelHexMesh, pointInMesh } from '../frontend/src/foundation/VoxelHexMesh.js';

// A closed unit cube [0,10]³ as a triangle mesh (12 tris).
function cubeMesh(a = 10) {
  return {
    vertices: [
      [0, 0, 0], [a, 0, 0], [a, a, 0], [0, a, 0],
      [0, 0, a], [a, 0, a], [a, a, a], [0, a, a],
    ],
    triangles: [
      [0, 2, 1], [0, 3, 2],   // bottom
      [4, 5, 6], [4, 6, 7],   // top
      [0, 1, 5], [0, 5, 4],   // front
      [2, 3, 7], [2, 7, 6],   // back
      [1, 2, 6], [1, 6, 5],   // right
      [0, 4, 7], [0, 7, 3],   // left
    ],
  };
}

test.describe('Voxel hex meshing of arbitrary geometry', () => {
  test.describe.configure({ timeout: 120000 });

  test('pointInMesh: ray-crossing classifies inside vs outside', () => {
    const cube = cubeMesh(10);
    expect(pointInMesh([5, 5, 5], cube.vertices, cube.triangles)).toBe(true);   // centre
    expect(pointInMesh([1, 1, 1], cube.vertices, cube.triangles)).toBe(true);   // near corner, inside
    expect(pointInMesh([-1, 5, 5], cube.vertices, cube.triangles)).toBe(false); // left of body
    expect(pointInMesh([15, 5, 5], cube.vertices, cube.triangles)).toBe(false); // right of body
    expect(pointInMesh([5, 5, 20], cube.vertices, cube.triangles)).toBe(false); // above
  });

  test('A cube voxel-meshes to a full grid, hex volume converges to true', () => {
    const cube = cubeMesh(10);
    // resolution 10 → exact 10×10×10 grid, every cell inside.
    const r = voxelHexMesh(cube, { resolution: 10 });
    console.log(`\nCube res 10: ${r.cellCount} cells, fill ${(r.fillFraction * 100).toFixed(0)}%`);
    expect(r.cellCount).toBe(1000);              // 10³ — all inside
    expect(r.fillFraction).toBeCloseTo(1, 5);    // a box fills its bbox exactly
    const hexVol = r.hexMesh.totalVolume();
    console.log(`Hex volume ${hexVol.toFixed(1)} (true 1000)`);
    expect(hexVol).toBeCloseTo(1000, 3);         // 10³ mm³ exact for an axis-aligned box
  });

  test('Voxel mesh converges: finer resolution → volume error shrinks', () => {
    // An L-shaped prism — non-convex — voxel-meshed at two resolutions.
    // The coarse mesh has more staircase error than the fine one.
    const L = lPrism();
    const coarse = voxelHexMesh(L, { resolution: 8 });
    const fine   = voxelHexMesh(L, { resolution: 24 });
    const trueVol = 1950 * 20;   // L-profile area 1950 mm² × 20 mm
    const errC = Math.abs(coarse.hexMesh.totalVolume() - trueVol) / trueVol;
    const errF = Math.abs(fine.hexMesh.totalVolume()   - trueVol) / trueVol;
    console.log(`\nL-prism voxel error: coarse ${(errC * 100).toFixed(1)}%, fine ${(errF * 100).toFixed(1)}%`);
    expect(fine.cellCount).toBeGreaterThan(coarse.cellCount);
    expect(errF).toBeLessThanOrEqual(errC + 1e-9);   // refinement never worsens
    expect(errF).toBeLessThan(0.10);                 // fine within 10%
  });

  test('Voxel Hex Mesh ribbon → real hex mesh of a foundation body', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    await page.locator('.ribbon-tab', { hasText: 'Simulate' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Voxel Hex Mesh$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastVoxelHexMesh, null, { timeout: 15000 });

    const r = await page.evaluate(() => window.__lastVoxelHexMesh);
    console.log(`\nVoxel mesh: ${r.cellCount} cells, ${r.grid.join('×')} grid, hex vol ${r.hexVolume.toFixed(0)} vs true ${r.trueVolume.toFixed(0)}`);
    // A box occupies most of its bounding box — fill is high but not
    // exactly 1: the grid resolution does not divide 25 mm evenly, so
    // the outer cell layer's centre falls outside the body and is
    // dropped. That partial boundary layer is the honest staircase.
    expect(r.cellCount).toBeGreaterThan(100);
    expect(r.fillFraction).toBeGreaterThan(0.8);
    // Hex volume tracks the manifold volume to within that staircase
    // error. Honest bound: < 10%.
    expect(Math.abs(r.hexVolume - r.trueVolume) / r.trueVolume).toBeLessThan(0.10);
  });
});

// L-shaped prism: profile area 1950 mm², 20 mm deep.
function lPrism() {
  // L profile: 60×20 base + 25×30 upright = 1200 + 750 = 1950 mm².
  const p = [[0, 0], [60, 0], [60, 20], [25, 20], [25, 50], [0, 50]];
  const H = 20;
  const verts = [];
  for (const [x, y] of p) verts.push([x, y, 0]);
  for (const [x, y] of p) verts.push([x, y, H]);
  const n = p.length;
  const tris = [];
  // side walls
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n, c = b + n, d = a + n;
    tris.push([a, b, c], [a, c, d]);
  }
  // caps — fan triangulation (the L is simple enough for a fan from vertex 0)
  for (let i = 1; i < n - 1; i++) {
    tris.push([0, i + 1, i]);             // bottom (z=0), inward normal
    tris.push([n, n + i, n + i + 1]);     // top (z=H)
  }
  return { vertices: verts, triangles: tris };
}
