import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'plate');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(300000);

test.describe('Plate FEM — thin-slab quadratic-tet (M45 closes thin-walled gap)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Simply-supported square plate, uniform pressure', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { solvePlate, plateRigidity } = await import('/src/foundation/PlateFEM.js');
      const E = 200000, nu = 0.30;             // steel, MPa
      const h = 5, L = 200;                    // 200 × 200 × 5 mm — thicker so 1 z-layer captures it
      const q = -0.001;                        // 1 kPa downward
      const D = plateRigidity(E, nu, h);
      const r = solvePlate({
        L, W: L, thickness: h, material: { E, nu },
        boundary: 'simply-supported', uniformPressure: q,
        options: { nx: 12, ny: 12, nz: 1 },
      });
      return {
        wMax_mm: r.wMax,
        D_Nmm: D,
        analyticalMid_mm: 0.00406 * q * L ** 4 / D,
        elements: r.elementCount,
        nodes: r.nodeCount,
        cg: r.cgIterations,
      };
    });

    const err = (result.wMax_mm - result.analyticalMid_mm) / result.analyticalMid_mm * 100;
    console.log(`\n=== SIMPLY-SUPPORTED SQUARE PLATE (200×200×5, 1 kPa) — thin-slab quad-tet ===`);
    console.log(`D = ${result.D_Nmm.toFixed(0)} N·mm`);
    console.log(`Analytical δ = 0.00406 q L⁴ / D = ${result.analyticalMid_mm.toFixed(4)} mm`);
    console.log(`FEA   δ_mid                       = ${result.wMax_mm.toFixed(4)} mm  (err ${err.toFixed(2)} %)`);
    console.log(`Mesh: ${result.elements} quad-tets, ${result.nodes} nodes, CG ${result.cg} iter`);
    fs.writeFileSync(path.join(ROOT, 'simply-supported-uniform.json'), JSON.stringify(result, null, 2));
    // Single z-layer + quad-tet typically gives ~10-20 % under at these meshes
    expect(Math.abs(err)).toBeLessThan(25);
    expect(result.wMax_mm).toBeLessThan(0);   // deflects down
  });

  test('Plate rigidity formula sanity', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
    const D = await page.evaluate(async () => {
      const { plateRigidity } = await import('/src/foundation/PlateFEM.js');
      // E = 200 GPa = 200000 MPa, ν = 0.3, h = 5 mm
      // D = 200000 · 125 / (12 · 0.91) = 2,289,377.29
      return plateRigidity(200000, 0.30, 5);
    });
    expect(D).toBeCloseTo(2289377.29, 0);
  });
});
