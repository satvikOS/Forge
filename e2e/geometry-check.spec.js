import { test, expect } from '@playwright/test';
import { inspectManifold } from '../frontend/src/foundation/GeometryCheck.js';

test.describe('Geometry diagnostics (real, not canned)', () => {
  test.describe.configure({ timeout: 120000 });

  test('inspectManifold flags a healthy body vs defects', () => {
    // Healthy closed cube: genus 0, V−F/2 = 2, positive volume.
    const cube = synth({
      volume: 8000, surfaceArea: 2400, genus: 0,
      // 8 verts, 12 tris, closed → Euler 8 − 6 = 2.
      verts: cubeVerts(20), tris: cubeTris(),
    });
    const ok = inspectManifold(cube);
    console.log(`\nHealthy cube: severity=${ok.severity}, ${JSON.stringify(ok.summary)}`);
    expect(ok.ok).toBe(true);
    expect(ok.severity).toBe('pass');
    expect(ok.metrics.eulerCharacteristic).toBe(2);
    expect(ok.metrics.degenerateTriangles).toBe(0);

    // Inverted body: negative volume → orientation error.
    const inverted = synth({ volume: -8000, surfaceArea: 2400, genus: 0,
      verts: cubeVerts(20), tris: cubeTris() });
    const bad = inspectManifold(inverted);
    console.log(`Inverted body: severity=${bad.severity}`);
    expect(bad.ok).toBe(false);
    expect(bad.severity).toBe('error');
    expect(bad.findings.some(f => f.code === 'GEOM-INVERTED')).toBe(true);

    // Empty body.
    const empty = synth({ volume: 0, surfaceArea: 0, genus: 0,
      verts: [], tris: [], isEmpty: true });
    const e = inspectManifold(empty);
    expect(e.ok).toBe(false);
    expect(e.findings.some(f => f.code === 'GEOM-EMPTY')).toBe(true);

    // Degenerate triangle: a collinear tri in an otherwise fine mesh.
    const degen = synth({
      volume: 8000, surfaceArea: 2400, genus: 0,
      verts: [...cubeVerts(20), 0, 0, 0, 1, 0, 0, 2, 0, 0],
      tris: [...cubeTris(), 8, 9, 10],   // collinear → zero area
    });
    const d = inspectManifold(degen);
    console.log(`Degenerate mesh: ${d.metrics.degenerateTriangles} zero-area tris`);
    expect(d.metrics.degenerateTriangles).toBe(1);
    expect(d.findings.some(f => f.code === 'GEOM-DEGEN')).toBe(true);
  });

  test('Check Geometry ribbon inspects a real foundation body', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    // Build a body.
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    // Manufacture tab → Check Geometry (it lives in the Inspect group).
    await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Check Geometry$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastGeometryCheck, null, { timeout: 15000 });

    const r = await page.evaluate(() => window.__lastGeometryCheck);
    console.log(`\nCheck Geometry: severity=${r.severity}, V=${r.metrics.volume_mm3.toFixed(0)} mm³, genus=${r.metrics.genus}, Euler=${r.metrics.eulerCharacteristic}, ${r.metrics.triangleCount} tris`);
    // An Extrude Boss is a clean closed box.
    expect(r.ok).toBe(true);
    expect(r.severity).toBe('pass');
    expect(r.metrics.volume_mm3).toBeGreaterThan(0);
    expect(r.metrics.genus).toBe(0);
    expect(r.metrics.degenerateTriangles).toBe(0);
    expect(r.metrics.eulerCharacteristic).toBe(2);
  });
});

function synth({ volume, surfaceArea, genus, verts, tris, isEmpty }) {
  return {
    volume: () => volume,
    surfaceArea: () => surfaceArea,
    genus: () => genus,
    isEmpty: () => !!isEmpty,
    boundingBox: () => ({ min: [0, 0, 0], max: [20, 20, 20] }),
    getMesh: () => ({
      numProp: 3,
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris),
    }),
  };
}

// 8 corners of a cube of side `a` centred at origin.
function cubeVerts(a) {
  const h = a / 2;
  return [
    -h, -h, -h,  h, -h, -h,  h, h, -h,  -h, h, -h,
    -h, -h,  h,  h, -h,  h,  h, h,  h,  -h, h,  h,
  ];
}
// 12 triangles (2 per face) — winding irrelevant for the area check.
function cubeTris() {
  return [
    0, 1, 2, 0, 2, 3,  4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,  2, 6, 7, 2, 7, 3,
    1, 5, 6, 1, 6, 2,  0, 3, 7, 0, 7, 4,
  ];
}
