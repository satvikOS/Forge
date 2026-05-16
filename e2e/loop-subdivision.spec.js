import { test, expect } from '@playwright/test';
import { loopSubdivide, loopStep, manifoldMeshToArrays } from '../frontend/src/foundation/LoopSubdivision.js';

test.describe('Loop subdivision (correct triangle-mesh scheme)', () => {
  test.describe.configure({ timeout: 120000 });

  test('One Loop step takes T triangles → 4T', () => {
    // A tetrahedron: 4 vertices, 4 triangles.
    const tet = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
      triangles: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
    };
    const s1 = loopStep(tet);
    console.log(`\nTet step 1: ${tet.triangles.length} → ${s1.triangles.length} tris, ${s1.vertices.length} verts`);
    expect(s1.triangles.length).toBe(4 * tet.triangles.length);   // 16
    // New verts = original 4 + one per edge. A closed tet has 6 edges.
    expect(s1.vertices.length).toBe(4 + 6);                        // 10

    const s2 = loopStep(s1);
    expect(s2.triangles.length).toBe(4 * s1.triangles.length);     // 64
  });

  test('loopSubdivide(levels) compounds: 4^levels triangles', () => {
    const tet = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
      triangles: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
    };
    const out = loopSubdivide(tet, 3);
    console.log(`Tet ×3: ${out.triangles.length} triangles`);
    expect(out.triangles.length).toBe(4 * 4 ** 3);                 // 4·64 = 256
  });

  test('Subdivision shrinks a faceted cube toward its inscribed limit surface', () => {
    // A cube subdivided with Loop smooths toward a rounded body —
    // the limit surface is strictly inside the original, so the
    // mesh "shrinks". Every vertex stays finite + the topology
    // (V − F/2 = 2 for a closed genus-0 body) is preserved.
    const cube = {
      vertices: [
        [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
      ],
      triangles: [
        [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
        [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3],
      ],
    };
    const sub = loopSubdivide(cube, 2);
    // Every coordinate finite.
    for (const v of sub.vertices) {
      for (const c of v) expect(Number.isFinite(c)).toBe(true);
    }
    // Closed-mesh Euler: V − F/2 must stay 2.
    const euler = sub.vertices.length - sub.triangles.length / 2;
    console.log(`\nCube ×2: ${sub.vertices.length} verts, ${sub.triangles.length} tris, Euler ${euler}`);
    expect(euler).toBe(2);
    // Subdivided body sits inside the original ±1 cube.
    let maxAbs = 0;
    for (const v of sub.vertices) for (const c of v) maxAbs = Math.max(maxAbs, Math.abs(c));
    expect(maxAbs).toBeLessThan(1.0);     // strictly inside
    expect(maxAbs).toBeGreaterThan(0.5);  // but not collapsed
  });

  test('Subdivide ribbon: a foundation body refines 4× per level', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    const beforeTris = await page.evaluate(() =>
      window.__lastFoundationManifold.getMesh().triVerts.length / 3);

    await page.locator('.ribbon-tool-label', { hasText: /^Subdivide$/ }).first().click();
    await page.waitForTimeout(3000);

    const afterTris = await page.evaluate(() =>
      window.__lastFoundationManifold.getMesh().triVerts.length / 3);
    console.log(`\nSubdivide ×2: ${beforeTris} → ${afterTris} triangles`);
    // 2 levels → ×16. (manifold-3d may merge coplanar tris, so allow ≥ ×8.)
    expect(afterTris).toBeGreaterThan(beforeTris * 8);
  });
});
