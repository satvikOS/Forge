import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'nurbs');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('NURBS STEP export — Phase 4 of Parasolid parity', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Quarter-circle NURBS → AP203 with B_SPLINE_CURVE_WITH_KNOTS + RATIONAL', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSCurve } = await import('/src/foundation/NURBSCurve.js');
      const { exportNURBSCurve, _internals } = await import('/src/foundation/NURBSStepExport.js');
      const c = NURBSCurve.quarterCircle(10);
      const collapsed = _internals.collapseKnots(c.knots);
      const step = exportNURBSCurve(c, { name: 'QuarterCircle_R10' });
      return {
        step,
        bytes: step.length,
        collapsedUnique: collapsed.uniqueKnots,
        collapsedMult: collapsed.multiplicities,
      };
    });

    console.log(`\n=== NURBS QUARTER-CIRCLE → STEP ===`);
    console.log(`File size: ${result.bytes} bytes`);
    console.log(`Knots collapsed: unique = [${result.collapsedUnique.join(', ')}], multiplicities = [${result.collapsedMult.join(', ')}]`);

    fs.writeFileSync(path.join(ROOT, 'quarter-circle.step'), result.step);

    // Validate STEP file structure
    expect(result.step).toContain('ISO-10303-21;');
    expect(result.step).toContain('B_SPLINE_CURVE_WITH_KNOTS');
    expect(result.step).toContain('RATIONAL_B_SPLINE_CURVE');
    expect(result.step).toContain('CARTESIAN_POINT');
    expect(result.step).toContain('END-ISO-10303-21;');
    // Knot multiplicities for clamped quadratic = (3, 3)
    expect(result.collapsedUnique).toEqual([0, 1]);
    expect(result.collapsedMult).toEqual([3, 3]);
  });

  test('Unit circle (9 CPs) → AP203 with weights ≠ 1', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSCurve } = await import('/src/foundation/NURBSCurve.js');
      const { exportNURBSCurve } = await import('/src/foundation/NURBSStepExport.js');
      const c = NURBSCurve.unitCircle();
      const step = exportNURBSCurve(c, { name: 'UnitCircle_9CP' });
      return { step };
    });

    fs.writeFileSync(path.join(ROOT, 'unit-circle.step'), result.step);

    console.log(`Unit circle STEP saved.`);
    // Verify rational weights present (should include 0.7071...)
    expect(result.step).toMatch(/RATIONAL_B_SPLINE_CURVE\(\([\d.,\s]*0\.7071[\d]*[\d.,\s]*\)\)/);
  });

  test('NURBS sphere → AP203 with B_SPLINE_SURFACE_WITH_KNOTS + RATIONAL', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSSurface } = await import('/src/foundation/NURBSSurface.js');
      const { exportNURBSSurface } = await import('/src/foundation/NURBSStepExport.js');
      const s = NURBSSurface.sphere(10);
      const step = exportNURBSSurface(s, { name: 'Sphere_R10_NURBS' });
      return {
        step,
        bytes: step.length,
        controlNetSize: { rows: s.controlNet.length, cols: s.controlNet[0].length },
      };
    });

    console.log(`\n=== NURBS SPHERE R=10 → STEP ===`);
    console.log(`File size: ${(result.bytes / 1024).toFixed(1)} KB`);
    console.log(`Control net: ${result.controlNetSize.rows} × ${result.controlNetSize.cols}`);

    fs.writeFileSync(path.join(ROOT, 'sphere.step'), result.step);

    expect(result.step).toContain('B_SPLINE_SURFACE_WITH_KNOTS');
    expect(result.step).toContain('RATIONAL_B_SPLINE_SURFACE');
    expect(result.step).toContain('END-ISO-10303-21;');
    expect(result.controlNetSize.rows).toBe(9);
    expect(result.controlNetSize.cols).toBe(5);
  });

  test('NURBS cylinder → AP203 surface', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSSurface } = await import('/src/foundation/NURBSSurface.js');
      const { exportNURBSSurface } = await import('/src/foundation/NURBSStepExport.js');
      const c = NURBSSurface.cylinder(5, 10);
      const step = exportNURBSSurface(c, { name: 'Cylinder_R5_H10' });
      return { step, bytes: step.length };
    });

    fs.writeFileSync(path.join(ROOT, 'cylinder.step'), result.step);
    console.log(`Cylinder STEP: ${(result.bytes / 1024).toFixed(1)} KB`);
    expect(result.step).toContain('B_SPLINE_SURFACE_WITH_KNOTS');
  });

  test('Collection: helix curve + sphere surface in one STEP file', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSCurve } = await import('/src/foundation/NURBSCurve.js');
      const { NURBSSurface } = await import('/src/foundation/NURBSSurface.js');
      const { exportNURBSCollection } = await import('/src/foundation/NURBSStepExport.js');
      const helix = NURBSCurve.helix(20, 10, 3);
      const sphere = NURBSSurface.sphere(15);
      const cyl = NURBSSurface.cylinder(8, 25);
      const step = exportNURBSCollection({
        curves: [helix],
        surfaces: [sphere, cyl],
        options: { name: 'NURBS_Test_Collection' },
      });
      return { step, bytes: step.length };
    });

    fs.writeFileSync(path.join(ROOT, 'collection.step'), result.step);
    console.log(`Collection STEP: ${(result.bytes / 1024).toFixed(1)} KB`);

    expect(result.step).toContain('B_SPLINE_CURVE_WITH_KNOTS');
    expect(result.step).toContain('B_SPLINE_SURFACE_WITH_KNOTS');
    expect(result.step).toContain('END-ISO-10303-21;');
  });
});
