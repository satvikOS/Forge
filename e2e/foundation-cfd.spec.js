import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'cfd');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

test('Potential flow over cylinder: Cp ≈ 1 - 4 sin²θ on the surface', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const out = await page.evaluate(async () => {
    const { solvePotentialFlow, sampleCylinderSurfaceCp, renderStreamlinesSVG }
      = await import('/src/foundation/PotentialFlow.js');

    // 401 × 161 grid (0.5 mm cells), free-stream U = 1, cylinder R = 8 at (50, 40).
    // Domain 200×80 mm. Cylinder centered → 5R clearance above and below
    // (some blockage but acceptable for grid-based potential flow).
    const nx = 401, ny = 161;
    const dx = 0.5, dy = 0.5;
    const cx = 50, cy = 40, R = 8;
    const U = 1;
    const isSolid = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= R * R;

    const t0 = performance.now();
    const result = solvePotentialFlow({
      nx, ny, dx, dy, U, isSolid,
      options: { tol: 1e-6, maxIter: 8000, omega: 1.85 },
    });
    const elapsed = (performance.now() - t0) / 1000;

    const cpSamples = sampleCylinderSurfaceCp(result, cx, cy, R, 60);
    const svg = renderStreamlinesSVG(result, { contours: 30 });

    return {
      grid: { nx, ny, dx, dy, U, R, cx, cy },
      elapsedSec: +elapsed.toFixed(3),
      iterations: result.iterations,
      residual: result.residual,
      cpSamples,
      svg,
    };
  });

  // Validation: rms error of Cp_FEM vs Cp_analytical
  let sumSq = 0;
  for (const s of out.cpSamples) {
    sumSq += (s.Cp_FEM - s.Cp_analytical) ** 2;
  }
  const rms = Math.sqrt(sumSq / out.cpSamples.length);
  const maxErr = Math.max(...out.cpSamples.map(s => Math.abs(s.Cp_FEM - s.Cp_analytical)));

  console.log(`\n=== POTENTIAL FLOW VALIDATION ===`);
  console.log(`Grid: ${out.grid.nx}×${out.grid.ny}, dx=${out.grid.dx}`);
  console.log(`Solver: ${out.iterations} GS-SOR sweeps, residual ${out.residual.toExponential(2)}`);
  console.log(`Solve time: ${out.elapsedSec} s`);
  console.log(`Cp validation (60 surface samples around cylinder):`);
  console.log(`  RMS error: ${rms.toFixed(4)}`);
  console.log(`  Max error: ${maxErr.toFixed(4)}`);
  console.log(`Sample (every 10°):`);
  for (let i = 0; i < out.cpSamples.length; i += 6) {
    const s = out.cpSamples[i];
    console.log(`  θ=${s.theta_deg.toFixed(1).padStart(6)}°: Cp_FEM = ${s.Cp_FEM.toFixed(3).padStart(6)}, analytical = ${s.Cp_analytical.toFixed(3).padStart(6)}, Δ = ${(s.Cp_FEM - s.Cp_analytical).toFixed(3)}`);
  }

  fs.writeFileSync(path.join(ROOT, 'cylinder-flow.json'), JSON.stringify({
    input: out.grid,
    iterations: out.iterations,
    residual: out.residual,
    elapsedSec: out.elapsedSec,
    cpSamples: out.cpSamples,
    validation: { rms, maxErr },
  }, null, 2));
  fs.writeFileSync(path.join(ROOT, 'cylinder-flow.svg'), out.svg);

  // Coarse validation tolerance: grid-resolution + finite-domain error.
  // Analytical assumes infinite domain; we have an 80-mm-tall channel
  // around an 8-mm radius (5 R), so blockage adds 5-15 % error.
  expect(rms).toBeLessThan(0.5);
  expect(out.iterations).toBeLessThan(8000);
});
