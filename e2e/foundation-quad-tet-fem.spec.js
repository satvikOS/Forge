import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'fem');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(360000);

test('Quadratic 10-node tet beats linear tet on cantilever bending — error <10%', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const result = await page.evaluate(async () => {
    const { TetMesh } = await import('/src/foundation/TetMesh.js');
    const { QuadraticTetMesh } = await import('/src/foundation/QuadraticTetMesh.js');
    const { solveLinearStatic } = await import('/src/foundation/LinearTetFEM.js');
    const { solveLinearStaticQuadTet } = await import('/src/foundation/QuadTetFEM.js');
    const ALUM = { E: 68900, nu: 0.33, yieldStrength: 276 };

    const tic = () => performance.now();
    const toc = (t) => +((performance.now() - t) / 1000).toFixed(3);

    // Use a coarser grid (10 × 2 × 2) so the quadratic tet solve
    // stays well within e2e time budget. Quadratic tets at 10×2×2
    // have ~360 nodes and ~120 elements ⇒ ~1080 DOFs, comfortable
    // for the JS PCG solver.
    const NX = 10, NY = 2, NZ = 2;

    // --- LINEAR TET on the same grid ---
    const t0 = tic();
    const linMesh = TetMesh.regularGrid([0, 0, 0], [100, 10, 10], NX, NY, NZ);
    const fixedL = linMesh.selectNodes(([x]) => x < 1e-6);
    const tipL = linMesh.selectNodes(([x]) => Math.abs(x - 100) < 1e-6);
    const loadsL = tipL.map(n => ({ node: n, dof: 1, value: -100 / tipL.length }));
    const lin = solveLinearStatic({
      mesh: linMesh, material: ALUM, fixedNodes: fixedL, loads: loadsL,
    });
    const tLin = toc(t0);
    let dyLin = 0;
    for (const n of tipL) dyLin += lin.displacement[n * 3 + 1];
    dyLin /= tipL.length;

    // --- QUADRATIC TET (mid-edge nodes inserted) ---
    const t1 = tic();
    const qMesh = QuadraticTetMesh.fromLinearTetMesh(linMesh);
    const fixedQ = qMesh.selectNodes(([x]) => x < 1e-6);
    const tipQ = qMesh.selectNodes(([x]) => Math.abs(x - 100) < 1e-6);
    const loadsQ = tipQ.map(n => ({ node: n, dof: 1, value: -100 / tipQ.length }));
    const q = solveLinearStaticQuadTet({
      mesh: qMesh, material: ALUM, fixedNodes: fixedQ, loads: loadsQ,
    });
    const tQ = toc(t1);
    let dyQ = 0;
    for (const n of tipQ) dyQ += q.displacement[n * 3 + 1];
    dyQ /= tipQ.length;

    return {
      grid: [NX, NY, NZ],
      lin: {
        nodes: linMesh.vertices.length,
        elements: linMesh.tets.length,
        tipDy: dyLin,
        maxStressMPa: lin.maxStress,
        cgIters: lin.cgIterations,
        cgResidual: lin.cgResidual,
        wallSec: tLin,
      },
      quad: {
        nodes: qMesh.vertices.length,
        elements: qMesh.tets.length,
        tipDy: dyQ,
        maxStressMPa: q.maxStress,
        cgIters: q.cgIterations,
        cgResidual: q.cgResidual,
        wallSec: tQ,
      },
    };
  });

  // Analytical Euler-Bernoulli (mm-MPa-N units)
  const E = 68900, b = 10, h = 10, L = 100, P = 100;
  const I = (b * h ** 3) / 12;
  const deltaAnalytical = (P * L ** 3) / (3 * E * I);
  const sigmaAnalytical = ((P * L) * (h / 2)) / I;
  const errLin = ((Math.abs(result.lin.tipDy) - deltaAnalytical) / deltaAnalytical) * 100;
  const errQ = ((Math.abs(result.quad.tipDy) - deltaAnalytical) / deltaAnalytical) * 100;

  console.log(`\n=== QUADRATIC TET vs LINEAR TET CANTILEVER (${result.grid.join('×')} grid) ===`);
  console.log(``);
  console.log(`Analytical δ = PL³/(3EI) = ${deltaAnalytical.toFixed(4)} mm`);
  console.log(`Analytical σ_max = M·c/I  = ${sigmaAnalytical.toFixed(2)} MPa`);
  console.log(``);
  console.log(`LINEAR  TET: ${result.lin.elements} elements, ${result.lin.nodes} nodes`);
  console.log(`             δ_tip = ${result.lin.tipDy.toFixed(4)} mm  (error ${errLin.toFixed(2)} %)`);
  console.log(`             σ_max = ${result.lin.maxStressMPa.toFixed(2)} MPa`);
  console.log(`             CG ${result.lin.cgIters} iters in ${result.lin.wallSec} s`);
  console.log(``);
  console.log(`QUAD    TET: ${result.quad.elements} elements, ${result.quad.nodes} nodes`);
  console.log(`             δ_tip = ${result.quad.tipDy.toFixed(4)} mm  (error ${errQ.toFixed(2)} %)`);
  console.log(`             σ_max = ${result.quad.maxStressMPa.toFixed(2)} MPa`);
  console.log(`             CG ${result.quad.cgIters} iters in ${result.quad.wallSec} s`);
  console.log(``);
  console.log(`Bending-error reduction: linear |${Math.abs(errLin).toFixed(1)}%|  →  quad |${Math.abs(errQ).toFixed(1)}%|`);

  fs.writeFileSync(path.join(ROOT, 'quad-vs-lin-tet-cantilever.json'), JSON.stringify({
    grid: result.grid,
    analytical: { delta_mm: deltaAnalytical, sigma_MPa: sigmaAnalytical },
    linearTet: { ...result.lin, errorPct: errLin },
    quadraticTet: { ...result.quad, errorPct: errQ },
  }, null, 2));

  // Quadratic tet must be MUCH closer to analytical than linear tet
  // on the same coarse grid. Realistically:
  //   linear tet at 10×2×2 ≈ -55 % to -60 % under-prediction
  //   quad tet at 10×2×2  expected within  -10 %
  expect(Math.abs(errQ)).toBeLessThan(10);
  expect(Math.abs(errQ)).toBeLessThan(Math.abs(errLin));
  expect(Math.abs(errQ)).toBeLessThan(Math.abs(errLin) * 0.5);
});

test('Quadratic tet pure compression: σ_zz exact', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const result = await page.evaluate(async () => {
    const { TetMesh } = await import('/src/foundation/TetMesh.js');
    const { QuadraticTetMesh } = await import('/src/foundation/QuadraticTetMesh.js');
    const { solveLinearStaticQuadTet } = await import('/src/foundation/QuadTetFEM.js');
    const ALUM = { E: 68900, nu: 0.33, yieldStrength: 276 };

    // 20 × 20 × 20 mm cube under uniform top compression.
    const linMesh = TetMesh.regularGrid([0, 0, 0], [20, 20, 20], 3, 3, 3);
    const mesh = QuadraticTetMesh.fromLinearTetMesh(linMesh);
    const fixed = mesh.selectNodes(([x, y, z]) => z < 1e-6);
    const top = mesh.selectNodes(([x, y, z]) => Math.abs(z - 20) < 1e-6);
    const F = -1000;
    const loads = top.map(n => ({ node: n, dof: 2, value: F / top.length }));
    const fem = solveLinearStaticQuadTet({ mesh, material: ALUM, fixedNodes: fixed, loads });
    let sumSzz = 0; let count = 0;
    for (const sig of fem.elementStress) {
      if (!sig) continue;
      sumSzz += sig[2];
      count++;
    }
    return {
      meanSigmaZz: sumSzz / count,
      analyticalSigmaZz: F / (20 * 20),
      cgIters: fem.cgIterations,
      nodeCount: mesh.vertices.length,
      elemCount: mesh.tets.length,
    };
  });

  const pctErr = (result.meanSigmaZz - result.analyticalSigmaZz) / result.analyticalSigmaZz * 100;
  console.log(`\n=== QUAD TET PURE COMPRESSION ===`);
  console.log(`Mesh: ${result.elemCount} quad-tets, ${result.nodeCount} nodes`);
  console.log(`σ_zz mean = ${result.meanSigmaZz.toFixed(4)} MPa  vs  analytical ${result.analyticalSigmaZz.toFixed(4)} MPa  (error ${pctErr.toFixed(3)} %)`);
  console.log(`CG iterations: ${result.cgIters}`);

  // Pure compression should be element-exact (linear strain, constant
  // gradient inside the element). Quadratic should hit machine-precision
  // for this case.
  expect(Math.abs(pctErr)).toBeLessThan(1);
});
