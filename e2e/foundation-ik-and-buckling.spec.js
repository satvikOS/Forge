import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const IK_ROOT = path.join(REPO_ROOT, 'foundation-output', 'ik');
const BK_ROOT = path.join(REPO_ROOT, 'foundation-output', 'buckling');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(420000);

test.describe('Foundation IK + buckling', () => {
  test.beforeAll(() => { ensure(IK_ROOT); ensure(BK_ROOT); });

  test('IK: 3-DOF planar arm reaches multiple targets', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { IKChain } = await import('/src/foundation/IKChain.js');

      // Three-link planar arm in the XY plane:
      //   joint 0 at world origin, axis = +Z
      //   link 1: 100 mm along +X
      //   joint 1, axis = +Z
      //   link 2:  80 mm along +X
      //   joint 2, axis = +Z
      //   link 3:  60 mm along +X
      //   tip at end of link 3
      const chain = new IKChain([
        { axis: 'z', offset: [0, 0, 0] },
        { axis: 'z', offset: [100, 0, 0] },
        { axis: 'z', offset: [80, 0, 0] },
      ], [0, 0, 0], { endEffectorOffset: [60, 0, 0] });

      // Reachable workspace radius = 100 + 80 + 60 = 240 mm.
      // Targets within reach + one near-singular (fully extended).
      const targets = [
        { name: 'mid-reach', xy: [150, 60] },
        { name: 'inner',     xy: [80, -50] },
        { name: 'far-corner',xy: [180, 100] },
        { name: 'near-singular (extended)', xy: [235, 5] },
        { name: 'reverse',   xy: [-50, 90] },
      ];

      const results = [];
      for (const tg of targets) {
        // Reset to neutral
        chain.angles = [0.1, 0.1, 0.1];
        const r = chain.solveIK([tg.xy[0], tg.xy[1], 0], {
          maxIter: 300, tol: 0.01, lambda: 0.05, stepSize: 0.3,
        });
        results.push({
          name: tg.name,
          target: tg.xy,
          finalAngles_deg: r.angles.map(a => a * 180 / Math.PI),
          finalDistance: r.finalDistance,
          iterations: r.iterations,
          converged: r.converged,
          status: r.status,
        });
      }
      return results;
    });

    console.log(`\n=== IK 3-DOF PLANAR ARM ===`);
    for (const r of result) {
      console.log(`  ${r.name.padEnd(35)} → target [${r.target.join(', ').padEnd(10)}]  ` +
        `Δ=${r.finalDistance.toFixed(3)}mm  ${r.iterations} iter  ${r.converged ? 'OK' : (r.status || 'no-conv')}`);
      console.log(`    angles: [${r.finalAngles_deg.map(a => a.toFixed(2)).join(', ')}]°`);
    }
    fs.writeFileSync(path.join(IK_ROOT, 'planar-arm-results.json'), JSON.stringify(result, null, 2));

    // 4 of 5 should converge cleanly
    const converged = result.filter(r => r.converged).length;
    expect(converged).toBeGreaterThanOrEqual(4);
    // For converged ones, final distance must be < 0.05 mm (tol set above is 0.01 + slack)
    for (const r of result) {
      if (r.converged) expect(r.finalDistance).toBeLessThan(0.05);
    }
  });

  test('Buckling: cantilever column vs Euler P_cr = π²EI/L²', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { TetMesh } = await import('/src/foundation/TetMesh.js');
      const { solveBuckling } = await import('/src/foundation/BucklingAnalysis.js');

      // 100 mm × 10 × 10 mm column, Aluminum 6061-T6
      // Fixed-free (cantilever): L_e = 2L, P_cr = π² EI / (2L)² = π² EI / 4L²
      const mesh = TetMesh.regularGrid([0, 0, 0], [100, 10, 10], 25, 5, 5);
      const fixed = mesh.selectNodes(([x]) => x < 1e-6);
      const fixedDofs = [];
      for (const n of fixed) for (let d = 0; d < 3; d++) fixedDofs.push({ node: n, dof: d });

      // Reference axial compressive load on the FREE end: total -1 N (split)
      const tipNodes = mesh.selectNodes(([x]) => Math.abs(x - 100) < 1e-6);
      const referenceLoads = tipNodes.map(n => ({ node: n, dof: 0, value: -1 / tipNodes.length }));

      const t0 = performance.now();
      const r = solveBuckling({
        mesh, material: { E: 68900, nu: 0.33 },
        fixedDofs, referenceLoads,
        options: { maxIter: 30 },
      });
      const elapsed = (performance.now() - t0) / 1000;

      return {
        meshStats: mesh.stats(),
        elapsedSec: +elapsed.toFixed(3),
        lambda: r.lambda,
        iterations: r.iterations,
        converged: r.converged,
        cgInner: r.cgInner,
      };
    });

    // Analytical: P_cr = π² E I / (k L)² with k = 2 for fixed-free
    const E = 68900, b = 10, h = 10, L = 100;
    const I = (b * h ** 3) / 12;
    const Le = 2 * L;
    const Pcr_euler = (PI_squared(E, I, Le));
    const Pcr_FEM = result.lambda * 1;   // λ × 1 N reference load = N

    console.log(`\n=== BUCKLING (fixed-free cantilever 100×10×10 mm) ===`);
    console.log(`Mesh: ${result.meshStats.tetCount} tets, ${result.meshStats.vertexCount} nodes`);
    console.log(`Solve: ${result.elapsedSec} s, ${result.iterations} outer iters (${result.converged ? 'converged' : 'max'}), CG ${result.cgInner}`);
    console.log(`λ (load multiplier on -1 N reference): ${result.lambda.toFixed(2)}`);
    console.log(`P_cr (FEM):       ${Pcr_FEM.toFixed(2)} N`);
    console.log(`P_cr (analytical): ${Pcr_euler.toFixed(2)} N (Euler, k=2)`);
    const pctErr = (Pcr_FEM - Pcr_euler) / Pcr_euler * 100;
    console.log(`Pct error: ${pctErr.toFixed(2)} %`);

    fs.writeFileSync(path.join(BK_ROOT, 'cantilever-buckling.json'), JSON.stringify({
      input: { E, b, h, L, Le, material: 'Al 6061-T6' },
      analytical_Pcr_N: Pcr_euler,
      fem_Pcr_N: Pcr_FEM,
      fem_lambda: result.lambda,
      pctError: pctErr,
      meshStats: result.meshStats,
    }, null, 2));

    // Linear tets are bending-stiff → expect FEM > analytical by 10-50 %
    expect(Math.abs(pctErr)).toBeLessThan(60);
    expect(Pcr_FEM).toBeGreaterThan(Pcr_euler * 0.7);
  });
});

function PI_squared(E, I, Le) {
  return (Math.PI * Math.PI * E * I) / (Le * Le);
}
