import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'cfd');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('Lid-driven cavity Re=100: u-centerline matches Ghia (1982) reference', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const out = await page.evaluate(async () => {
    const { solveLidDrivenCavity, sampleCenterlineU, renderCavitySVG }
      = await import('/src/foundation/NavierStokes2D.js');
    const t0 = performance.now();
    const r = solveLidDrivenCavity({
      Re: 100, U: 1, L: 1,
      nx: 65, ny: 65,
      maxIter: 25000, tol: 1e-5, psiSweeps: 30,
    });
    const elapsed = (performance.now() - t0) / 1000;
    const samples = sampleCenterlineU(r);
    const svg = renderCavitySVG(r, { contours: 24 });
    return {
      grid: { nx: r.nx, ny: r.ny, dt: r.dt },
      iterations: r.iterations,
      residual: r.residual,
      elapsedSec: +elapsed.toFixed(3),
      samples,
      svg,
    };
  });

  // RMS error against Ghia reference data
  let sumSq = 0, maxErr = 0;
  for (const s of out.samples) {
    const d = s.u_FEM - s.u_Ghia;
    sumSq += d * d;
    if (Math.abs(d) > maxErr) maxErr = Math.abs(d);
  }
  const rms = Math.sqrt(sumSq / out.samples.length);

  console.log(`\n=== LID-DRIVEN CAVITY Re = 100 ===`);
  console.log(`Grid: ${out.grid.nx}×${out.grid.ny}, dt = ${out.grid.dt.toExponential(2)}`);
  console.log(`Solver: ${out.iterations} time steps, residual ${out.residual.toExponential(2)}`);
  console.log(`Wall time: ${out.elapsedSec} s`);
  console.log(`Centerline u (FEM vs Ghia 1982):`);
  console.log(`  y       u_FEM      u_Ghia     Δ`);
  for (const s of out.samples) {
    console.log(`  ${s.y.toFixed(4)}  ${s.u_FEM.toFixed(5).padStart(8)}  ${s.u_Ghia.toFixed(5).padStart(8)}  ${(s.u_FEM - s.u_Ghia).toFixed(5).padStart(8)}`);
  }
  console.log(`RMS error: ${rms.toFixed(4)}`);
  console.log(`Max error: ${maxErr.toFixed(4)}`);

  fs.writeFileSync(path.join(ROOT, 'lid-driven-cavity-Re100.json'), JSON.stringify({
    input: { Re: 100, U: 1, L: 1, nx: out.grid.nx, ny: out.grid.ny },
    iterations: out.iterations,
    residual: out.residual,
    elapsedSec: out.elapsedSec,
    samples: out.samples,
    validation: { rms, maxErr, reference: 'Ghia, Ghia & Shin (1982) Table I, Re=100' },
  }, null, 2));
  fs.writeFileSync(path.join(ROOT, 'lid-driven-cavity-Re100.svg'), out.svg);

  // Tolerance: ~10% (coarse 65² grid, explicit Euler, first-order upwind).
  // Ghia ref is at 129² with much higher accuracy.
  expect(rms).toBeLessThan(0.15);
  expect(maxErr).toBeLessThan(0.25);
});
