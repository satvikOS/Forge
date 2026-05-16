import { test, expect } from '@playwright/test';
import {
  observedOrder, convergenceStudy, richardsonExtrapolate,
  trapezoidIntegral, simpsonIntegral, gaussIntegral,
  poisson1DLinearFE, polygonArea, rigidTransform,
} from '../frontend/src/foundation/ValidationSuite.js';

test.describe('Numerical validation suite', () => {
  test.describe.configure({ timeout: 120000 });

  test('Quadrature converges at its theoretical order (trapezoid 2, Simpson 4)', () => {
    // ∫₀¹ eˣ dx = e − 1.
    const exact = Math.E - 1;
    const trap = convergenceStudy(
      (n) => Math.abs(trapezoidIntegral(Math.exp, 0, 1, n) - exact),
      [10, 20, 40, 80]);
    const simp = convergenceStudy(
      (n) => Math.abs(simpsonIntegral(Math.exp, 0, 1, n) - exact),
      [10, 20, 40, 80]);
    console.log(`\nTrapezoid observed order: ${trap.meanOrder.toFixed(2)} (theory 2)`);
    console.log(`Simpson observed order:   ${simp.meanOrder.toFixed(2)} (theory 4)`);
    expect(trap.monotone).toBe(true);
    expect(simp.monotone).toBe(true);
    expect(trap.meanOrder).toBeGreaterThan(1.9);
    expect(trap.meanOrder).toBeLessThan(2.1);
    expect(simp.meanOrder).toBeGreaterThan(3.9);
    expect(simp.meanOrder).toBeLessThan(4.1);
  });

  test('Cross-method: trapezoid, Simpson and Gauss agree on the same integral', () => {
    const exact = Math.E - 1;
    const a = trapezoidIntegral(Math.exp, 0, 1, 4000);
    const b = simpsonIntegral(Math.exp, 0, 1, 40);
    const c = gaussIntegral(Math.exp, 0, 1);
    expect(Math.abs(a - exact)).toBeLessThan(1e-6);
    expect(Math.abs(b - exact)).toBeLessThan(1e-6);
    expect(Math.abs(c - exact)).toBeLessThan(1e-4);   // single 5-pt panel
    // Independent methods agree with each other.
    expect(Math.abs(a - b)).toBeLessThan(1e-5);
  });

  test('Linear finite elements: L2 error converges at order 2, nodes are exact', () => {
    // −u'' = π²·sin(πx),  u(0)=u(1)=0  →  exact u = sin(πx).
    const f = (x) => Math.PI * Math.PI * Math.sin(Math.PI * x);
    const exactU = (x) => Math.sin(Math.PI * x);
    const study = convergenceStudy(
      (n) => poisson1DLinearFE(n, f, exactU).l2Error,
      [8, 16, 32, 64]);
    console.log(`\nLinear-FE L2 errors: ${study.errors.map((e) => e.toExponential(2)).join(', ')}`);
    console.log(`Linear-FE observed L2 order: ${study.meanOrder.toFixed(2)} (theory 2)`);
    expect(study.monotone).toBe(true);
    expect(study.meanOrder).toBeGreaterThan(1.9);
    expect(study.meanOrder).toBeLessThan(2.15);
    // 1-D linear FE is nodally exact — every nodal value matches the
    // analytic solution to machine precision.
    const fine = poisson1DLinearFE(32, f, exactU);
    console.log(`Linear-FE max nodal error: ${fine.maxNodalError.toExponential(2)}`);
    expect(fine.maxNodalError).toBeLessThan(1e-12);
  });

  test('Richardson extrapolation lifts accuracy beyond either input', () => {
    const exact = Math.E - 1;
    const coarse = trapezoidIntegral(Math.exp, 0, 1, 20);
    const fine = trapezoidIntegral(Math.exp, 0, 1, 40);
    const extrap = richardsonExtrapolate(coarse, fine, 2);
    // The extrapolated value is far more accurate than the fine input.
    expect(Math.abs(extrap - exact)).toBeLessThan(Math.abs(fine - exact) / 50);
  });

  test('Conservation: polygon area is invariant under rigid transforms', () => {
    const poly = [[0, 0], [40, 0], [40, 25], [15, 25], [15, 40], [0, 40]];
    const a0 = polygonArea(poly);
    let maxDrift = 0;
    for (let k = 0; k < 12; k++) {
      const moved = rigidTransform(poly, k * 0.5, k * 7 - 20, 13 - k * 3);
      maxDrift = Math.max(maxDrift, Math.abs(polygonArea(moved) - a0));
    }
    console.log(`\nPolygon area ${a0} mm² — max drift under rigid transforms: ${maxDrift.toExponential(2)}`);
    expect(maxDrift).toBeLessThan(1e-9);
  });

  test('observedOrder recovers a known rate', () => {
    // Errors halving as h² → ratio 4 per step → order 2.
    expect(observedOrder(1.0, 0.25)).toBeCloseTo(2, 9);
    // Errors dropping ×16 → order 4.
    expect(observedOrder(1.0, 1 / 16)).toBeCloseTo(4, 9);
  });
});
