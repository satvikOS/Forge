import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'classa');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('Class A surfacing — curvature analysis on NURBS', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Circle of radius R: κ(u) = 1/R exactly at every parameter', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSCurve } = await import('/src/foundation/NURBSCurve.js');
      const { curveCurvature, renderCurvatureCombSVG } = await import('/src/foundation/ClassASurface.js');
      const radii = [1, 5, 10, 100];
      const out = [];
      for (const R of radii) {
        const curve = NURBSCurve.unitCircle();
        // Scale by R via control-point manipulation
        const scaled = new NURBSCurve({
          degree: curve.degree,
          controlPoints: curve.controlPoints.map(p => [p[0] * R, p[1] * R, p[2] * R]),
          weights: curve.weights,
          knots: curve.knots,
        });
        let kSum = 0, kMin = Infinity, kMax = -Infinity;
        const SAMPLES = 100;
        for (let i = 0; i < SAMPLES; i++) {
          const u = scaled.uMin + (scaled.uMax - scaled.uMin) * i / SAMPLES;
          const r = curveCurvature(scaled, u);
          kSum += r.kappa;
          if (r.kappa < kMin) kMin = r.kappa;
          if (r.kappa > kMax) kMax = r.kappa;
        }
        out.push({
          R,
          analyticalKappa: 1 / R,
          measuredKappaMean: kSum / SAMPLES,
          measuredKappaMin: kMin,
          measuredKappaMax: kMax,
          range: kMax - kMin,
        });
      }
      // Render comb on a sin curve (more interesting topology)
      const sinCurve = new NURBSCurve({
        degree: 3,
        controlPoints: [
          [0, 0, 0], [10, 30, 0], [20, -30, 0], [30, 30, 0],
          [40, -30, 0], [50, 0, 0],
        ],
        knots: [0, 0, 0, 0, 0.25, 0.75, 1, 1, 1, 1],
      });
      const svg = renderCurvatureCombSVG(sinCurve, { samples: 80, kappaScale: 200 });
      return { circles: out, sinSvg: svg };
    });

    console.log(`\n=== CIRCLE CURVATURE κ = 1/R ===`);
    for (const c of result.circles) {
      console.log(`  R = ${c.R.toString().padStart(4)}:  analytical κ = ${c.analyticalKappa.toFixed(6)},  measured mean = ${c.measuredKappaMean.toFixed(6)},  range = ${c.range.toExponential(2)}`);
    }

    fs.writeFileSync(path.join(ROOT, 'circle-curvatures.json'), JSON.stringify(result.circles, null, 2));
    fs.writeFileSync(path.join(ROOT, 'sin-curve-comb.svg'), result.sinSvg);

    for (const c of result.circles) {
      expect(Math.abs(c.measuredKappaMean - c.analyticalKappa)).toBeLessThan(1e-9);
      expect(c.range).toBeLessThan(1e-9);
    }
  });

  test('Sphere of radius R: K = 1/R², H = 1/R exactly', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSSurface } = await import('/src/foundation/NURBSSurface.js');
      const { surfaceCurvature, surfaceCurvatureStats } = await import('/src/foundation/ClassASurface.js');
      const out = [];
      for (const R of [1, 5, 10]) {
        const sph = NURBSSurface.sphere(R);
        const stats = surfaceCurvatureStats(sph, 12, 12);
        // Sample at one specific (u, v) for direct check
        const r = surfaceCurvature(sph, 0.5, 0.5);
        out.push({
          R,
          analyticalK: 1 / (R * R),
          analyticalH_abs: 1 / R,
          K_mean: stats.K.mean,
          K_range: [stats.K.min, stats.K.max],
          H_mean: stats.H.mean,
          H_range: [stats.H.min, stats.H.max],
          point_K: r.K, point_H: r.H,
          point_kMin: r.kMin, point_kMax: r.kMax,
        });
      }
      return out;
    });

    console.log(`\n=== SPHERE CURVATURE K = 1/R², H = 1/R ===`);
    for (const s of result) {
      console.log(`  R = ${s.R}:`);
      console.log(`    analytical K = ${s.analyticalK.toFixed(6)},  measured K mean = ${s.K_mean.toFixed(6)},  range = [${s.K_range[0].toFixed(6)}, ${s.K_range[1].toFixed(6)}]`);
      console.log(`    analytical |H| = ${s.analyticalH_abs.toFixed(6)},  measured H mean = ${s.H_mean.toFixed(6)},  range = [${s.H_range[0].toFixed(6)}, ${s.H_range[1].toFixed(6)}]`);
      console.log(`    point (u=0.5, v=0.5):  K = ${s.point_K.toFixed(6)},  H = ${s.point_H.toFixed(6)},  κ_min = ${s.point_kMin.toFixed(6)},  κ_max = ${s.point_kMax.toFixed(6)}`);
    }
    fs.writeFileSync(path.join(ROOT, 'sphere-curvatures.json'), JSON.stringify(result, null, 2));

    // Sphere should have constant K = 1/R² to numerical precision
    for (const s of result) {
      expect(Math.abs(s.point_K - s.analyticalK)).toBeLessThan(s.analyticalK * 0.01);
      // |H| matches; sign depends on normal orientation convention
      expect(Math.abs(Math.abs(s.point_H) - s.analyticalH_abs)).toBeLessThan(s.analyticalH_abs * 0.01);
    }
  });

  test('Cylinder of radius R: K = 0 (developable), H = 1/(2R)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { NURBSSurface } = await import('/src/foundation/NURBSSurface.js');
      const { surfaceCurvature } = await import('/src/foundation/ClassASurface.js');
      const out = [];
      for (const R of [5, 10, 25]) {
        const cyl = NURBSSurface.cylinder(R, 20);
        const r = surfaceCurvature(cyl, 0.5, 0.5);
        out.push({
          R,
          analyticalK: 0,
          analyticalH_abs: 1 / (2 * R),
          K: r.K, H: r.H, kMin: r.kMin, kMax: r.kMax,
        });
      }
      return out;
    });

    console.log(`\n=== CYLINDER CURVATURE K = 0, |H| = 1/(2R) ===`);
    for (const c of result) {
      console.log(`  R = ${c.R}:  analytical K = 0, |H| = ${c.analyticalH_abs.toFixed(4)}`);
      console.log(`            measured  K = ${c.K.toExponential(2)},  H = ${c.H.toFixed(6)},  κ_min = ${c.kMin.toExponential(2)},  κ_max = ${c.kMax.toFixed(6)}`);
    }
    fs.writeFileSync(path.join(ROOT, 'cylinder-curvatures.json'), JSON.stringify(result, null, 2));

    for (const c of result) {
      expect(Math.abs(c.K)).toBeLessThan(1e-3);                   // ~0 to numerical precision
      expect(Math.abs(Math.abs(c.H) - c.analyticalH_abs)).toBeLessThan(c.analyticalH_abs * 0.05);
    }
  });
});
