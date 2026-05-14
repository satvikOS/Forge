import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'machine-elements');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.describe('M63 Bearings + M64 Gears + M65 Shafts', () => {
  test.describe.configure({ timeout: 60000 });
  test.beforeAll(() => ensure(ROOT));

  test('Bearing L10 life (Shigley Ex 11-4 deep-groove ball)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { bearingLife, equivalentDynamicLoad, hertzContact } = await import('/src/foundation/Bearings.js');
      // SKF 6210 deep-groove: C = 35.1 kN, C0 = 23.2 kN.
      // Pure radial 4 kN, axial 2 kN, 1700 RPM
      const eq = equivalentDynamicLoad({ Fr_kN: 4, Fa_kN: 2, C0_kN: 23.2 });
      const life = bearingLife({ C_kN: 35.1, P_kN: eq.P_kN, rpm: 1700, type: 'ball' });
      // Hertz: ball Ø10 mm, 200 N normal force, race radius -10.5 mm (slight conformity)
      const hertz = hertzContact({ force_N: 200, R_ball_m: 0.005, R_race_m: -0.00525 });
      return { eq, life, hertz };
    });
    console.log(`\n=== BEARING 6210 ===`);
    console.log(`Equiv load P = ${result.eq.P_kN.toFixed(2)} kN (X=${result.eq.X}, Y=${result.eq.Y.toFixed(2)}, e=${result.eq.e.toFixed(3)})`);
    console.log(`L10 = ${result.life.L10_Mrev.toFixed(1)} million revs = ${result.life.L10_hours.toFixed(0)} hours = ${(result.life.L10_hours/24/365).toFixed(2)} years @ 24/7`);
    console.log(`Hertz contact: p_max = ${(result.hertz.p_max_Pa/1e6).toFixed(0)} MPa, contact radius = ${(result.hertz.contactRadius_m*1e6).toFixed(1)} μm`);
    fs.writeFileSync(path.join(ROOT, 'bearing.json'), JSON.stringify(result, null, 2));

    // Shigley Ex 11-4 expected ballpark for L10 with combined load ≈ 1000 hours
    // Our P should be > F_r because of axial.
    expect(result.eq.P_kN).toBeGreaterThan(4);
    expect(result.life.L10_hours).toBeGreaterThan(100);
    expect(result.life.L10_hours).toBeLessThan(100000);
    // Hertz: ~1 GPa typical for 200 N on steel ball-race
    expect(result.hertz.p_max_Pa).toBeGreaterThan(1e8);
    expect(result.hertz.p_max_Pa).toBeLessThan(5e9);
  });

  test('Bearing-life scaling: P → 2P cuts life by 2³ = 8 for ball bearings', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { bearingLife } = await import('/src/foundation/Bearings.js');
      const ball_baseline = bearingLife({ C_kN: 30, P_kN: 5, rpm: 1500, type: 'ball' });
      const ball_double = bearingLife({ C_kN: 30, P_kN: 10, rpm: 1500, type: 'ball' });
      const roller_baseline = bearingLife({ C_kN: 30, P_kN: 5, rpm: 1500, type: 'roller' });
      const roller_double = bearingLife({ C_kN: 30, P_kN: 10, rpm: 1500, type: 'roller' });
      return {
        ballRatio: ball_baseline.L10_Mrev / ball_double.L10_Mrev,
        rollerRatio: roller_baseline.L10_Mrev / roller_double.L10_Mrev,
      };
    });
    console.log(`\n=== L10 SCALING ===`);
    console.log(`Ball:   L10(P)/L10(2P) = ${result.ballRatio.toFixed(2)}  (expect 8 = 2³)`);
    console.log(`Roller: L10(P)/L10(2P) = ${result.rollerRatio.toFixed(2)}  (expect 10.08 = 2^(10/3))`);
    expect(result.ballRatio).toBeCloseTo(8, 3);
    expect(result.rollerRatio).toBeCloseTo(Math.pow(2, 10 / 3), 2);
  });

  test('Spur gear AGMA: 17/52 teeth, 6 mm module, 1.5 kW @ 1750 RPM', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { analyzeGearMesh } = await import('/src/foundation/Gears.js');
      // Shigley Example 14-4 pinion: 17 teeth, m=6 mm, F=75 mm,
      // 1.5 kW at 1750 RPM, J=0.31 (17-tooth pinion), I=0.10
      const pinion = analyzeGearMesh({
        teeth: 17, module_mm: 6, faceWidth_mm: 75,
        power_W: 1500, rpm: 1750, J: 0.31, I: 0.10,
        allowable_bending_MPa: 250, allowable_contact_MPa: 1100,
      });
      return pinion;
    });
    console.log(`\n=== SPUR PINION 17T m=6mm @ 1750 RPM, 1.5 kW ===`);
    console.log(`Pitch dia = ${result.geometry.pitchDiameter_mm} mm`);
    console.log(`Tangential force = ${result.force.tangentialForce_N.toFixed(1)} N`);
    console.log(`σ_bending = ${result.bending.sigma_bending_MPa.toFixed(1)} MPa (allow 250)`);
    console.log(`σ_contact = ${result.contact.sigma_contact_MPa.toFixed(0)} MPa (allow 1100)`);
    console.log(`SF bending = ${result.safetyFactors.bending.toFixed(2)}, SF contact = ${result.safetyFactors.contact.toFixed(2)}`);
    console.log(`Status: ${result.status}`);
    fs.writeFileSync(path.join(ROOT, 'spur-gear.json'), JSON.stringify(result, null, 2));

    // Pitch diameter exactly N · m = 17 · 6 = 102
    expect(result.geometry.pitchDiameter_mm).toBeCloseTo(102, 6);
    // Tangential force from P = T·ω, T = P/(2πN/60) = 1500/(2π·1750/60) = 8.19 N·m
    // Wt = 2T/d = 2·8.19/0.102 = 160.6 N
    expect(result.force.tangentialForce_N).toBeCloseTo(160.6, 0);
    // Bending stress should be modest (this is a low-power example)
    expect(result.bending.sigma_bending_MPa).toBeLessThan(50);
    expect(result.bending.sigma_bending_MPa).toBeGreaterThan(0);
    expect(result.safetyFactors.bending).toBeGreaterThan(5);
  });

  test('Shaft sizing (Shigley Ex 7-1 class): M=70 N·m, T=45 N·m, AISI 1050 CD', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { deGoodmanDiameter, asmeElliptiCDiameter, staticShaftCheck } = await import('/src/foundation/Shaft.js');
      // Reversed bending M = 70 N·m, steady torque T = 45 N·m.
      // AISI 1050 CD: S_ut = 690 MPa, S_y = 580 MPa.
      // Marin-corrected S_e: assume 0.5 S_ut · 0.8 = 276 MPa (rough)
      const goodman = deGoodmanDiameter({
        M_Nm: 70, T_Nm: 45,
        Sut_MPa: 690, Se_MPa: 276,
        n: 1.5, Kf: 1.6, Kfs: 1.3,
      });
      const asme = asmeElliptiCDiameter({
        M_Nm: 70, T_Nm: 45,
        Sy_MPa: 580, Se_MPa: 276,
        n: 1.5, Kf: 1.6, Kfs: 1.3,
      });
      // Static check at d = 22 mm
      const stat = staticShaftCheck({
        M_Nm: 70, T_Nm: 45, d_mm: 22, Sy_MPa: 580,
      });
      return { goodman, asme, stat };
    });
    console.log(`\n=== SHAFT SIZING (Shigley Ex 7-1 class) ===`);
    console.log(`DE-Goodman d_min = ${result.goodman.diameter_mm.toFixed(2)} mm`);
    console.log(`ASME elliptic d_min = ${result.asme.diameter_mm.toFixed(2)} mm  (less conservative for ductile)`);
    console.log(`At d = 22 mm: σ_b = ${result.stat.sigma_bending_MPa.toFixed(1)} MPa, τ_t = ${result.stat.tau_torsion_MPa.toFixed(1)} MPa`);
    console.log(`τ_max = ${result.stat.tau_max_MPa.toFixed(1)}, σ_VM = ${result.stat.sigma_von_mises_MPa.toFixed(1)} MPa`);
    console.log(`SF max-shear = ${result.stat.SF_max_shear.toFixed(2)}, SF VM = ${result.stat.SF_von_mises.toFixed(2)}`);
    fs.writeFileSync(path.join(ROOT, 'shaft.json'), JSON.stringify(result, null, 2));

    // Shigley Example 7-1 expects diameter ~22-24 mm with these inputs
    expect(result.goodman.diameter_mm).toBeGreaterThan(15);
    expect(result.goodman.diameter_mm).toBeLessThan(35);
    // ASME elliptic is typically smaller (less conservative) than Goodman
    expect(result.asme.diameter_mm).toBeLessThan(result.goodman.diameter_mm * 1.1);
    // Static check at 22 mm: σ_b ≈ 32·70 / (π·0.022³) / 1e6 = 67.0 MPa
    expect(result.stat.sigma_bending_MPa).toBeCloseTo(67.0, 0);
  });
});
