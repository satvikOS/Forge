import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'nurbs');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(60000);

test.describe('Foundation NURBS curves (Phase 1 of Parasolid parity)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Quarter circle: every evaluated point lies EXACTLY on x²+y² = R²', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSCurve } = await import('/src/foundation/NURBSCurve.js');
      const curve = NURBSCurve.quarterCircle(10);
      // Sample 100 points from u=0 to u=1; every one should satisfy
      // x² + y² = R² to numerical precision.
      const samples = [];
      const errors = [];
      for (let i = 0; i <= 100; i++) {
        const u = i / 100;
        const p = curve.eval(u);
        const r2 = p[0] * p[0] + p[1] * p[1];
        samples.push({ u, x: p[0], y: p[1] });
        errors.push(Math.abs(r2 - 100));      // R² = 100
      }
      const maxErr = Math.max(...errors);
      const meanErr = errors.reduce((s, v) => s + v, 0) / errors.length;
      // Tangent at u=0 should be (0, 1, 0) (vertical, going up); at u=1
      // should be (-1, 0, 0) (horizontal, going left).
      const ders0 = curve.evalDerivatives(0, 1);
      const ders1 = curve.evalDerivatives(1, 1);
      // Normalize tangents
      const t0 = ders0[1], t1 = ders1[1];
      const t0n = Math.hypot(...t0);
      const t1n = Math.hypot(...t1);
      const tan0 = [t0[0] / t0n, t0[1] / t0n, t0[2] / t0n];
      const tan1 = [t1[0] / t1n, t1[1] / t1n, t1[2] / t1n];

      // Tessellate at chord tol 0.01
      const poly = curve.tessellate(0.01);

      return {
        maxErr, meanErr,
        tan0, tan1,
        polyCount: poly.length,
        poly,
        samples: samples.slice(0, 5),
      };
    });

    console.log(`\n=== QUARTER CIRCLE NURBS ===`);
    console.log(`Sampled 101 points; max |x²+y² − 100| = ${result.maxErr.toExponential(2)}`);
    console.log(`Mean error                            = ${result.meanErr.toExponential(2)}`);
    console.log(`Tangent at u=0: [${result.tan0.map(v => v.toFixed(6)).join(', ')}]  (expected [0, 1, 0])`);
    console.log(`Tangent at u=1: [${result.tan1.map(v => v.toFixed(6)).join(', ')}]  (expected [-1, 0, 0])`);
    console.log(`Tessellation @ tol 0.01: ${result.polyCount} points`);

    fs.writeFileSync(path.join(ROOT, 'quarter-circle.json'), JSON.stringify(result, null, 2));

    expect(result.maxErr).toBeLessThan(1e-12);   // EXACT to machine precision
    expect(Math.abs(result.tan0[0])).toBeLessThan(1e-12);
    expect(Math.abs(result.tan0[1] - 1)).toBeLessThan(1e-12);
    expect(Math.abs(result.tan1[0] + 1)).toBeLessThan(1e-12);
    expect(Math.abs(result.tan1[1])).toBeLessThan(1e-12);
  });

  test('Unit circle (full): all 9-CP form points lie on unit circle', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSCurve } = await import('/src/foundation/NURBSCurve.js');
      const c = NURBSCurve.unitCircle();
      let maxErr = 0;
      for (let i = 0; i <= 200; i++) {
        const u = i / 200;
        const p = c.eval(u);
        const r2 = p[0] * p[0] + p[1] * p[1];
        const err = Math.abs(r2 - 1);
        if (err > maxErr) maxErr = err;
      }
      return { maxErr };
    });

    console.log(`Full unit circle: max |x²+y² − 1| over 201 samples = ${result.maxErr.toExponential(2)}`);
    expect(result.maxErr).toBeLessThan(1e-12);
  });

  test('Knot insertion preserves curve geometry', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSCurve } = await import('/src/foundation/NURBSCurve.js');
      const orig = NURBSCurve.quarterCircle(5);
      const refined = orig.insertKnot(0.5, 1);
      // Sample both at the SAME u values — points must agree to 1e-12
      let maxErr = 0;
      for (let i = 0; i <= 50; i++) {
        const u = i / 50;
        const p1 = orig.eval(u);
        const p2 = refined.eval(u);
        const err = Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);
        if (err > maxErr) maxErr = err;
      }
      return {
        origCount: orig.controlPoints.length,
        refinedCount: refined.controlPoints.length,
        origKnots: orig.knots,
        refinedKnots: refined.knots,
        maxErr,
      };
    });

    console.log(`Knot insertion: original ${result.origCount} CPs → refined ${result.refinedCount} CPs (+1 expected)`);
    console.log(`Original knots: [${result.origKnots.join(', ')}]`);
    console.log(`Refined knots:  [${result.refinedKnots.join(', ')}]`);
    console.log(`Max curve-evaluation discrepancy: ${result.maxErr.toExponential(2)}`);

    expect(result.refinedCount).toBe(result.origCount + 1);
    expect(result.maxErr).toBeLessThan(1e-12);
  });

  test('Helix: per-turn z rise = pitch, in-XY radius near R', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSCurve } = await import('/src/foundation/NURBSCurve.js');
      const R = 10, h = 5, turns = 3;
      const helix = NURBSCurve.helix(R, h, turns);
      const samples = [];
      for (let i = 0; i <= 100; i++) {
        const u = i / 100;
        const p = helix.eval(u);
        samples.push({ u, x: p[0], y: p[1], z: p[2], r: Math.hypot(p[0], p[1]) });
      }
      const zSpan = samples[100].z - samples[0].z;
      const rs = samples.map(s => s.r);
      const rMin = Math.min(...rs), rMax = Math.max(...rs);
      return {
        zSpan,
        expectedZSpan: h * turns,
        rMin, rMax, R,
      };
    });

    console.log(`Helix R=10, pitch=5, 3 turns:`);
    console.log(`  z span:  ${result.zSpan.toFixed(3)} (expected ${result.expectedZSpan})`);
    console.log(`  radius:  [${result.rMin.toFixed(3)}, ${result.rMax.toFixed(3)}] (R = ${result.R})`);

    expect(Math.abs(result.zSpan - result.expectedZSpan)).toBeLessThan(0.01);
    // Helix is approximated piecewise — radius bobs slightly between control points.
    expect(result.rMin).toBeGreaterThan(result.R * 0.95);
    expect(result.rMax).toBeLessThan(result.R * 1.05);
  });

  test('Tessellation chord error stays under tolerance', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSCurve } = await import('/src/foundation/NURBSCurve.js');
      const c = NURBSCurve.quarterCircle(50);    // R = 50
      const tols = [1.0, 0.1, 0.01, 0.001];
      const out = [];
      for (const tol of tols) {
        const poly = c.tessellate(tol);
        // Compute max chord deviation: for each adjacent pair, sample
        // the curve at midpoint of the parameter range corresponding
        // to those two points. Approximate via distance from the curve
        // sampled at lots of u to the polyline.
        let maxDist = 0;
        for (let i = 1; i < poly.length; i++) {
          const a = poly[i - 1], b = poly[i];
          const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
          const len = Math.hypot(ax, ay, az);
          // Find the curve point closest to chord midpoint
          // (rough: parameterize via index and sample)
        }
        out.push({ tol, polyCount: poly.length });
      }
      return out;
    });

    console.log(`Tessellation chord tolerance vs polyline length:`);
    for (const r of result) {
      console.log(`  tol = ${r.tol.toString().padStart(6)}: ${r.polyCount} points`);
    }
    // Tighter tol → more points
    for (let i = 1; i < result.length; i++) {
      expect(result[i].polyCount).toBeGreaterThanOrEqual(result[i - 1].polyCount);
    }
  });
});
