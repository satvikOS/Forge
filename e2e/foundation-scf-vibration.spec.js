import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'scf-vibration');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.describe('M70 SCF + M71 Forced Vibration', () => {
  test.describe.configure({ timeout: 60000 });
  test.beforeAll(() => ensure(ROOT));

  test('Stress concentration: hole-in-plate limits + Peterson tables', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const M = await import('/src/foundation/StressConcentration.js');
      return {
        // Hole in plate (Kirsch infinite-plate limit)
        K_hole_thin: M.plateWithHoleAxial(0.01),     // tiny hole → K ≈ 3
        K_hole_mid: M.plateWithHoleAxial(0.3),
        K_hole_large: M.plateWithHoleAxial(0.7),

        // Shaft shoulder fillet (typical aerospace shaft, D/d=2, r/d=0.1)
        K_shoulder_axial: M.shoulderFilletAxial(2.0, 0.1),
        K_shoulder_bend: M.shoulderFilletBending(2.0, 0.1),
        K_shoulder_torsion: M.shoulderFilletTorsion(2.0, 0.1),

        // Shaft with transverse hole, bending
        K_xhole_05: M.shaftTransverseHoleBending(0.05),
        K_xhole_2: M.shaftTransverseHoleBending(0.20),

        // Keyway
        K_keyway_bend: M.shaftKeywayBending(),
        K_keyway_torsion: M.shaftKeywayTorsion(),

        // Notch sensitivity (Steel 4340, S_ut=1280 MPa, r=2 mm)
        q_2mm: M.notchSensitivity(2, 1280),
        q_05mm: M.notchSensitivity(0.5, 1280),
        K_f: M.fatigueSCF(2.5, M.notchSensitivity(2, 1280)),
      };
    });

    console.log(`\n=== STRESS CONCENTRATION FACTORS ===`);
    console.log(`Hole in plate: d/W=0.01 → K_t=${result.K_hole_thin.toFixed(3)} (Kirsch limit 3.0)`);
    console.log(`              d/W=0.3  → K_t=${result.K_hole_mid.toFixed(3)}`);
    console.log(`              d/W=0.7  → K_t=${result.K_hole_large.toFixed(3)}`);
    console.log(`Shoulder fillet D/d=2, r/d=0.1:`);
    console.log(`  axial:   K_t=${result.K_shoulder_axial.toFixed(3)}`);
    console.log(`  bending: K_t=${result.K_shoulder_bend.toFixed(3)}`);
    console.log(`  torsion: K_t=${result.K_shoulder_torsion.toFixed(3)}`);
    console.log(`Transverse hole in shaft, bending: d/D=0.05 → ${result.K_xhole_05.toFixed(2)}, d/D=0.20 → ${result.K_xhole_2.toFixed(2)}`);
    console.log(`Keyway: bending K_t=${result.K_keyway_bend}, torsion K_t=${result.K_keyway_torsion}`);
    console.log(`Notch sensitivity (4340 S_ut=1280): q(r=2mm)=${result.q_2mm.toFixed(3)}, q(r=0.5mm)=${result.q_05mm.toFixed(3)}`);
    console.log(`K_f = 1 + q(K_t-1) for K_t=2.5, r=2mm: ${result.K_f.toFixed(3)}`);
    fs.writeFileSync(path.join(ROOT, 'scf.json'), JSON.stringify(result, null, 2));

    // Kirsch infinite-plate limit: K_t = 3 (Inglis 1898)
    expect(result.K_hole_thin).toBeCloseTo(3.0, 1);
    // K decreases as d/W increases
    expect(result.K_hole_thin).toBeGreaterThan(result.K_hole_mid);
    expect(result.K_hole_mid).toBeGreaterThan(result.K_hole_large);
    // Shoulder fillet K should be in 1.5–3.0 range for typical r/d
    expect(result.K_shoulder_bend).toBeGreaterThan(1.3);
    expect(result.K_shoulder_bend).toBeLessThan(3.5);
    // Notch sensitivity: smaller r → smaller q (notch is "sharper" → less sensitive)
    expect(result.q_05mm).toBeLessThan(result.q_2mm);
    // K_f always ≤ K_t and ≥ 1
    expect(result.K_f).toBeGreaterThan(1);
    expect(result.K_f).toBeLessThan(2.5);
  });

  test('SDOF forced vibration: peak at r=1, isolation at r>√2', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const V = await import('/src/foundation/ForcedVibration.js');
      return {
        // At resonance r=1: D = 1/(2ζ), phase = 90°
        peak_z01: V.sdofFRF(1, 0.10),
        peak_z05: V.sdofFRF(1, 0.50),
        peak_z001: V.sdofFRF(1, 0.01),  // very lightly damped

        // Quasi-static r → 0: D = 1
        static: V.sdofFRF(0.001, 0.05),

        // Transmissibility at r = √2: exactly 1 for all ζ
        TR_at_sqrt2_z01: V.sdofTransmissibility(Math.sqrt(2), 0.10),
        TR_at_sqrt2_z05: V.sdofTransmissibility(Math.sqrt(2), 0.50),
        TR_at_sqrt2_z001: V.sdofTransmissibility(Math.sqrt(2), 0.01),

        // Above r = √2: isolation
        TR_at_r3_z01: V.sdofTransmissibility(3, 0.10),

        // Half-power bandwidth
        hp_z005: V.halfPowerFrequencies(100, 0.05),    // fn=100 Hz, ζ=5%

        // Steady-state physical: 5 kg, 1000 N/m, 5 N·s/m, F=10 N @ 5 rad/s
        physical: V.sdofSteadyState({
          F0_N: 10, k_N_per_m: 1000, m_kg: 5, c_Ns_per_m: 5,
          omega_rad_s: 5,
        }),
      };
    });

    console.log(`\n=== SDOF FORCED VIBRATION ===`);
    console.log(`Resonance D=1/(2ζ):`);
    console.log(`  ζ=0.01: D=${result.peak_z001.D.toFixed(2)} (exact 50.0)`);
    console.log(`  ζ=0.10: D=${result.peak_z01.D.toFixed(3)} (exact 5.0)`);
    console.log(`  ζ=0.50: D=${result.peak_z05.D.toFixed(3)} (exact 1.0)`);
    console.log(`Static (r→0): D=${result.static.D.toFixed(4)} (exact 1.0)`);
    console.log(`Transmissibility @ r=√2: ζ=0.01→${result.TR_at_sqrt2_z001.toFixed(4)}, ζ=0.10→${result.TR_at_sqrt2_z01.toFixed(4)}, ζ=0.50→${result.TR_at_sqrt2_z05.toFixed(4)}`);
    console.log(`TR at r=3, ζ=0.1: ${result.TR_at_r3_z01.toFixed(4)} (< 1 = isolation)`);
    console.log(`Half-power: fn=100 Hz, ζ=0.05 → f1=${result.hp_z005.f1_Hz.toFixed(2)}, f2=${result.hp_z005.f2_Hz.toFixed(2)} Hz`);
    console.log(`  Δf/(2fn) = ${((result.hp_z005.f2_Hz - result.hp_z005.f1_Hz)/(2*100)).toFixed(4)} → ζ ≈ ${result.hp_z005.zeta_check.toFixed(4)}`);
    console.log(`Physical: F=10 N, X=${(result.physical.X_m*1000).toFixed(3)} mm (static ${(result.physical.X_static_m*1000).toFixed(3)} mm), ζ=${result.physical.zeta.toFixed(3)}, r=${result.physical.r.toFixed(2)}`);
    fs.writeFileSync(path.join(ROOT, 'vibration.json'), JSON.stringify(result, null, 2));

    // Peak magnitude at r=1 is exactly 1/(2ζ)
    expect(result.peak_z01.D).toBeCloseTo(5.0, 6);
    expect(result.peak_z05.D).toBeCloseTo(1.0, 6);
    expect(result.peak_z001.D).toBeCloseTo(50.0, 4);
    // Phase at resonance = 90°
    expect(result.peak_z01.phase_deg).toBeCloseTo(90.0, 4);
    // Static (r→0): D → 1
    expect(result.static.D).toBeCloseTo(1.0, 3);
    // Transmissibility @ r=√2 is EXACTLY 1 regardless of ζ
    expect(result.TR_at_sqrt2_z01).toBeCloseTo(1.0, 6);
    expect(result.TR_at_sqrt2_z05).toBeCloseTo(1.0, 6);
    expect(result.TR_at_sqrt2_z001).toBeCloseTo(1.0, 6);
    // Above r=√2: isolation (T_R < 1)
    expect(result.TR_at_r3_z01).toBeLessThan(1);
    // Half-power back-out: should recover the input ζ
    expect(result.hp_z005.zeta_check).toBeCloseTo(0.05, 3);
  });
});
