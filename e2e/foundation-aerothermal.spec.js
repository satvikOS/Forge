import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'aerothermal');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test.describe('Aerothermal — convective Robin BCs in ThermalFEM (M49)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('1D rod, fixed-end + convection-end: T_L = T_0 / (1 + h L / k)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { TetMesh } = await import('/src/foundation/TetMesh.js');
      const { solveThermalSteady } = await import('/src/foundation/ThermalFEM.js');
      // 100 mm × 10 mm × 10 mm rod. k = 1 W/(mm·K), so analytical
      // T_L = T_0 / (1 + h L / k) for h = 0.01 W/(mm²·K), L = 100 mm.
      // → T_L = 100 / (1 + 0.01 · 100 / 1) = 100 / 2 = 50 °C.
      // Choose convenient numbers so we can hand-check.
      const k = 1;
      const h = 0.01;
      const L = 100;
      const Tend = 100;
      const Tinf = 0;
      const mesh = TetMesh.regularGrid([0, 0, 0], [L, 10, 10], 20, 2, 2);
      const leftNodes = mesh.selectNodes(([x]) => x < 1e-6);
      const fixedTemperatures = leftNodes.map(n => ({ node: n, value: Tend }));
      // Build convection BCs on the right (x = L) face.
      // Right-face nodes:
      const rightSet = new Set(mesh.selectNodes(([x]) => Math.abs(x - L) < 1e-6));
      // Find each tet that has 3 nodes on the right face → a face is on the boundary
      const convectionBCs = [];
      for (const tet of mesh.tets) {
        const onRight = tet.filter(n => rightSet.has(n));
        if (onRight.length === 3) {
          convectionBCs.push({ tri: onRight, h, Tinf });
        }
      }
      const r = solveThermalSteady({
        mesh, k, fixedTemperatures, convectionBCs,
      });
      // Average T on right face
      let TR = 0; let count = 0;
      for (const n of rightSet) { TR += r.temperature[n]; count++; }
      TR /= count;
      // Average T at midspan x = 50
      const midSet = new Set(mesh.selectNodes(([x]) => Math.abs(x - 50) < 1e-6));
      let TM = 0;
      for (const n of midSet) TM += r.temperature[n];
      TM /= midSet.size;
      return {
        TR_FEM: TR, TM_FEM: TM,
        TR_analytical: 50, TM_analytical: 75,
        cgIters: r.cgIterations,
        nodeCount: mesh.vertices.length,
        elemCount: mesh.tets.length,
      };
    });

    const errR = (result.TR_FEM - result.TR_analytical);
    const errM = (result.TM_FEM - result.TM_analytical);
    console.log(`\n=== 1D ROD with CONVECTION END ===`);
    console.log(`T(x=L) = ${result.TR_FEM.toFixed(3)} °C  (analytical 50 °C, err ${errR.toFixed(3)})`);
    console.log(`T(x=L/2) = ${result.TM_FEM.toFixed(3)} °C  (analytical 75 °C, err ${errM.toFixed(3)})`);
    console.log(`Mesh: ${result.elemCount} tets, ${result.nodeCount} nodes, CG ${result.cgIters} iter`);
    fs.writeFileSync(path.join(ROOT, 'rod-convection.json'), JSON.stringify(result, null, 2));

    expect(Math.abs(errR)).toBeLessThan(0.5);
    expect(Math.abs(errM)).toBeLessThan(0.5);
  });

  test('Cooled-blade-style problem: hot face + cold face convection', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { TetMesh } = await import('/src/foundation/TetMesh.js');
      const { solveThermalSteady } = await import('/src/foundation/ThermalFEM.js');
      // Thin wall: 100 × 30 × 5 mm. Hot side at z = 5 (T_gas = 1700,
      // h_ext = 0.005 W/(mm²·K)). Cold side at z = 0 (T_air = 600,
      // h_int = 0.002 W/(mm²·K)). k = Inconel ≈ 0.011 W/(mm·K).
      const k = 0.011;
      const h_ext = 0.005, T_gas = 1700;
      const h_int = 0.002, T_air = 600;
      const mesh = TetMesh.regularGrid([0, 0, 0], [100, 30, 5], 10, 4, 2);
      const topSet = new Set(mesh.selectNodes(([x, y, z]) => Math.abs(z - 5) < 1e-6));
      const botSet = new Set(mesh.selectNodes(([x, y, z]) => z < 1e-6));
      const cBCs = [];
      for (const tet of mesh.tets) {
        const ot = tet.filter(n => topSet.has(n));
        const ob = tet.filter(n => botSet.has(n));
        if (ot.length === 3) cBCs.push({ tri: ot, h: h_ext, Tinf: T_gas });
        if (ob.length === 3) cBCs.push({ tri: ob, h: h_int, Tinf: T_air });
      }
      const r = solveThermalSteady({
        mesh, k, convectionBCs: cBCs,
      });
      // Average T on top vs bottom
      let TT = 0; for (const n of topSet) TT += r.temperature[n]; TT /= topSet.size;
      let TB = 0; for (const n of botSet) TB += r.temperature[n]; TB /= botSet.size;
      return {
        T_top_FEM: TT, T_bot_FEM: TB,
        cgIters: r.cgIterations, minT: r.minT, maxT: r.maxT,
      };
    });

    // Analytical 1D: T_b = (h_ext T_gas / k_eff_ext + h_int T_air / k_eff_int) / (h_ext / k_eff + h_int / k_eff)
    // Steady 1D conduction with convection BCs on both ends:
    //   Resistances: R_ext = 1/h_ext = 200, R_cond = L/k = 5/0.011 = 454.5, R_int = 1/h_int = 500
    //   q = (T_gas − T_air) / (R_ext + R_cond + R_int) = 1100 / 1154.5 = 0.953 W/mm²
    //   T_top_metal = T_gas − q · R_ext = 1700 − 0.953 · 200 = 1509.4
    //   T_bot_metal = T_air + q · R_int = 600 + 0.953 · 500 = 1076.5
    const Rext = 1 / 0.005, Rcond = 5 / 0.011, Rint = 1 / 0.002;
    const q = (1700 - 600) / (Rext + Rcond + Rint);
    const TT_an = 1700 - q * Rext;
    const TB_an = 600 + q * Rint;
    const errT = result.T_top_FEM - TT_an;
    const errB = result.T_bot_FEM - TB_an;
    console.log(`\n=== COOLED-WALL PROBLEM (hot 1700 °C / cool 600 °C) ===`);
    console.log(`T_top metal = ${result.T_top_FEM.toFixed(2)} °C  (analytical ${TT_an.toFixed(2)}, err ${errT.toFixed(2)})`);
    console.log(`T_bot metal = ${result.T_bot_FEM.toFixed(2)} °C  (analytical ${TB_an.toFixed(2)}, err ${errB.toFixed(2)})`);
    console.log(`q heat flux = ${q.toFixed(4)} W/mm²`);
    console.log(`CG ${result.cgIters} iter`);
    fs.writeFileSync(path.join(ROOT, 'cooled-wall.json'), JSON.stringify(result, null, 2));

    expect(Math.abs(errT)).toBeLessThan(20);
    expect(Math.abs(errB)).toBeLessThan(20);
    expect(result.T_top_FEM).toBeGreaterThan(result.T_bot_FEM);
  });
});
