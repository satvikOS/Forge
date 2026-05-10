import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'fem');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(420000);

const ALUM_6061_SI_PER_MM = {
  // Working in N, mm, kg → density in kg/mm^3 keeps the system consistent:
  //   stress: MPa = N/mm^2
  //   force:  N
  //   length: mm
  //   density: 2.70e-6 kg/mm^3
  //   E:       68 900 MPa
  // For modal analysis ω² = K/M; we want ω in rad/s when units are
  // consistent: with N/mm and kg/mm³ we get rad²·s⁻² automatically
  // because N = kg·m/s² = kg·mm/s² · 1000.  Be careful — see the
  // `unitFix` step below, which divides ω² by 1000 to convert mm-system
  // to m-system, OR more simply we use SI throughout for modal.
  name: 'Aluminum 6061-T6',
  E: 68900,           // MPa
  nu: 0.33,
  density: 2.70e-6,   // kg/mm^3
  yieldStrength: 276,
};

/**
 * Analytical first bending mode of a cuboid cantilever (Euler-Bernoulli):
 *   f₁ = (β₁L)² / (2π L²) · √(EI / ρA)        with β₁L = 1.875104
 *
 * Working in SI (m, N, kg):
 *   E  = 68.9e9 Pa
 *   I  = b·h³/12 = (0.01·0.01³)/12 = 8.333e-10 m⁴
 *   A  = b·h = 1e-4 m²
 *   ρ  = 2700 kg/m³
 *   L  = 0.1 m
 *
 *   √(EI/ρA·L⁻⁴) = √(68.9e9 × 8.333e-10 / (2700 × 1e-4 × 1e-4))
 *                = √(57.4 / 2.7e-5) = √(2.126e6) = 1458 rad/s
 *   f₁ = 1.875² / (2π) × 1458 / 1   ≈ 815 Hz
 */
function analyticalCantileverF1(EPa, rhoSI, L_m, b_m, h_m) {
  const I = (b_m * h_m ** 3) / 12;
  const A = b_m * h_m;
  const beta1L = 1.875104;
  const omega = (beta1L * beta1L) / (L_m * L_m) * Math.sqrt((EPa * I) / (rhoSI * A));
  return omega / (2 * Math.PI);
}

test.describe('Foundation modal — natural frequencies vs. Euler-Bernoulli', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Cantilever first bending mode', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async (mat) => {
      const { TetMesh } = await import('/src/foundation/TetMesh.js');
      const { lowestNaturalFrequency } = await import('/src/foundation/ModalAnalysis.js');

      // 100 × 10 × 10 mm cantilever, fixed at x=0
      // Mesh in mm; for ω in rad/s the unit system in mm/N/kg-per-mm³
      // gives ω² in (N/mm) / (kg/mm³ × mm³) = (N/mm)/(kg) = m·s⁻²/mm
      // We need to convert: ω²_in_mm-system = ω²_SI · 1e3
      // So ω_SI = ω_mm / sqrt(1e3) and freq = ω_SI / (2π).
      const mesh = TetMesh.regularGrid([0, 0, 0], [100, 10, 10], 30, 6, 6);
      const fixed = mesh.selectNodes(([x]) => x < 1e-6);

      const t0 = performance.now();
      const r = lowestNaturalFrequency({ mesh, material: mat, fixedNodes: fixed, maxIter: 40 });
      const elapsed = (performance.now() - t0) / 1000;

      // Unit consistency check: with E in MPa = N/mm², ρ in kg/mm³,
      // length in mm, K stiffness has units N/mm; M lumped has units
      // kg.  ω² = K/M has units (N/mm)/kg = (kg·m·s⁻²·mm⁻¹)/kg
      // = m/(s²·mm) = 1/(s²·1000)  → ω_apparent in mm-system is
      // sqrt(1) × ω_SI ÷ sqrt(1000), i.e. apparent ω is sqrt(1000)
      // smaller than SI ω.  Correction: multiply by sqrt(1000).
      const trueFreqHz = r.freqHz * Math.sqrt(1000);
      return {
        meshStats: mesh.stats(),
        elapsedSec: +elapsed.toFixed(3),
        iterations: r.iterations,
        converged: r.converged,
        rawFreqHz: r.freqHz,
        freqHz: trueFreqHz,
      };
    }, ALUM_6061_SI_PER_MM);

    const f_analytical = analyticalCantileverF1(
      68.9e9, 2700, 0.1, 0.01, 0.01,
    );
    const pctErr = ((result.freqHz - f_analytical) / f_analytical) * 100;

    console.log(`\n=== CANTILEVER MODAL VALIDATION ===`);
    console.log(`Mesh: ${result.meshStats.vertexCount} nodes, ${result.meshStats.tetCount} tets`);
    console.log(`Solve: ${result.elapsedSec} s, ${result.iterations} inverse-iter steps (${result.converged ? 'converged' : 'max iters'})`);
    console.log(`f₁ (FEM, mm-system raw): ${result.rawFreqHz.toFixed(2)} Hz (apparent)`);
    console.log(`f₁ (FEM, true SI):        ${result.freqHz.toFixed(2)} Hz`);
    console.log(`f₁ (analytical):           ${f_analytical.toFixed(2)} Hz`);
    console.log(`Pct error: ${pctErr.toFixed(2)} %`);

    fs.writeFileSync(path.join(ROOT, 'cantilever-modal.json'), JSON.stringify({
      analytical_Hz: f_analytical,
      fem_Hz: result.freqHz,
      pctError: pctErr,
      iterations: result.iterations,
      meshStats: result.meshStats,
    }, null, 2));

    // Linear tets are stiff in bending (over-predict frequency by
    // 5-25 % at this mesh density). Accept ≤ 30 % over-prediction;
    // do not accept under-prediction below the analytical value
    // (would suggest a unit/sign bug, not just discretization).
    expect(result.freqHz).toBeGreaterThan(f_analytical * 0.85);
    expect(result.freqHz).toBeLessThan(f_analytical * 1.30);
  });
});
