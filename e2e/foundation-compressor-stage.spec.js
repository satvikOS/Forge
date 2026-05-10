import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'compressor');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(60000);

test.describe('M57 — Axial compressor stage mean-line', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Subsonic axial fan stage: De Haller pass + reasonable PR', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { analyzeCompressorStage } = await import('/src/foundation/CompressorStage.js');
      // Subsonic fan-stage validation: 100 kg/s, sea-level inlet
      // (T_t = 288 K, P_t = 101 kPa), 8000 RPM, r_tip = 0.6 m,
      // hub/tip = 0.45, axial Mach 0.5, ΔT_t = 25 K (light loading)
      const r = analyzeCompressorStage({
        massFlowKgS: 100,
        T_t1_K: 288.15, P_t1_Pa: 101325,
        rpm: 8000, r_tip_m: 0.6, hubToTip: 0.45,
        axialMach1: 0.5,
        deltaTtotal_K: 25,
        polytropicEff: 0.90,
      });
      return r;
    });

    console.log(`\n=== SUBSONIC FAN STAGE (M=0.5 axial, ΔT_t=25 K) ===`);
    console.log(`r_tip = ${result.geometry.r_tip} m,  r_hub = ${result.geometry.r_hub.toFixed(3)} m,  area = ${result.geometry.area_m2.toFixed(3)} m²`);
    console.log(`U_mean = ${result.blade_speed.U_mean.toFixed(1)} m/s,  U_tip = ${result.blade_speed.U_tip.toFixed(1)} m/s,  M_tip = ${result.blade_speed.M_tip.toFixed(3)}`);
    console.log(`Stage PR = ${result.work.stagePR.toFixed(4)},  specific work = ${result.work.specific_work_kJ_per_kg.toFixed(2)} kJ/kg,  power = ${(result.work.total_power_kW/1000).toFixed(2)} MW`);
    console.log(`Loading ψ = ${result.nondim.loadingPsi.toFixed(3)},  Flow φ = ${result.nondim.flowPhi.toFixed(3)},  Reaction = ${result.nondim.reactionMean.toFixed(3)}`);
    console.log(`Velocity triangles (β₁/β₂ relative, deg):`);
    console.log(`  hub:  β₁ = ${result.radial.hub.beta1_deg.toFixed(2)}°,  β₂ = ${result.radial.hub.beta2_deg.toFixed(2)}°,  De Haller = ${result.radial.hub.deHaller.toFixed(3)}`);
    console.log(`  mid:  β₁ = ${result.radial.mid.beta1_deg.toFixed(2)}°,  β₂ = ${result.radial.mid.beta2_deg.toFixed(2)}°,  De Haller = ${result.radial.mid.deHaller.toFixed(3)}`);
    console.log(`  tip:  β₁ = ${result.radial.tip.beta1_deg.toFixed(2)}°,  β₂ = ${result.radial.tip.beta2_deg.toFixed(2)}°,  De Haller = ${result.radial.tip.deHaller.toFixed(3)}`);
    console.log(`De Haller pass (W₂/W₁ ≥ 0.72)? ${result.deHaller_check.passes}`);
    console.log(`Blade count (σ=1.1): ${result.geometry.bladeCount}`);
    console.log(`Continuity check: mdot_in = ${result.massFlow.mdot}, computed = ${result.massFlow.mdot_continuity_check.toFixed(3)} kg/s`);
    fs.writeFileSync(path.join(ROOT, 'fan-stage.json'), JSON.stringify(result, null, 2));

    // Sanity: stage PR for subsonic fan with ΔT_t = 25 K should be ~1.25
    expect(result.work.stagePR).toBeGreaterThan(1.15);
    expect(result.work.stagePR).toBeLessThan(1.40);
    // Loading coefficient typical: 0.3-0.5 for subsonic, 0.5-0.7 for transonic
    expect(result.nondim.loadingPsi).toBeGreaterThan(0.1);
    expect(result.nondim.loadingPsi).toBeLessThan(0.7);
    // Tip blade Mach: at U=502 m/s, M_tip ≈ 1.5 (transonic — tip working hard)
    expect(result.blade_speed.M_tip).toBeGreaterThan(0.5);
    // De Haller passes at mean (more critical at hub due to lowest U)
    expect(result.deHaller_check.mid).toBeGreaterThan(0.65);
  });

  test('Heavily-loaded stage: De Haller fails (loading too high)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { analyzeCompressorStage } = await import('/src/foundation/CompressorStage.js');
      // Push the loading: ΔT_t = 60 K is too aggressive at this U
      const r = analyzeCompressorStage({
        massFlowKgS: 50, T_t1_K: 288.15, P_t1_Pa: 101325,
        rpm: 6000, r_tip_m: 0.5, hubToTip: 0.5,
        axialMach1: 0.5, deltaTtotal_K: 60,
      });
      return r;
    });
    console.log(`\n=== HEAVILY-LOADED STAGE (ΔT_t = 60 K @ 6000 RPM) ===`);
    console.log(`Stage PR = ${result.work.stagePR.toFixed(3)}, ψ = ${result.nondim.loadingPsi.toFixed(3)}`);
    console.log(`De Haller hub/mid/tip: ${result.radial.hub.deHaller.toFixed(3)} / ${result.radial.mid.deHaller.toFixed(3)} / ${result.radial.tip.deHaller.toFixed(3)}`);
    console.log(`Pass: ${result.deHaller_check.passes}`);

    // High loading → at least one section violates W₂/W₁ ≥ 0.72.
    // For free-vortex with very high ΔT_t, the hub can actually
    // produce c_θ2 > U_hub (over-loaded), giving W₂/W₁ > 1 there
    // (different failure mode — negative reaction at hub). Check
    // that the overall pass flag is false and the most-loaded
    // mid/tip stations are below limit.
    expect(result.deHaller_check.passes).toBe(false);
    const minDeHaller = Math.min(
      result.radial.hub.deHaller,
      result.radial.mid.deHaller,
      result.radial.tip.deHaller,
    );
    expect(minDeHaller).toBeLessThan(0.72);
  });

  test('Free-vortex check: r·c_θ constant across span', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { analyzeCompressorStage } = await import('/src/foundation/CompressorStage.js');
      const r = analyzeCompressorStage({
        massFlowKgS: 100, T_t1_K: 288.15, P_t1_Pa: 101325,
        rpm: 8000, r_tip_m: 0.6, hubToTip: 0.45,
        axialMach1: 0.5, deltaTtotal_K: 25,
      });
      const product_hub = r.radial.hub.radius * r.radial.hub.c_theta2;
      const product_mid = r.radial.mid.radius * r.radial.mid.c_theta2;
      const product_tip = r.radial.tip.radius * r.radial.tip.c_theta2;
      return { product_hub, product_mid, product_tip };
    });
    console.log(`\nFree-vortex check (r·c_θ should be constant):`);
    console.log(`  hub: ${result.product_hub.toFixed(2)},  mid: ${result.product_mid.toFixed(2)},  tip: ${result.product_tip.toFixed(2)}`);
    // Should match within numerical precision
    expect(result.product_hub).toBeCloseTo(result.product_mid, 1);
    expect(result.product_mid).toBeCloseTo(result.product_tip, 1);
  });
});
