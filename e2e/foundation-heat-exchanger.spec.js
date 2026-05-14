import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'heat-exchanger');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.describe('M69 — Heat exchanger (effectiveness-NTU)', () => {
  test.describe.configure({ timeout: 60000 });
  test.beforeAll(() => ensure(ROOT));

  test('Counter-flow oil cooler (Incropera Ex 11.3)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { solveHeatExchanger, sizeHeatExchanger, effectiveness } = await import('/src/foundation/HeatExchanger.js');
      // Oil 0.1 kg/s, cp=2131 J/kgK, T_h_in=100°C
      // Water 0.2 kg/s, cp=4178 J/kgK, T_c_in=30°C
      // UA = 100 W/K
      const counter = solveHeatExchanger({
        type: 'counter',
        mdot_hot_kgs: 0.1, cp_hot_J_kgK: 2131, T_hot_in_K: 373.15,
        mdot_cold_kgs: 0.2, cp_cold_J_kgK: 4178, T_cold_in_K: 303.15,
        UA_W_per_K: 100,
      });
      const parallel = solveHeatExchanger({
        type: 'parallel',
        mdot_hot_kgs: 0.1, cp_hot_J_kgK: 2131, T_hot_in_K: 373.15,
        mdot_cold_kgs: 0.2, cp_cold_J_kgK: 4178, T_cold_in_K: 303.15,
        UA_W_per_K: 100,
      });
      // Limiting cases
      const eps_inf = effectiveness('counter', 1000, 0.5);   // NTU→∞ → ε→1
      const eps_zero = effectiveness('parallel', 0.001, 0.5); // NTU→0 → ε→0
      // Cr = 1 counter special case: ε = NTU/(1+NTU)
      const eps_balanced = effectiveness('counter', 4, 1);
      return { counter, parallel, eps_inf, eps_zero, eps_balanced };
    });

    console.log(`\n=== COUNTER-FLOW OIL COOLER ===`);
    console.log(`Ch = ${result.counter.capacityRates.Ch_W_per_K.toFixed(1)},  Cc = ${result.counter.capacityRates.Cc_W_per_K.toFixed(1)},  Cr = ${result.counter.capacityRates.Cr.toFixed(3)}`);
    console.log(`NTU = ${result.counter.NTU.toFixed(3)},  ε_counter = ${result.counter.effectiveness.toFixed(4)},  ε_parallel = ${result.parallel.effectiveness.toFixed(4)}`);
    console.log(`q_counter = ${result.counter.q_W.toFixed(0)} W,  q_parallel = ${result.parallel.q_W.toFixed(0)} W`);
    console.log(`T_h_out (counter) = ${(result.counter.T_hot_out_K-273.15).toFixed(1)} °C, T_c_out = ${(result.counter.T_cold_out_K-273.15).toFixed(1)} °C`);
    console.log(`Limits: ε(NTU=∞) = ${result.eps_inf.toFixed(4)}  (expect 1.0)`);
    console.log(`        ε(NTU≈0) = ${result.eps_zero.toFixed(4)}  (expect 0.0)`);
    console.log(`Cr=1 special: ε(NTU=4) = ${result.eps_balanced.toFixed(4)}  (expect 4/5=0.800 exact)`);
    fs.writeFileSync(path.join(ROOT, 'oil-cooler.json'), JSON.stringify(result, null, 2));

    // Counter-flow always >= parallel-flow at same NTU + Cr
    expect(result.counter.effectiveness).toBeGreaterThan(result.parallel.effectiveness);
    // NTU = UA / Cmin = 100 / 213.1 = 0.469
    expect(result.counter.NTU).toBeCloseTo(100 / 213.1, 2);
    // Energy balance: q = Ch (T_h_in - T_h_out) = Cc (T_c_out - T_c_in)
    const q_check_h = result.counter.capacityRates.Ch_W_per_K *
                      (result.counter.T_hot_in_K - result.counter.T_hot_out_K);
    expect(q_check_h).toBeCloseTo(result.counter.q_W, 1);
    // Special cases
    expect(result.eps_inf).toBeCloseTo(1.0, 4);
    expect(result.eps_zero).toBeLessThan(0.01);
    expect(result.eps_balanced).toBeCloseTo(0.8, 4);   // exactly 4/(1+4)
  });

  test('Cross-flow regenerator: rating mode (find UA for target q)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { sizeHeatExchanger, solveHeatExchanger } = await import('/src/foundation/HeatExchanger.js');
      // Recuperator: hot exhaust 1 kg/s @ 600°C, cp=1100 J/kgK
      //              cold inlet 1 kg/s @ 200°C, cp=1050 J/kgK
      //              target q = 200 kW
      const sized = sizeHeatExchanger({
        type: 'crossUnmixed',
        mdot_hot_kgs: 1.0, cp_hot_J_kgK: 1100, T_hot_in_K: 873.15,
        mdot_cold_kgs: 1.0, cp_cold_J_kgK: 1050, T_cold_in_K: 473.15,
        q_target_W: 200000,
      });
      // Verify by running forward with the computed UA
      const forward = solveHeatExchanger({
        type: 'crossUnmixed',
        mdot_hot_kgs: 1.0, cp_hot_J_kgK: 1100, T_hot_in_K: 873.15,
        mdot_cold_kgs: 1.0, cp_cold_J_kgK: 1050, T_cold_in_K: 473.15,
        UA_W_per_K: sized.UA_W_per_K,
      });
      return { sized, forward };
    });
    console.log(`\n=== CROSS-FLOW RECUPERATOR (200 kW target) ===`);
    console.log(`Required UA = ${result.sized.UA_W_per_K.toFixed(0)} W/K,  NTU = ${result.sized.NTU.toFixed(3)},  ε = ${result.sized.effectiveness.toFixed(4)}`);
    console.log(`Forward check: q = ${(result.forward.q_W/1000).toFixed(1)} kW (target 200)`);
    fs.writeFileSync(path.join(ROOT, 'recuperator.json'), JSON.stringify(result, null, 2));

    expect(result.sized.feasible).toBe(true);
    // Round-trip: forward with sized UA should hit q_target within bisection tolerance
    expect(result.forward.q_W).toBeCloseTo(200000, -3);
  });

  test('Infeasible: target q > q_max', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    const result = await page.evaluate(async () => {
      const { sizeHeatExchanger } = await import('/src/foundation/HeatExchanger.js');
      return sizeHeatExchanger({
        type: 'counter',
        mdot_hot_kgs: 0.1, cp_hot_J_kgK: 2131, T_hot_in_K: 373.15,
        mdot_cold_kgs: 0.2, cp_cold_J_kgK: 4178, T_cold_in_K: 303.15,
        q_target_W: 30000,   // unreasonable
      });
    });
    console.log(`\nInfeasible case: feasible=${result.feasible}, q_max=${result.q_max_W.toFixed(0)} W`);
    expect(result.feasible).toBe(false);
  });
});
