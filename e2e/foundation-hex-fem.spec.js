import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'fem');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('Linear hex FEM vs linear tet on cantilever — bending error tightens', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const result = await page.evaluate(async () => {
    const { HexMesh } = await import('/src/foundation/HexMesh.js');
    const { TetMesh } = await import('/src/foundation/TetMesh.js');
    const { solveLinearStaticHex } = await import('/src/foundation/LinearHexFEM.js');
    const { solveLinearStatic } = await import('/src/foundation/LinearTetFEM.js');
    const ALUM = { E: 68900, nu: 0.33, yieldStrength: 276 };

    // Same cantilever 100 × 10 × 10 mm Al 6061-T6, 100 N tip load,
    // mesh 20 × 4 × 4. Compare hex vs tet on the SAME grid.
    const tic = () => performance.now();
    const toc = (t) => +((performance.now() - t) / 1000).toFixed(3);

    // --- HEX ---
    const t0 = tic();
    const hexMesh = HexMesh.regularGrid([0, 0, 0], [100, 10, 10], 20, 4, 4);
    const fixedH = hexMesh.selectNodes(([x]) => x < 1e-6);
    const tipH = hexMesh.selectNodes(([x]) => Math.abs(x - 100) < 1e-6);
    const loadsH = tipH.map(n => ({ node: n, dof: 1, value: -100 / tipH.length }));
    const hex = solveLinearStaticHex({
      mesh: hexMesh, material: ALUM,
      fixedNodes: fixedH, loads: loadsH,
    });
    const tHex = toc(t0);
    let dyHex = 0;
    for (const n of tipH) dyHex += hex.displacement[n * 3 + 1];
    dyHex /= tipH.length;

    // --- TET (same grid) ---
    const t1 = tic();
    const tetMesh = TetMesh.regularGrid([0, 0, 0], [100, 10, 10], 20, 4, 4);
    const fixedT = tetMesh.selectNodes(([x]) => x < 1e-6);
    const tipT = tetMesh.selectNodes(([x]) => Math.abs(x - 100) < 1e-6);
    const loadsT = tipT.map(n => ({ node: n, dof: 1, value: -100 / tipT.length }));
    const tet = solveLinearStatic({
      mesh: tetMesh, material: ALUM,
      fixedNodes: fixedT, loads: loadsT,
    });
    const tTet = toc(t1);
    let dyTet = 0;
    for (const n of tipT) dyTet += tet.displacement[n * 3 + 1];
    dyTet /= tipT.length;

    return {
      hex: {
        elementCount: hexMesh.hexes.length,
        nodeCount: hexMesh.vertices.length,
        tipDy: dyHex,
        maxStressMPa: hex.maxStress,
        cgIters: hex.cgIterations,
        cgResidual: hex.cgResidual,
        wallSec: tHex,
      },
      tet: {
        elementCount: tetMesh.tets.length,
        nodeCount: tetMesh.vertices.length,
        tipDy: dyTet,
        maxStressMPa: tet.maxStress,
        cgIters: tet.cgIterations,
        cgResidual: tet.cgResidual,
        wallSec: tTet,
      },
    };
  });

  // Analytical Euler-Bernoulli
  const E = 68900, b = 10, h = 10, L = 100, P = 100;
  const I = (b * h ** 3) / 12;
  const deltaAnalytical = (P * L ** 3) / (3 * E * I);
  const sigmaAnalytical = ((P * L) * (h / 2)) / I;
  const errHex = ((Math.abs(result.hex.tipDy) - deltaAnalytical) / deltaAnalytical) * 100;
  const errTet = ((Math.abs(result.tet.tipDy) - deltaAnalytical) / deltaAnalytical) * 100;

  console.log(`\n=== HEX vs TET CANTILEVER (20 × 4 × 4 grid) ===`);
  console.log(``);
  console.log(`Analytical δ = PL³/(3EI) = ${deltaAnalytical.toFixed(4)} mm`);
  console.log(`Analytical σ_max = M·c/I = ${sigmaAnalytical.toFixed(2)} MPa`);
  console.log(``);
  console.log(`HEX:  ${result.hex.elementCount} elements, ${result.hex.nodeCount} nodes`);
  console.log(`      δ_tip = ${result.hex.tipDy.toFixed(4)} mm  (error ${errHex.toFixed(2)} %)`);
  console.log(`      σ_max = ${result.hex.maxStressMPa.toFixed(2)} MPa`);
  console.log(`      CG ${result.hex.cgIters} iters in ${result.hex.wallSec} s`);
  console.log(``);
  console.log(`TET:  ${result.tet.elementCount} elements, ${result.tet.nodeCount} nodes`);
  console.log(`      δ_tip = ${result.tet.tipDy.toFixed(4)} mm  (error ${errTet.toFixed(2)} %)`);
  console.log(`      σ_max = ${result.tet.maxStressMPa.toFixed(2)} MPa`);
  console.log(`      CG ${result.tet.cgIters} iters in ${result.tet.wallSec} s`);
  console.log(``);
  console.log(`Bending-error improvement: hex |${Math.abs(errHex).toFixed(1)}%| vs tet |${Math.abs(errTet).toFixed(1)}%|`);

  fs.writeFileSync(path.join(ROOT, 'hex-vs-tet-cantilever.json'), JSON.stringify({
    analytical: { delta_mm: deltaAnalytical, sigma_MPa: sigmaAnalytical },
    hex: { ...result.hex, errorPct: errHex },
    tet: { ...result.tet, errorPct: errTet },
  }, null, 2));

  // HEX should be much closer to analytical than TET. At a coarse
  // 20×4×4 grid hex is around −11 % while tet is −33 %, so hex is
  // ~3× more accurate per node. Refining to 30×6×6 brings hex to ~5 %
  // (validated separately in M-future iterations).
  expect(Math.abs(errHex)).toBeLessThan(15);
  expect(Math.abs(errHex)).toBeLessThan(Math.abs(errTet));
  // Concrete improvement headline: hex error must be ≤ HALF the tet error
  expect(Math.abs(errHex)).toBeLessThan(Math.abs(errTet) * 0.5);
});

test('Pure compression hex: σ_zz exact', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const result = await page.evaluate(async () => {
    const { HexMesh } = await import('/src/foundation/HexMesh.js');
    const { solveLinearStaticHex } = await import('/src/foundation/LinearHexFEM.js');
    const ALUM = { E: 68900, nu: 0.33, yieldStrength: 276 };

    // 20×20×20 mm cube under uniform top compression.
    const mesh = HexMesh.regularGrid([0, 0, 0], [20, 20, 20], 4, 4, 4);
    const fixed = mesh.selectNodes(([x, y, z]) => z < 1e-6);
    const top = mesh.selectNodes(([x, y, z]) => Math.abs(z - 20) < 1e-6);
    const F = -1000;
    const loads = top.map(n => ({ node: n, dof: 2, value: F / top.length }));
    const fem = solveLinearStaticHex({ mesh, material: ALUM, fixedNodes: fixed, loads });
    let sumSzz = 0; let count = 0;
    for (const sig of fem.elementStress) {
      sumSzz += sig[2];
      count++;
    }
    return {
      meanSigmaZz: sumSzz / count,
      analyticalSigmaZz: F / (20 * 20),
      cgIters: fem.cgIterations,
    };
  });

  const pctErr = (result.meanSigmaZz - result.analyticalSigmaZz) / result.analyticalSigmaZz * 100;
  console.log(`\nPure compression hex: σ_zz = ${result.meanSigmaZz.toFixed(4)} MPa  vs  analytical ${result.analyticalSigmaZz.toFixed(4)} MPa  (error ${pctErr.toFixed(3)} %)`);
  expect(Math.abs(pctErr)).toBeLessThan(1);
});
