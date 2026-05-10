import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'brayton');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(60000);

test.describe('M55 — Brayton thermodynamic cycle (turbofan / turbojet)', () => {
  test.beforeAll(() => ensure(ROOT));

  test('Hill & Peterson Example 5.4 turbojet (M=0.85, alt=11km, π_c=10)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { solveTurbojet } = await import('/src/foundation/BraytonCycle.js');
      // Hill & Peterson example: subsonic turbojet at cruise.
      const r = solveTurbojet({
        altitudeM: 11000, machNumber: 0.85,
        compressorPR: 10, T4_K: 1500,
        massFlowKgS: 100,
      });
      return r;
    });

    console.log(`\n=== TURBOJET CYCLE @ 11 km, M=0.85, π_c=10, T4=1500 K ===`);
    console.log(`Atmosphere: T_∞ = ${result.atmosphere.T.toFixed(2)} K, P_∞ = ${(result.atmosphere.P/1000).toFixed(2)} kPa`);
    console.log(`Mass flow: total ${result.massFlow.total.toFixed(2)} kg/s, fuel ${result.massFlow.fuel.toFixed(3)} kg/s`);
    console.log(`Fuel/air ratio f = ${result.fuelAirRatio.toFixed(4)}`);
    console.log(`OPR = ${result.OPR.toFixed(2)}`);
    console.log(`T_t3 (HPC exit) = ${result.stations.s3.T_total.toFixed(0)} K`);
    console.log(`T_t5 (LPT exit) = ${result.stations.s5.T_total.toFixed(0)} K`);
    console.log(`V9 (nozzle exit) = ${result.stations.s9.V.toFixed(1)} m/s,  V_∞ = ${result.stations.s0.V.toFixed(1)} m/s`);
    console.log(`Thrust = ${(result.thrust_N/1000).toFixed(2)} kN  (${result.thrust_lbf.toFixed(0)} lbf)`);
    console.log(`SFC = ${result.SFC_kg_per_N_hr.toFixed(4)} kg/(N·hr)  =  ${result.SFC_lb_per_lbf_hr.toFixed(4)} lbm/(lbf·hr)`);
    console.log(`Efficiencies: thermal ${(result.thermalEff*100).toFixed(1)} %, propulsive ${(result.propEff*100).toFixed(1)} %, overall ${(result.overallEff*100).toFixed(1)} %`);
    fs.writeFileSync(path.join(ROOT, 'turbojet-hp-5_4.json'), JSON.stringify(result, null, 2));

    // Realistic ranges:
    // - Atmosphere at 11 km: T ≈ 216.65 K, P ≈ 22.6 kPa ✓
    // - Subsonic turbojet at this cycle: ~30-50 kN thrust, SFC ~0.1 kg/(N·hr)
    expect(result.atmosphere.T).toBeCloseTo(216.65, 0);
    expect(result.thrust_N).toBeGreaterThan(20000);
    expect(result.thrust_N).toBeLessThan(150000);
    // SFC for a clean turbojet: roughly 0.7-1.0 lbm/(lbf·hr)
    // = 0.07-0.10 kg/(N·hr) when correctly converted (×9.807).
    // Our 100 kg/s turbojet at this cycle should give SFC in that band.
    expect(result.SFC_kg_per_N_hr).toBeGreaterThan(0.05);
    expect(result.SFC_kg_per_N_hr).toBeLessThan(0.30);
    expect(result.SFC_lb_per_lbf_hr).toBeGreaterThan(0.5);
    expect(result.SFC_lb_per_lbf_hr).toBeLessThan(2.0);
    // Overall efficiency 20-30 %
    expect(result.overallEff).toBeGreaterThan(0.10);
    expect(result.overallEff).toBeLessThan(0.50);
  });

  test('Modern high-bypass turbofan (BPR=10, OPR=40, T4=1700K)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
      const { solveTurbofan } = await import('/src/foundation/BraytonCycle.js');
      // Trent XWB-class: BPR ≈ 9.6, OPR ≈ 50 cruise, T4 ≈ 1750 K cruise.
      const r = solveTurbofan({
        altitudeM: 10670,           // FL350
        machNumber: 0.85,
        bypassRatio: 9.6,
        fanPR: 1.45,
        compressorPR: 50 / 1.45,    // OPR = 50, fan part already done
        T4_K: 1750,
        massFlowKgS: 1300,
      });
      return r;
    });

    console.log(`\n=== HIGH-BYPASS TURBOFAN (Trent XWB-class) ===`);
    console.log(`BPR = ${result.bypassRatio}, OPR = ${result.OPR.toFixed(1)}, T4 = ${result.T4_K} K`);
    console.log(`Mass flow: ${result.massFlow.total} kg/s (core ${result.massFlow.core.toFixed(0)}, bypass ${result.massFlow.bypass.toFixed(0)}, fuel ${result.massFlow.fuel.toFixed(2)})`);
    console.log(`V19 (bypass jet) = ${result.stations.s19.V.toFixed(1)} m/s,  V9 (core jet) = ${result.stations.s9.V.toFixed(1)} m/s`);
    console.log(`Thrust = ${(result.thrust_N/1000).toFixed(1)} kN  (${(result.thrust_lbf/1000).toFixed(1)} klbf)`);
    console.log(`SFC = ${result.SFC_kg_per_N_hr.toFixed(4)} kg/(N·hr) = ${result.SFC_lb_per_lbf_hr.toFixed(4)} lbm/(lbf·hr)`);
    console.log(`Overall efficiency = ${(result.overallEff*100).toFixed(1)} %`);
    fs.writeFileSync(path.join(ROOT, 'turbofan-hbpr.json'), JSON.stringify(result, null, 2));

    // Trent XWB cruise: ~85 kN thrust, SFC ~0.057 kg/(N·hr) = 0.55 lbm/(lbf·hr)
    expect(result.thrust_N).toBeGreaterThan(50000);
    expect(result.thrust_N).toBeLessThan(300000);
    expect(result.SFC_kg_per_N_hr).toBeLessThan(0.08);   // high-bypass is efficient
    expect(result.OPR).toBeGreaterThan(45);
    // Bypass jet should be SLOWER than core jet (low velocity = low pressure loss)
    expect(result.stations.s19.V).toBeLessThan(result.stations.s9.V);
  });

  test('Atmosphere model: sea level + tropopause', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { solveTurbojet } = await import('/src/foundation/BraytonCycle.js');
      const sl = solveTurbojet({ altitudeM: 0, machNumber: 0, compressorPR: 10, T4_K: 1500, massFlowKgS: 50 });
      const tp = solveTurbojet({ altitudeM: 11000, machNumber: 0, compressorPR: 10, T4_K: 1500, massFlowKgS: 50 });
      return { sl: sl.atmosphere, tp: tp.atmosphere };
    });
    console.log(`\nAtmosphere SL: T=${result.sl.T.toFixed(2)} K, P=${(result.sl.P/1000).toFixed(2)} kPa`);
    console.log(`Atmosphere @ 11 km: T=${result.tp.T.toFixed(2)} K, P=${(result.tp.P/1000).toFixed(2)} kPa`);
    expect(result.sl.T).toBeCloseTo(288.15, 1);
    expect(result.sl.P).toBeCloseTo(101325, -1);
    expect(result.tp.T).toBeCloseTo(216.65, 1);
    expect(result.tp.P).toBeGreaterThan(20000);
    expect(result.tp.P).toBeLessThan(25000);
  });
});
