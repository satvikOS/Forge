import { test, expect } from '@playwright/test';
import {
  sdSphere, sdBox, sdCappedCylinderZ,
  opUnion, opIntersect, opSubtract, smin, smax,
  bossOnBaseField,
} from '../frontend/src/foundation/SmoothImplicit.js';

test.describe('Smooth implicit (SDF) filleting', () => {
  test.describe.configure({ timeout: 120000 });

  test('SDF primitives: negative inside, ~0 on the surface, positive outside', () => {
    // Sphere r=10 at origin.
    expect(sdSphere([0, 0, 0], [0, 0, 0], 10)).toBeCloseTo(-10, 6);
    expect(sdSphere([10, 0, 0], [0, 0, 0], 10)).toBeCloseTo(0, 6);
    expect(sdSphere([20, 0, 0], [0, 0, 0], 10)).toBeCloseTo(10, 6);
    // Box he=[10,10,10] at origin.
    expect(sdBox([0, 0, 0], [0, 0, 0], [10, 10, 10])).toBeCloseTo(-10, 6);
    expect(sdBox([10, 0, 0], [0, 0, 0], [10, 10, 10])).toBeCloseTo(0, 6);
    expect(sdBox([13, 0, 0], [0, 0, 0], [10, 10, 10])).toBeCloseTo(3, 6);
    // Diagonal exterior point — exact Euclidean distance to the corner.
    expect(sdBox([13, 14, 10], [0, 0, 0], [10, 10, 10])).toBeCloseTo(5, 6);
    // Z-capped cylinder R=10, hz=15.
    expect(sdCappedCylinderZ([0, 0, 0], [0, 0, 0], 10, 15)).toBeCloseTo(-10, 6);
    expect(sdCappedCylinderZ([10, 0, 0], [0, 0, 0], 10, 15)).toBeCloseTo(0, 6);
    expect(sdCappedCylinderZ([0, 0, 18], [0, 0, 0], 10, 15)).toBeCloseTo(3, 6);
  });

  test('smin is an EXACT circular fillet — radius parameter is the geometric radius', () => {
    // Two perpendicular planar faces: solid {x≤0} ∪ {y≤0}, SDFs x and y.
    // The smooth union rounds the reentrant corner. By construction the
    // zero-isocontour is a circular arc of radius r centred at (r,r),
    // tangent to both faces. Sample that arc — smin must read ~0 on it.
    const r = 6;
    let maxErr = 0;
    for (let deg = 180; deg <= 270; deg += 5) {
      const t = deg * Math.PI / 180;
      const x = r + r * Math.cos(t);
      const y = r + r * Math.sin(t);
      maxErr = Math.max(maxErr, Math.abs(smin(x, y, r)));
    }
    console.log(`\nCircular fillet: max |smin| on the radius-${r} arc = ${maxErr.toExponential(2)}`);
    expect(maxErr).toBeLessThan(1e-6);

    // A point off the arc but inside the rounded corner reads negative
    // (material added by the fillet); outside reads positive.
    expect(smin(r * 0.2, r * 0.2, r)).toBeLessThan(0);   // deep in the fillet
    expect(smin(r * 1.6, r * 1.6, r)).toBeGreaterThan(0); // beyond the fillet
  });

  test('smin/smax bound min/max and collapse to them as r→0', () => {
    for (const [a, b] of [[3, 5], [-2, 7], [4, 4], [-9, -1]]) {
      // Smooth union extends the solid: smin ≤ min. Smooth max: smax ≥ max.
      expect(smin(a, b, 4)).toBeLessThanOrEqual(Math.min(a, b) + 1e-9);
      expect(smax(a, b, 4)).toBeGreaterThanOrEqual(Math.max(a, b) - 1e-9);
      // Tiny radius → sharp boolean.
      expect(smin(a, b, 1e-9)).toBeCloseTo(Math.min(a, b), 6);
      expect(smax(a, b, 1e-9)).toBeCloseTo(Math.max(a, b), 6);
    }
    // Sharp operators behave.
    expect(opUnion(3, 5)).toBe(3);
    expect(opIntersect(3, 5)).toBe(5);
    expect(opSubtract(-4, -2)).toBe(2);   // max(-4, 2)
  });

  test('bossOnBaseField: fillet adds material at the seam, unchanged far away', () => {
    const sharp = bossOnBaseField({ sharp: true });
    const smooth = bossOnBaseField({ sharp: false, filletRadius: 8 });

    // A point in the reentrant corner of the boss/base seam: outside
    // both solids (sharp field > 0) but filled in by the fillet.
    const seamPt = [22, 0, 22];
    expect(sharp(seamPt)).toBeGreaterThan(0);          // sharp: empty
    expect(smooth(seamPt)).toBeLessThan(sharp(seamPt)); // fillet pulls surface out
    expect(smooth(seamPt)).toBeLessThan(0);            // now inside the body

    // Far from the seam the smooth union is identical to the sharp one.
    for (const p of [[0, 0, -30], [0, 0, 5], [0, 0, 55]]) {
      expect(smooth(p)).toBeCloseTo(sharp(p), 6);
    }
  });

  test('Smooth Fillet ribbon → marching-tet smooth fillet of a boss/base seam', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Smooth Fillet$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastSmoothFillet, null, { timeout: 60000 });

    const r = await page.evaluate(() => window.__lastSmoothFillet);
    console.log(`\nSmooth Fillet: r=${r.radius}mm, ${r.triangleCount} tris, genus ${r.genus}, ` +
      `V smooth ${r.volumeSmooth.toFixed(0)} vs sharp ${r.volumeSharp.toFixed(0)} (+${r.addedByFillet.toFixed(0)})`);
    // levelSet produces a watertight, genus-0 solid.
    expect(r.genus).toBe(0);
    expect(r.triangleCount).toBeGreaterThan(2000);
    expect(r.volumeSmooth).toBeGreaterThan(0);
    // The concave seam fillet adds material vs the sharp union.
    expect(r.addedByFillet).toBeGreaterThan(0);
    expect(r.volumeSmooth).toBeGreaterThan(r.volumeSharp);
  });
});
