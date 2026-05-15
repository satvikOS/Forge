import { test, expect } from '@playwright/test';
import { filletPolygon2D, polygonArea } from '../frontend/src/foundation/Polygon2D.js';

test.describe('Real profile fillet (arc-tangent corners)', () => {
  test.describe.configure({ timeout: 120000 });

  test('Filleting a square removes exactly (4−π)r² of area', () => {
    // A 40×40 square, fillet r=5 on all 4 corners. Each 90° corner
    // loses (1 − π/4)r²; four corners → (4 − π)r².
    const sq = [[0, 0], [40, 0], [40, 40], [0, 40]];
    const r = 5;
    const sharpArea = Math.abs(polygonArea(sq));
    const { points, filletedCorners } = filletPolygon2D(sq, r, 64);
    const filletedArea = Math.abs(polygonArea(points));
    const expectedLoss = (4 - Math.PI) * r * r;
    const actualLoss = sharpArea - filletedArea;
    console.log(`\nSquare 40² area ${sharpArea}, filleted ${filletedArea.toFixed(3)}`);
    console.log(`Corner loss: actual ${actualLoss.toFixed(4)}, expected (4−π)r² = ${expectedLoss.toFixed(4)}`);
    expect(filletedCorners).toBe(4);
    // 64-seg arcs → area within 0.1 % of the analytical loss.
    expect(Math.abs(actualLoss - expectedLoss) / expectedLoss).toBeLessThan(0.001);
  });

  test('Concave corner: an L-bracket fillets all 6 corners', () => {
    // L-profile: 5 convex 90° + 1 concave 270° corner.
    const L = [[0, 0], [60, 0], [60, 20], [25, 20], [25, 50], [0, 50]];
    const { points, filletedCorners } = filletPolygon2D(L, 4, 8);
    console.log(`\nL-bracket: ${filletedCorners} corners filleted, ${points.length} output points`);
    expect(filletedCorners).toBe(6);          // every corner
    // Each fillet adds arcSegs+1 points, removes 1 → net growth.
    expect(points.length).toBeGreaterThan(L.length);
    // No output point coincides exactly with an original sharp vertex
    // (every corner was actually rounded).
    for (const v of L) {
      const hit = points.some(p => Math.hypot(p[0] - v[0], p[1] - v[1]) < 1e-6);
      expect(hit).toBe(false);
    }
  });

  test('Tiny edges: radius auto-clamps, never overruns', () => {
    // A thin 2 mm × 40 mm sliver — a 10 mm radius must clamp so the
    // fillet can't eat past the edge midpoint.
    const sliver = [[0, 0], [40, 0], [40, 2], [0, 2]];
    const { points } = filletPolygon2D(sliver, 10, 16);
    const a = Math.abs(polygonArea(points));
    console.log(`\nSliver filleted area: ${a.toFixed(2)} mm² (sharp 80)`);
    // Clamped fillet still yields a positive, sane area (not collapsed,
    // not larger than the original).
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(80);
  });

  test('Part Fillet ribbon → real L-bracket fillet manifold in scene', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Fillet$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    const vol = await page.evaluate(() => window.__lastFoundationManifold.volume());
    console.log(`\nFilleted L-bracket volume: ${vol.toFixed(0)} mm³`);
    // L-profile area (sharp) = 60·20 + 25·30 = 1200 + 750 = 1950 mm²;
    // filleting trims a little; × 20 mm height → just under 39000 mm³.
    expect(vol).toBeGreaterThan(36000);
    expect(vol).toBeLessThan(39000);
  });
});
