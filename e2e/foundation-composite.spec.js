import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'composite');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('Composite Laminate (M46) — CLT + Tsai-Wu', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Quasi-isotropic [0/45/-45/90]s under uniaxial N_x', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { laminateABD, solveLaminate, laminateFirstPlyFailure, Materials } =
        await import('/src/foundation/CompositeLaminate.js');

      const mat = Materials.CarbonEpoxyT300_5208;
      const ply = (theta) => ({ material: mat, thickness: 0.125, theta_deg: theta });
      const stack = [
        ply(0), ply(45), ply(-45), ply(90),
        ply(90), ply(-45), ply(45), ply(0),     // symmetric
      ];
      const { A, B, D, totalThickness } = laminateABD(stack);
      let bMax = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        if (Math.abs(B[i][j]) > bMax) bMax = Math.abs(B[i][j]);
      }
      // Apply N_x = 100 N/mm (= 0.1 kN/mm in-plane tension)
      const N = [100, 0, 0];
      const M = [0, 0, 0];
      const r = solveLaminate(stack, N, M);
      const fpf = laminateFirstPlyFailure(stack, r.plyStresses);
      return {
        totalThickness,
        A_diag: [A[0][0], A[1][1], A[2][2]],
        B_max: bMax,
        D_diag: [D[0][0], D[1][1], D[2][2]],
        eps0: r.eps0, kappa: r.kappa,
        plyStresses: r.plyStresses,
        fpfStrengthRatio: fpf.strengthRatio,
        fpfGoverningPly: fpf.governingPly,
      };
    });

    console.log(`\n=== QUASI-ISOTROPIC [0/45/-45/90]s — N_x = 100 N/mm ===`);
    console.log(`Total thickness: ${result.totalThickness.toFixed(3)} mm`);
    console.log(`A diag: ${result.A_diag.map(v => v.toFixed(0)).join(', ')} N/mm`);
    console.log(`B max abs (should be ~0 for symmetric): ${result.B_max.toExponential(3)}`);
    console.log(`D diag: ${result.D_diag.map(v => v.toFixed(0)).join(', ')} N·mm`);
    console.log(`Mid-plane strain ε⁰: ${result.eps0.map(v => v.toExponential(3)).join(', ')}`);
    console.log(`Curvature κ: ${result.kappa.map(v => v.toExponential(3)).join(', ')}`);
    console.log(`First-ply failure load multiplier (Tsai-Wu): ${result.fpfStrengthRatio.toFixed(2)}× nominal load`);
    console.log(`Governing ply: index ${result.fpfGoverningPly} (θ=${result.plyStresses[result.fpfGoverningPly].thetaDeg}°)`);
    fs.writeFileSync(path.join(ROOT, 'quasi-iso-Nx.json'), JSON.stringify(result, null, 2));

    // Symmetric stack → B ≈ 0 (machine precision)
    expect(result.B_max).toBeLessThan(1e-9);
    // No curvature for pure membrane load on symmetric laminate
    for (const k of result.kappa) expect(Math.abs(k)).toBeLessThan(1e-12);
    // First-ply failure expected from the 90° plies (they carry transverse
    // stress with low Y_t = 40 MPa)
    expect(result.fpfStrengthRatio).toBeGreaterThan(0);
    expect(result.fpfStrengthRatio).toBeLessThan(50);
  });

  test('Cross-ply [0/90]_4 vs UD [0]_8 — stiffness comparison', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { laminateABD, Materials } = await import('/src/foundation/CompositeLaminate.js');
      const mat = Materials.CarbonEpoxyT300_5208;
      const ply = (t) => ({ material: mat, thickness: 0.125, theta_deg: t });
      const ud = Array(8).fill(0).map(() => ply(0));
      const xply = [];
      for (let i = 0; i < 4; i++) { xply.push(ply(0)); xply.push(ply(90)); }
      const a1 = laminateABD(ud);
      const a2 = laminateABD(xply);
      return {
        UD_A11: a1.A[0][0], UD_A22: a1.A[1][1],
        XPLY_A11: a2.A[0][0], XPLY_A22: a2.A[1][1],
        UD_thickness: a1.totalThickness,
      };
    });

    console.log(`\n=== UD vs CROSS-PLY STIFFNESS ===`);
    console.log(`UD [0]_8:    A11 = ${result.UD_A11.toFixed(0)},  A22 = ${result.UD_A22.toFixed(0)} N/mm`);
    console.log(`X [0/90]_4:  A11 = ${result.XPLY_A11.toFixed(0)},  A22 = ${result.XPLY_A22.toFixed(0)} N/mm`);
    fs.writeFileSync(path.join(ROOT, 'ud-vs-xply.json'), JSON.stringify(result, null, 2));

    // UD has highest A11 and lowest A22; cross-ply balances them.
    expect(result.UD_A11).toBeGreaterThan(result.XPLY_A11);
    expect(result.UD_A22).toBeLessThan(result.XPLY_A22);
    // Cross-ply A11 ≈ A22 (perfectly balanced)
    expect(Math.abs(result.XPLY_A11 - result.XPLY_A22)).toBeLessThan(1);
  });

  test('Tsai-Wu strength of 0° UD ply under pure transverse tension', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { tsaiWu, Materials } = await import('/src/foundation/CompositeLaminate.js');
      const mat = Materials.CarbonEpoxyT300_5208;
      // Apply transverse stress σ2 = 30 MPa (below Y_t = 40)
      const tw = tsaiWu([0, 30, 0], mat);
      // and σ2 = 50 MPa (above Y_t)
      const twAbove = tsaiWu([0, 50, 0], mat);
      return {
        below: tw,
        above: twAbove,
      };
    });

    console.log(`\n=== TSAI-WU on UD T300/5208 — pure σ_2 ===`);
    console.log(`σ2 = 30 MPa (Y_t = 40):  FI = ${result.below.failureIndex.toFixed(3)},  R = ${result.below.strengthRatio.toFixed(3)}`);
    console.log(`σ2 = 50 MPa (Y_t = 40):  FI = ${result.above.failureIndex.toFixed(3)},  R = ${result.above.strengthRatio.toFixed(3)}`);
    fs.writeFileSync(path.join(ROOT, 'tsai-wu-uniaxial.json'), JSON.stringify(result, null, 2));

    // 30 MPa is below Y_t = 40, so R > 1 (load can grow)
    expect(result.below.strengthRatio).toBeGreaterThan(1);
    // 50 MPa is above Y_t = 40, so R < 1 (load must shrink)
    expect(result.above.strengthRatio).toBeLessThan(1);
  });
});
