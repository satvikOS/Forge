import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'bolt-spring-vessel');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.describe('M66 Bolted Joint + M67 Spring + M68 Pressure Vessel', () => {
  test.describe.configure({ timeout: 60000 });
  test.beforeAll(() => ensure(ROOT));

  test('Bolted joint: M10×1.5 grade 8.8, 75 % preload, 6 kN external', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { analyzeBoltedJoint, tensileArea } = await import('/src/foundation/BoltedJoint.js');
      const At_check = tensileArea(10, 1.5);   // expect 57.99 mm²
      const r = analyzeBoltedJoint({
        boltSize: 'M10', grade: '8.8',
        grip_mm: 25, P_ext_N: 6000,
        preloadFraction: 0.75,
      });
      return { At_check, ...r };
    });
    console.log(`\n=== BOLTED JOINT M10x1.5 grade 8.8 ===`);
    console.log(`Tensile area A_t = ${result.At_check.toFixed(2)} mm² (Shigley table 58.0)`);
    console.log(`Joint stiffness C = ${result.stiffness.C.toFixed(3)}  (k_b=${result.stiffness.k_b.toFixed(0)} N/mm, k_m=${result.stiffness.k_m.toFixed(0)})`);
    console.log(`Preload F_i = ${result.preload.F_i_N.toFixed(0)} N (σ_i = ${result.preload.sigma_i_MPa.toFixed(0)} MPa)`);
    console.log(`Loaded: F_bolt = ${result.loadedState.F_bolt_N.toFixed(0)} N, σ_max = ${result.loadedState.sigma_max_MPa.toFixed(0)} MPa`);
    console.log(`SF separation = ${result.safetyFactors.separation.toFixed(2)}, yield = ${result.safetyFactors.yield.toFixed(2)}, proof = ${result.safetyFactors.proof.toFixed(2)}, fatigue = ${result.safetyFactors.fatigue_Goodman.toFixed(2)}`);
    console.log(`Status: ${result.status}`);
    fs.writeFileSync(path.join(ROOT, 'bolt.json'), JSON.stringify(result, null, 2));

    // A_t exact: π/4 (10 − 0.9382·1.5)² = π/4 · 8.5927² = 57.99
    expect(result.At_check).toBeCloseTo(58.0, 0);
    // Preload F_i = 0.75 · 600 · 58 = 26 100 N
    expect(result.preload.F_i_N).toBeCloseTo(0.75 * 600 * result.At_check, -1);
    // All SFs should be positive
    expect(result.safetyFactors.separation).toBeGreaterThan(1);
    expect(result.safetyFactors.proof).toBeGreaterThan(0.5);
  });

  test('Helical compression spring (Shigley Ex 10-3 class)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { analyzeSpring, wahlFactor } = await import('/src/foundation/Spring.js');
      // Music wire d=2 mm, D=20 mm, N_a=14, F_min=0, F_max=20 N
      const r = analyzeSpring({
        d_mm: 2, D_mm: 20, N_active: 14,
        F_min_N: 0, F_max_N: 20,
        material: 'music_wire_A228', ends: 'closed_ground',
      });
      const Kw_check = wahlFactor(10);  // C = D/d = 10
      return { ...r, Kw_check };
    });
    console.log(`\n=== HELICAL SPRING (music wire d=2, D=20, N=14) ===`);
    console.log(`Spring index C = ${result.geometry.springIndex},  Wahl K = ${result.Wahl.toFixed(3)}  (check ${result.Kw_check.toFixed(3)})`);
    console.log(`Rate k = ${result.rate.k_N_per_mm.toFixed(3)} N/mm`);
    console.log(`τ_max = ${result.stresses.tau_max_MPa.toFixed(0)} MPa,  S_su = ${result.strengths.Ssu_MPa.toFixed(0)} MPa`);
    console.log(`SF static = ${result.safetyFactors.static.toFixed(2)},  SF fatigue (Sines) = ${result.safetyFactors.fatigue_Sines.toFixed(2)}`);
    console.log(`L_solid = ${result.geometry.L_solid_mm} mm,  L_free = ${result.geometry.L_free_mm.toFixed(1)} mm,  L0/D = ${result.geometry.L0_over_D.toFixed(2)}`);
    console.log(`Natural freq ≈ ${result.naturalFrequency_Hz.toFixed(0)} Hz`);
    console.log(`Buckling safe: ${result.bucklingSafe}`);
    fs.writeFileSync(path.join(ROOT, 'spring.json'), JSON.stringify(result, null, 2));

    // C = D/d = 20/2 = 10 exact
    expect(result.geometry.springIndex).toBe(10);
    // k = G d⁴ / (8 D³ N) = 81000 · 16 / (8 · 8000 · 14) = 1.446 N/mm
    expect(result.rate.k_N_per_mm).toBeCloseTo(1.446, 1);
    // K_W for C=10:  (4·10−1)/(4·10−4) + 0.615/10 = 39/36 + 0.0615 = 1.145
    expect(result.Wahl).toBeCloseTo(1.145, 2);
  });

  test('Pressure vessel: thin-wall + thick-wall + ASME minimum thickness', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { thinWallCylinder, thickWallCylinder, thinWallSphere, asmeMinimumThickness } =
        await import('/src/foundation/PressureVessel.js');

      // Thin-wall: 10 bar = 1 MPa, R=200 mm, t=5 mm (r/t=40, thin-wall regime)
      const thin = thinWallCylinder({ P_Pa: 1e6, r_mean_m: 0.200, t_m: 0.005 });

      // Thick-wall (Shigley Ex 3-12 in SI): P_i = 124 MPa, r_i = 25.4 mm, r_o = 35.6 mm
      // Expect σ_hoop @ inner ≈ 329 MPa
      const thick = thickWallCylinder({
        P_inner_Pa: 124e6, P_outer_Pa: 0,
        r_inner_m: 0.0254, r_outer_m: 0.0356,
      });

      // Sphere: same pressure + radius as thin cylinder, should give half stress
      const sphere = thinWallSphere({ P_Pa: 1e6, r_mean_m: 0.200, t_m: 0.005 });

      // ASME minimum t for 10 bar, R=200 mm, allowable 138 MPa, E=0.85
      const asme = asmeMinimumThickness({
        P_Pa: 1e6, r_inner_m: 0.200,
        allowableStress_Pa: 138e6,
        jointEfficiency: 0.85,
        corrosionAllowance_m: 0.0015,
      });
      return { thin, thick, sphere, asme };
    });

    console.log(`\n=== THIN-WALL CYLINDER (P=1 MPa, R=200, t=5 mm) ===`);
    console.log(`σ_hoop = ${(result.thin.sigma_hoop_Pa/1e6).toFixed(1)} MPa  (P R/t = 40.0 exact)`);
    console.log(`σ_axial = ${(result.thin.sigma_axial_Pa/1e6).toFixed(1)} MPa  (= half hoop)`);
    console.log(`σ_VM = ${(result.thin.sigma_von_mises_Pa/1e6).toFixed(2)} MPa`);

    console.log(`\n=== THICK-WALL (P_i=124 MPa, r_i=25.4, r_o=35.6) ===`);
    console.log(`Inner σ_hoop = ${(result.thick.inner.sigma_hoop_Pa/1e6).toFixed(1)} MPa (expect ~329)`);
    console.log(`Inner σ_radial = ${(result.thick.inner.sigma_radial_Pa/1e6).toFixed(1)} MPa (expect −124)`);
    console.log(`Outer σ_hoop = ${(result.thick.outer.sigma_hoop_Pa/1e6).toFixed(1)} MPa`);
    console.log(`Inner σ_VM = ${(result.thick.inner.sigma_von_mises_Pa/1e6).toFixed(0)} MPa`);

    console.log(`\n=== SPHERE (P=1 MPa, R=200, t=5 mm) ===`);
    console.log(`σ = ${(result.sphere.sigma_hoop_Pa/1e6).toFixed(1)} MPa  (half of cylinder hoop)`);

    console.log(`\n=== ASME MINIMUM (P=1 MPa, R=200, S=138 MPa, E=0.85) ===`);
    console.log(`t_calc = ${(result.asme.t_calculated_m*1000).toFixed(2)} mm`);
    console.log(`t_with_CA = ${(result.asme.t_with_CA_m*1000).toFixed(2)} mm`);
    fs.writeFileSync(path.join(ROOT, 'pressure-vessel.json'), JSON.stringify(result, null, 2));

    // Thin-wall: σ_hoop = P R / t = 1e6 · 0.200 / 0.005 = 40 MPa exact
    expect(result.thin.sigma_hoop_Pa / 1e6).toBeCloseTo(40, 1);
    expect(result.thin.sigma_axial_Pa / 1e6).toBeCloseTo(20, 1);
    expect(result.thin.thinWallValid).toBe(true);

    // Thick-wall Lamé: σ_hoop @ inner = P_i (r_i² + r_o²) / (r_o² − r_i²)
    //                = 124 · (645.16 + 1267.36) / (1267.36 - 645.16)
    //                = 124 · 1912.52 / 622.20 = 381 MPa
    expect(result.thick.inner.sigma_hoop_Pa / 1e6).toBeGreaterThan(300);
    expect(result.thick.inner.sigma_hoop_Pa / 1e6).toBeLessThan(450);
    // Inner radial = -P_i exactly
    expect(result.thick.inner.sigma_radial_Pa / 1e6).toBeCloseTo(-124, 1);

    // Sphere stress = half of cylinder hoop
    expect(result.sphere.sigma_hoop_Pa / 1e6).toBeCloseTo(20, 1);

    // ASME thickness > 0
    expect(result.asme.t_calculated_m).toBeGreaterThan(0);
    expect(result.asme.t_with_CA_m).toBeGreaterThan(result.asme.t_calculated_m);
  });
});
