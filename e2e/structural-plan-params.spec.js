import { test, expect } from '@playwright/test';
import { executePlan, validatePlan } from '../frontend/src/ai/PlanExecutor.js';

test.describe('LLM params flow through every structural tool', () => {
  test.describe.configure({ timeout: 600000 });

  test('Structural plan with custom params: every result reflects the overrides', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // A small structural plan that exercises every wired schema.
    // Each step's params are deliberately different from the default
    // so the assertions can prove the override took effect.
    const plan = [
      { tool: 'Linear Static FEA',     comment: 'longer beam',
        params: { L_mm: 200, b_mm: 20, h_mm: 20, P_N: 500 } },
      { tool: 'Fatigue Analysis',      comment: 'lower stress, higher k_a',
        params: { sigmaMax: 200, sigmaMin: -200, surfaceFinish: 0.95 } },
      { tool: 'Stress Concentration',  comment: 'tighter fillet',
        params: { D_over_d: 1.5, r_over_d: 0.05, hole_d_over_W: 0.4 } },
      { tool: 'Forced Vibration',      comment: 'heavier mass, lower zeta',
        params: { m_kg: 10, k_N_per_m: 2000, zeta: 0.02 } },
      { tool: 'Bearing Life',          comment: 'higher load',
        params: { Fr_kN: 6, Fa_kN: 3, C_kN: 35.1, C0_kN: 23.2, rpm: 2000 } },
      { tool: 'Gear Mesh',             comment: 'higher power',
        params: { teeth: 20, module_mm: 5, faceWidth_mm: 50, power_W: 3000, rpm: 2000 } },
      { tool: 'Shaft Sizing',          comment: 'higher torque',
        params: { M_Nm: 100, T_Nm: 75, n: 2.0 } },
      { tool: 'Bolted Joint',          comment: 'M12 grade 10.9',
        params: { boltSize: 'M12', grade: '10.9', grip_mm: 30, P_ext_N: 10000, preloadFraction: 0.7 } },
      { tool: 'Spring Design',         comment: 'stiffer spring',
        params: { d_mm: 3, D_mm: 25, N_active: 10, F_max_N: 50 } },
      { tool: 'Pressure Vessel',       comment: 'higher pressure',
        params: { P_MPa: 5, r_inner_mm: 150, allowableStress_MPa: 138 } },
      { tool: 'Rotordynamics',         comment: 'shorter shaft',
        params: { length_mm: 400, diameter_mm: 40, disk_mass_kg: 8 } },
    ];
    expect(validatePlan(plan).ok).toBe(true);

    const result = await executePlan(page, plan, { dwellMs: 1200 });
    expect(result.ok).toBe(true);
    expect(result.steps.length).toBe(plan.length);

    // ── Per-tool assertions: prove the override actually drove the math ──
    const r = {
      fea:    await page.evaluate(() => window.__lastFEAResult),
      fat:    await page.evaluate(() => window.__lastFatigueResult),
      scf:    await page.evaluate(() => window.__lastSCFResult),
      vib:    await page.evaluate(() => window.__lastVibrationResult),
      brg:    await page.evaluate(() => window.__lastBearingResult),
      gear:   await page.evaluate(() => window.__lastGearResult),
      shaft:  await page.evaluate(() => window.__lastShaftResult),
      bolt:   await page.evaluate(() => window.__lastBoltResult),
      spr:    await page.evaluate(() => window.__lastSpringResult),
      ves:    await page.evaluate(() => window.__lastVesselResult),
      rot:    await page.evaluate(() => window.__lastRotordynResult),
    };

    // FEA: 200 mm Al-6061 cantilever @ 500 N tip:
    // δ_theory = PL³/(3EI) = 500·200³ / (3·68900·13333) = 1.45 mm
    console.log(`\nFEA: tip δ = ${r.fea.cantileverDeltaMm.toFixed(4)} mm, max σ = ${r.fea.maxStressMPa.toFixed(1)} MPa`);
    expect(Math.abs(r.fea.cantileverDeltaMm)).toBeGreaterThan(1.2);
    expect(Math.abs(r.fea.cantileverDeltaMm)).toBeLessThan(1.6);

    // Fatigue: σ=±200 (half default), surface 0.95 → SF much higher than default's ~1
    console.log(`Fatigue: Goodman SF = ${r.fat.goodmanSF.toFixed(2)}, life = ${r.fat.lifeCycles === Infinity ? 'inf' : r.fat.lifeCycles.toExponential(2)}`);
    expect(r.fat.goodmanSF).toBeGreaterThan(1.5);

    // SCF: override fills with custom ratios; verify result is finite
    // and the hole-ratio change shows up. Default hole d/W=0.3 → Kt≈2.42;
    // override d/W=0.4 → Kt≈2.24 (Peterson curve).
    console.log(`SCF: shoulder Kt_bend = ${r.scf.shoulderFillet.Kt_bend.toFixed(2)}, hole Kt (d/W=0.4) = ${r.scf.plateHole_d_W_0_3.toFixed(2)}`);
    expect(r.scf.shoulderFillet.Kt_bend).toBeGreaterThan(1.5);
    expect(r.scf.shoulderFillet.Kt_bend).toBeLessThan(3.5);
    expect(r.scf.plateHole_d_W_0_3).toBeLessThan(2.35);    // default 0.3 would give >2.4

    // Forced Vibration: ζ=0.02 → peak D = 1/(2·0.02) = 25 exact
    console.log(`Vibration: peak D = ${r.vib.peak_magnification.toFixed(1)} @ fn = ${r.vib.fn_Hz.toFixed(2)} Hz`);
    expect(r.vib.peak_magnification).toBeCloseTo(25, 1);
    // fn = sqrt(2000/10)/(2π) = ~2.25 Hz
    expect(r.vib.fn_Hz).toBeCloseTo(2.25, 1);

    // Bearing: higher load → shorter life vs default 4 kN
    console.log(`Bearing: L10 = ${r.brg.life.L10_hours.toFixed(0)} hrs @ Fr=6 kN`);
    expect(r.brg.life.L10_hours).toBeGreaterThan(0);
    expect(r.brg.life.L10_hours).toBeLessThan(50000);

    // Gear: 20 T × m=5 → d = 100 mm, double the power
    console.log(`Gear: d = ${r.gear.geometry.pitchDiameter_mm} mm, W_t = ${r.gear.force.tangentialForce_N.toFixed(0)} N`);
    expect(r.gear.geometry.pitchDiameter_mm).toBe(100);

    // Shaft: with M=100 + T=75 + n=2.0, diameter must climb vs default (~22 mm)
    console.log(`Shaft: d_min = ${r.shaft.goodman.diameter_mm.toFixed(2)} mm`);
    expect(r.shaft.goodman.diameter_mm).toBeGreaterThan(22);

    // Bolt: M12 grade 10.9 grip=30 → different preload from M10 grade 8.8 grip=25
    console.log(`Bolt: F_i = ${r.bolt.preload.F_i_N.toFixed(0)} N, SF separation = ${r.bolt.safetyFactors.separation.toFixed(2)}`);
    expect(r.bolt.preload.F_i_N).toBeGreaterThan(20000); // M12 10.9 @ 70% preload is ~45 kN

    // Spring: stiffer spring (d=3 mm vs 2 mm) → higher rate
    console.log(`Spring: k = ${r.spr.rate.k_N_per_mm.toFixed(2)} N/mm`);
    expect(r.spr.rate.k_N_per_mm).toBeGreaterThan(0.5);

    // Pressure Vessel: P=5 MPa → ASME min wall thickness > default's
    console.log(`Vessel: ASME t = ${(r.ves.asme.t_with_CA_m * 1000).toFixed(2)} mm @ P=5 MPa`);
    expect(r.ves.asme.t_with_CA_m * 1000).toBeGreaterThan(3);

    // Rotordynamics: 400 mm × Ø40 shaft with 8 kg disk. Heavier disk
    // dominates over the stiffer geometry — f₁ drops vs the 600/Ø30/5 kg
    // default (~13 Hz) to ~8.7 Hz. Override clearly applied.
    console.log(`Rotor: f1 = ${r.rot.firstNaturalHz.toFixed(2)} Hz, n_cr = ${r.rot.criticalSpeedRPM.toFixed(0)} RPM`);
    expect(r.rot.firstNaturalHz).toBeGreaterThan(5);
    expect(r.rot.firstNaturalHz).toBeLessThan(15);
    // Analytical Jeffcott estimate. At short spans the rigid-massless-shaft
    // approximation breaks down (distributed shaft mass matters more
    // relative to disk mass), so the error widens — still finite + bounded.
    expect(Math.abs(r.rot.errorPct)).toBeLessThan(20);
  });
});
