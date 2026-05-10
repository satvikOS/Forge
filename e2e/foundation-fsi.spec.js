import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'fsi');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

test('FSI: cantilever under uniform pressure → δ matches q·L⁴/(8EI)', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const result = await page.evaluate(async () => {
    const { TetMesh } = await import('/src/foundation/TetMesh.js');
    const { solveUniformPressureFSI } = await import('/src/foundation/FSICoupling.js');

    // 100 mm × 10 mm × 10 mm cantilever, fixed at x=0, pressure on
    // +y face (y = 10 face = top).
    const mesh = TetMesh.regularGrid([0, 0, 0], [100, 10, 10], 30, 6, 6);
    const fixed = mesh.selectNodes(([x]) => x < 1e-6);

    const ALUM = { name: 'Aluminum 6061-T6', E: 68900, nu: 0.33, yieldStrength: 276 };
    const pressureMPa = 0.05;   // 0.05 MPa = 50 kPa = ~half atmospheric

    const r = solveUniformPressureFSI({
      mesh, material: ALUM, fixedNodes: fixed,
      pressureFaceNormal: [0, 1, 0], pressureMPa,
      dotThreshold: 0.7,
    });

    // Sample tip y-displacement
    const tipNodes = mesh.selectNodes(([x]) => Math.abs(x - 100) < 1e-6);
    let dyAvg = 0;
    for (const n of tipNodes) dyAvg += r.fem.displacement[n * 3 + 1];
    dyAvg /= tipNodes.length;

    return {
      meshStats: mesh.stats(),
      ...r,
      tipDyMm: dyAvg,
      maxStressMPa: r.fem.maxStress,
      sf: r.fem.safetyFactor,
      cgIters: r.fem.cgIterations,
    };
  });

  // Analytical: q · L⁴ / (8 · E · I)
  // q = p · width = 0.05 MPa · 10 mm = 0.5 N/mm
  // I = b · h³ / 12 = 10 · 10³ / 12 = 833.3 mm⁴
  // E = 68 900 MPa
  // L = 100 mm
  // δ = 0.5 · 100⁴ / (8 · 68 900 · 833.3) = 5e7 / 4.59e8 = 0.1089 mm
  const E = 68900, b = 10, h = 10, L = 100;
  const I = (b * h ** 3) / 12;
  const q = 0.05 * b;   // N/mm
  const deltaAnalytical = (q * L ** 4) / (8 * E * I);
  // Total force = pressure × area = 0.05 · 10 · 100 = 50 N
  const totalForceAnalytical = 0.05 * b * L;

  const pctErr = ((Math.abs(result.tipDyMm) - deltaAnalytical) / deltaAnalytical) * 100;

  console.log(`\n=== FSI: CANTILEVER UNDER UNIFORM PRESSURE ===`);
  console.log(`Mesh: ${result.meshStats.tetCount} tets, ${result.meshStats.vertexCount} nodes`);
  console.log(`Boundary tris: ${result.boundaryTriCount}, loaded faces (top, n·ŷ ≥ 0.7): ${result.loadedFaceCount}`);
  console.log(`Loaded area: ${result.loadedTotalAreaMm2.toFixed(2)} mm² (analytical: ${b * L} mm²)`);
  console.log(`Total load (FEM): [${result.totalLoadVectorN.map(v => v.toFixed(3)).join(', ')}] N`);
  console.log(`Total load (analytical): [0, -${totalForceAnalytical}, 0] N (= -p·b·L)`);
  console.log(``);
  console.log(`Tip δy:`);
  console.log(`  FEM:        ${result.tipDyMm.toFixed(5)} mm`);
  console.log(`  analytical: ${(-deltaAnalytical).toFixed(5)} mm  (= q·L⁴/(8EI))`);
  console.log(`  pct error:  ${pctErr.toFixed(2)} %`);
  console.log(`Max von Mises: ${result.maxStressMPa.toFixed(2)} MPa, SF = ${result.sf.toFixed(1)}`);
  console.log(`CG iterations: ${result.cgIters}`);

  fs.writeFileSync(path.join(ROOT, 'cantilever-pressure.json'), JSON.stringify({
    input: { L, b, h, pressureMPa: 0.05, material: 'Al 6061-T6', E, I },
    analytical: { delta_mm: -deltaAnalytical, total_force_N: -totalForceAnalytical, q_N_per_mm: q },
    fem: result,
    pctError: pctErr,
  }, null, 2));

  // Validation: total applied load should be very close to analytical
  expect(Math.abs(result.totalLoadVectorN[1] - -totalForceAnalytical)).toBeLessThan(1.0);   // < 1 N tolerance
  expect(result.loadedTotalAreaMm2).toBeCloseTo(b * L, 0);

  // Linear-tet under-predicts deflection by ~20 % (consistent with the
  // earlier static cantilever validation).
  expect(Math.abs(result.tipDyMm)).toBeGreaterThan(deltaAnalytical * 0.6);
  expect(Math.abs(result.tipDyMm)).toBeLessThan(deltaAnalytical * 1.05);
});
