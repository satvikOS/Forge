import { test, expect } from '@playwright/test';
import { morphologicalFillet, ballOffsets } from '../frontend/src/foundation/MorphologicalFillet.js';

// Closed axis-aligned box [0,a]×[0,b]×[0,c] as a triangle mesh.
function boxMesh(a, b, c) {
  const v = [
    [0, 0, 0], [a, 0, 0], [a, b, 0], [0, b, 0],
    [0, 0, c], [a, 0, c], [a, b, c], [0, b, c],
  ];
  const t = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
    [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3],
  ];
  return { vertices: v, triangles: t };
}

// Analytic volume of a rounded box (a×b×c, fillet r ≤ min/2).
function roundedBoxVolume(a, b, c, r) {
  const inner = (a - 2 * r) * (b - 2 * r) * (c - 2 * r);
  const slabs = 2 * (a - 2 * r) * (b - 2 * r) * r
              + 2 * (a - 2 * r) * (c - 2 * r) * r
              + 2 * (b - 2 * r) * (c - 2 * r) * r;
  const edges = (Math.PI * r * r / 4) * 4 * ((a - 2 * r) + (b - 2 * r) + (c - 2 * r));
  const corners = (4 / 3) * Math.PI * r * r * r;
  return inner + slabs + edges + corners;
}

// L-shaped prism: 60×20 base + 25×30 upright, 20 deep. One reentrant edge.
function lPrism() {
  const p = [[0, 0], [60, 0], [60, 20], [25, 20], [25, 50], [0, 50]];
  const H = 20;
  const verts = [];
  for (const [x, y] of p) verts.push([x, y, 0]);
  for (const [x, y] of p) verts.push([x, y, H]);
  const n = p.length;
  const tris = [];
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n, c = b + n, d = a + n;
    tris.push([a, b, c], [a, c, d]);
  }
  for (let i = 1; i < n - 1; i++) {
    tris.push([0, i + 1, i]);
    tris.push([n, n + i, n + i + 1]);
  }
  return { vertices: verts, triangles: tris };
}

// Count how many times each undirected edge appears in a triangle list.
function edgeParityOk(triangles) {
  const counts = new Map();
  for (const [a, b, c] of triangles) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const n of counts.values()) if (n % 2 !== 0) return false;
  return true;
}

test.describe('Volumetric rolling-ball fillet (mathematical morphology)', () => {
  test.describe.configure({ timeout: 120000 });

  test('ballOffsets builds a discrete ball structuring element', () => {
    const off = ballOffsets(4);
    // Every offset is within the radius; origin is included.
    expect(off.some(([i, j, k]) => i === 0 && j === 0 && k === 0)).toBe(true);
    for (const [i, j, k] of off) expect(i * i + j * j + k * k).toBeLessThanOrEqual(16);
    // Count is close to the ball volume (4/3)πr³.
    const vol = (4 / 3) * Math.PI * 64;
    console.log(`\nball(4): ${off.length} offsets (sphere volume ≈ ${vol.toFixed(0)})`);
    expect(off.length).toBeGreaterThan(vol * 0.7);
    expect(off.length).toBeLessThan(vol * 1.4);
  });

  test('Opening a cube rounds its convex edges — volume drops toward analytic', () => {
    const cube = boxMesh(10, 10, 10);
    const r = morphologicalFillet(cube, { radius: 2, resolution: 20, mode: 'convex' });
    const analytic = roundedBoxVolume(10, 10, 10, 2);
    console.log(`\nCube opening r=2: V ${r.volumeBefore.toFixed(0)} → ${r.volumeAfter.toFixed(0)} (analytic rounded ${analytic.toFixed(0)})`);
    // Opening is anti-extensive: it can only remove material.
    expect(r.volumeAfter).toBeLessThan(r.volumeBefore);
    // …and the rounded volume tracks the analytic rounded box.
    expect(Math.abs(r.volumeAfter - analytic) / analytic).toBeLessThan(0.15);
    expect(r.cellCount).toBeGreaterThan(0);
  });

  test('Closing a convex cube is (nearly) a no-op — no concave edges to round', () => {
    const cube = boxMesh(10, 10, 10);
    const r = morphologicalFillet(cube, { radius: 2, resolution: 20, mode: 'concave' });
    console.log(`\nCube closing r=2: V ${r.volumeBefore.toFixed(0)} → ${r.volumeAfter.toFixed(0)}`);
    // Closing is extensive: it can only add material, never remove.
    expect(r.volumeAfter).toBeGreaterThanOrEqual(r.volumeBefore);
    // A cube has no reentrant edges, so closing changes almost nothing.
    expect((r.volumeAfter - r.volumeBefore) / r.volumeBefore).toBeLessThan(0.03);
  });

  test('Closing an L-prism rounds its reentrant edge — volume rises', () => {
    const L = lPrism();
    const r = morphologicalFillet(L, { radius: 9, resolution: 20, mode: 'concave' });
    console.log(`\nL-prism closing: V ${r.volumeBefore.toFixed(0)} → ${r.volumeAfter.toFixed(0)} (+${((r.volumeAfter / r.volumeBefore - 1) * 100).toFixed(1)}%)`);
    // The concave corner gets filled by the rolling ball.
    expect(r.volumeAfter).toBeGreaterThan(r.volumeBefore);
  });

  test('The rounded body has a watertight boundary surface', () => {
    const cube = boxMesh(10, 10, 10);
    const r = morphologicalFillet(cube, { radius: 2, resolution: 16, mode: 'round' });
    console.log(`\nRounded surface: ${r.surfaceMesh.vertices.length} verts, ${r.surfaceMesh.triangles.length} tris`);
    expect(r.surfaceMesh.triangles.length).toBeGreaterThan(0);
    // Boundary of a voxel set is a closed surface: every edge even.
    expect(edgeParityOk(r.surfaceMesh.triangles)).toBe(true);
    expect(r.exposedFaces).toBe(r.surfaceMesh.triangles.length / 2);
  });

  test('Volumetric Fillet ribbon → real rolling-ball fillet of a foundation body', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    await page.locator('.ribbon-tool-label', { hasText: /^Volumetric Fillet$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastVolumetricFillet, null, { timeout: 30000 });

    const r = await page.evaluate(() => window.__lastVolumetricFillet);
    console.log(`\nVolumetric Fillet: r=${r.radius}mm, ${r.dims.join('×')} grid, V ${r.volumeBefore.toFixed(0)} → ${r.volumeAfter.toFixed(0)}, displayed=${r.displayed}`);
    // An Extrude Boss is a convex box → open+close rounds its convex
    // edges, removing a little material.
    expect(r.volumeAfter).toBeLessThan(r.volumeBefore);
    expect(r.volumeAfter).toBeGreaterThan(r.volumeBefore * 0.8);
    expect(r.cellCount).toBeGreaterThan(0);
    expect(typeof r.displayed).toBe('boolean');
  });
});
