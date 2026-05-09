import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
}

test('MateSolver satisfies coincident mate', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { Assembly, PrimitiveBuilder, Vec3, MateSolver } = m;

    const assy = new Assembly('Coincident Test');

    // Two parts at different positions
    const partA = assy.addPart(PrimitiveBuilder.box(0.020, 0.020, 0.020), 'A', { position: new Vec3(0, 0, 0) });
    const partB = assy.addPart(PrimitiveBuilder.box(0.020, 0.020, 0.020), 'B', { position: new Vec3(0.080, 0.030, 0) });
    partA.fixed = true;

    // Add coincident mate (centers must coincide)
    assy.addMate('coincident', partA.id, partB.id);

    const before = { posB: { x: partB.position.x, y: partB.position.y, z: partB.position.z } };

    // Solve
    const result = MateSolver.solve(assy);

    const after = { posB: { x: partB.position.x, y: partB.position.y, z: partB.position.z } };

    return { result, before, after, dof: MateSolver.computeDOF(assy) };
  });

  console.log('Coincident result:', JSON.stringify(result, null, 2));

  expect(result.result.totalCount).toBe(1);
  expect(result.result.satisfiedCount).toBe(1);
  expect(result.result.converged).toBe(true);
  // Part B should have moved toward origin
  expect(Math.abs(result.after.posB.x)).toBeLessThan(Math.abs(result.before.posB.x));
});

test('MateSolver satisfies distance mate', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { Assembly, PrimitiveBuilder, Vec3, MateSolver } = m;

    const assy = new Assembly('Distance Test');
    const partA = assy.addPart(PrimitiveBuilder.box(0.010, 0.010, 0.010), 'A', { position: new Vec3(0, 0, 0) });
    const partB = assy.addPart(PrimitiveBuilder.box(0.010, 0.010, 0.010), 'B', { position: new Vec3(0.005, 0, 0) });
    partA.fixed = true;

    // Distance mate: 50mm apart
    assy.addMate('distance', partA.id, partB.id, { distance: 0.050 });

    const result = MateSolver.solve(assy);
    const finalDist = Math.sqrt(
      (partB.position.x - partA.position.x) ** 2 +
      (partB.position.y - partA.position.y) ** 2 +
      (partB.position.z - partA.position.z) ** 2
    );

    return { result, finalDistMm: (finalDist * 1000).toFixed(3), targetMm: 50 };
  });

  console.log('Distance result:', JSON.stringify(result, null, 2));

  expect(result.result.converged).toBe(true);
  expect(parseFloat(result.finalDistMm)).toBeCloseTo(50, 1);
});

test('MateSolver computes DOF correctly', async ({ page }) => {
  await setup(page);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { Assembly, PrimitiveBuilder, Vec3, MateSolver } = m;

    const assy = new Assembly('DOF Test');
    const a = assy.addPart(PrimitiveBuilder.box(0.01, 0.01, 0.01), 'A');
    const b = assy.addPart(PrimitiveBuilder.box(0.01, 0.01, 0.01), 'B');
    const c = assy.addPart(PrimitiveBuilder.box(0.01, 0.01, 0.01), 'C');
    a.fixed = true; // -6 DOF

    // 3 parts × 6 = 18 DOF
    // Fixed A: -6
    // Total: 12 DOF
    const initial = MateSolver.computeDOF(assy);

    // Add coincident: -3 DOF
    assy.addMate('coincident', a.id, b.id);
    const afterCoinc = MateSolver.computeDOF(assy);

    // Add lock: -6 DOF
    assy.addMate('lock', a.id, c.id);
    const afterLock = MateSolver.computeDOF(assy);

    return { initial, afterCoinc, afterLock };
  });

  console.log('DOF result:', JSON.stringify(result, null, 2));

  expect(result.initial).toBe(12);          // 18 - 6 (fixed)
  expect(result.afterCoinc).toBe(9);        // 12 - 3 (coincident)
  expect(result.afterLock).toBe(3);         // 9 - 6 (lock)
});
