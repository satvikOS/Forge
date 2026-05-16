import { test, expect } from '@playwright/test';
import { NURBSSurface } from '../frontend/src/foundation/NURBSSurface.js';
import {
  curvature, surfaceCurvature, continuityCheck, isophoteValue, fundamentalForms,
} from '../frontend/src/foundation/SurfaceCurvature.js';

test.describe('Surface curvature & continuity analysis', () => {
  test.describe.configure({ timeout: 120000 });

  test('Sphere: Gaussian curvature is 1/R² everywhere', () => {
    const R = 10;
    const sph = NURBSSurface.sphere(R);
    let maxK = 0, maxH = 0;
    for (let i = 1; i < 6; i++) {
      for (let j = 1; j < 6; j++) {
        const c = surfaceCurvature(sph, i / 6, j / 6);
        maxK = Math.max(maxK, Math.abs(c.gaussian - 1 / (R * R)));
        maxH = Math.max(maxH, Math.abs(Math.abs(c.mean) - 1 / R));
      }
    }
    console.log(`\nSphere R=${R}: max |K − 1/R²| = ${maxK.toExponential(2)}, |H| err = ${maxH.toExponential(2)}`);
    expect(maxK).toBeLessThan(1e-6);     // K = 1/100 exactly
    expect(maxH).toBeLessThan(1e-6);     // |H| = 1/10 exactly
  });

  test('Cylinder: Gaussian curvature 0, principal curvatures {0, 1/R}', () => {
    const R = 8;
    const cyl = NURBSSurface.cylinder(R, 30);
    for (const [u, v] of [[0.1, 0.5], [0.37, 0.2], [0.6, 0.8]]) {
      const c = surfaceCurvature(cyl, u, v);
      expect(Math.abs(c.gaussian)).toBeLessThan(1e-6);          // developable → K = 0
      const kmax = Math.max(Math.abs(c.k1), Math.abs(c.k2));
      const kmin = Math.min(Math.abs(c.k1), Math.abs(c.k2));
      expect(kmin).toBeLessThan(1e-6);                          // straight direction
      expect(kmax).toBeCloseTo(1 / R, 5);                       // circular direction
    }
  });

  test('Plane: all curvatures vanish', () => {
    const plane = NURBSSurface.plane([0, 0, 0], [1, 0, 0], [0, 1, 0], 20, 20);
    const c = surfaceCurvature(plane, 0.5, 0.5);
    expect(Math.abs(c.gaussian)).toBeLessThan(1e-9);
    expect(Math.abs(c.mean)).toBeLessThan(1e-9);
    const ff = fundamentalForms(plane.evalDerivatives2(0.5, 0.5));
    // Second fundamental form is identically zero for a plane.
    expect(Math.abs(ff.L) + Math.abs(ff.M) + Math.abs(ff.N)).toBeLessThan(1e-9);
  });

  test('G2 continuity: a cylinder split at an isoparm rejoins G0/G1/G2', () => {
    // The same cylinder evaluated as two halves shares its u=0.5 seam.
    const cyl = NURBSSurface.cylinder(12, 25);
    const cont = continuityCheck(
      cyl, (t) => [0.5, t],       // edge as seen from "patch A"
      cyl, (t) => [0.5, t],       // …and from "patch B" (same surface)
    );
    expect(cont.g0).toBe(true);
    expect(cont.g1).toBe(true);
    expect(cont.g2).toBe(true);   // identical surface → curvature matches
  });

  test('G1-but-not-G2: a plane tangent to a cylinder is detected', () => {
    // Cylinder radius R, axis +Z; its u=0 isoparm is the line x=R, y=0.
    const R = 15;
    const cyl = NURBSSurface.cylinder(R, 40);
    // A plane lying in x=R, tangent to the cylinder along that line.
    const plane = NURBSSurface.plane([R, 0, 0], [0, 1, 0], [0, 0, 1], 20, 40);
    const cont = continuityCheck(
      cyl, (t) => [0, t],          // cylinder edge: u=0 → (R,0,z)
      plane, (t) => [0, t],        // plane edge:    u=0 → (R,0,z)
    );
    console.log(`\nPlane↔cylinder: G0=${cont.g0} G1=${cont.g1} G2=${cont.g2}, ` +
      `meanGap=${cont.maxMeanGap.toExponential(2)}`);
    expect(cont.g0).toBe(true);    // positions coincide
    expect(cont.g1).toBe(true);    // tangent planes coincide
    expect(cont.g2).toBe(false);   // curvature jumps 0 → 1/R — not G2
    expect(cont.maxMeanGap).toBeGreaterThan(0.01);
  });

  test('Isophote value is continuous across a G1 join', () => {
    const R = 15;
    const cyl = NURBSSurface.cylinder(R, 40);
    const plane = NURBSSurface.plane([R, 0, 0], [0, 1, 0], [0, 0, 1], 20, 40);
    const light = [1, 0, 0];
    let maxGap = 0;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const iCyl = isophoteValue(cyl.evalDerivatives2(0, t).normal, light);
      const iPln = isophoteValue(plane.evalDerivatives2(0, t).normal, light);
      maxGap = Math.max(maxGap, Math.abs(iCyl - iPln));
    }
    console.log(`\nIsophote continuity across the G1 join: max gap = ${maxGap.toExponential(2)}`);
    expect(maxGap).toBeLessThan(1e-6);   // continuous → zebra stripes line up
  });
});
