import { test, expect } from '@playwright/test';
import { planFor, validateAndNormalize, paramSchemasContextBlock } from '../frontend/src/ai/Planner.js';
import { executePlan, validatePlan } from '../frontend/src/ai/PlanExecutor.js';

test.describe('LLM-driven tool params in plans', () => {
  test.describe.configure({ timeout: 300000 });

  test('paramSchemasContextBlock advertises every tool field with units + range', () => {
    const block = paramSchemasContextBlock();
    // Brayton's BPR field, with default and range
    expect(block).toContain('bypassRatio');
    expect(block).toContain('default=9.6');
    expect(block).toMatch(/bypassRatio:.*\[0-18\]/);
    // Combustor field
    expect(block).toContain('T_t4_K');
    expect(block).toMatch(/T_t4_K:.*\(K\)/);
    // Blade Cooling field with units
    expect(block).toContain('T_gas_K');
  });

  test('validateAndNormalize: keeps known params, drops unknown ones with a warning', () => {
    const plan = [
      { tool: 'Brayton Cycle', params: { bypassRatio: 12, T4_K: 1900, mystery: 42 } },
      { tool: 'Combustor',     params: { T_t4_K: 1900 } },
    ];
    const r = validateAndNormalize(plan);
    expect(r.ok).toBe(true);
    expect(r.normalized[0].params).toEqual({ bypassRatio: 12, T4_K: 1900 });
    expect(r.normalized[1].params).toEqual({ T_t4_K: 1900 });
    expect(r.warnings.join(' ')).toContain('mystery');
  });

  test('Mock provider emitting params: planFor passes them through normalized', async () => {
    const mock = {
      label: 'Mock',
      defaultModel: 'm',
      async generate({ system }) {
        // Sanity: the system prompt advertised the param schemas
        expect(system).toContain('bypassRatio');
        return JSON.stringify({
          plan: [
            { tool: 'Brayton Cycle', comment: 'high-BPR cycle', params: { bypassRatio: 12, T4_K: 1900 } },
            { tool: 'Combustor',     comment: 'matched',         params: { T_t4_K: 1900 } },
            { tool: 'Blade Cooling', comment: 'hot section',     params: { T_gas_K: 1900 } },
          ],
        });
      },
    };
    const r = await planFor({
      userPrompt: 'A hot, high-BPR turbofan',
      domain: 'engine',
      providerOverride: mock,
    });
    expect(r.source).toBe('llm');
    expect(r.plan).toHaveLength(3);
    expect(r.plan[0].params).toEqual({ bypassRatio: 12, T4_K: 1900 });
    expect(r.plan[2].params).toEqual({ T_gas_K: 1900 });
  });

  test('Executor honours plan-step params end-to-end', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    const plan = [
      { tool: 'Brayton Cycle', comment: 'high BPR', params: { bypassRatio: 12, T4_K: 1900 } },
      { tool: 'Combustor',     comment: 'matched',  params: { T_t4_K: 1900 } },
      { tool: 'Blade Cooling', comment: 'hot section', params: { T_gas_K: 1900 } },
    ];
    expect(validatePlan(plan).ok).toBe(true);
    const result = await executePlan(page, plan, { dwellMs: 1500 });
    expect(result.ok).toBe(true);
    expect(result.steps.length).toBe(3);

    // Brayton with BPR=12 should show in the cycle output
    const bray = await page.evaluate(() => window.__lastBraytonResult);
    console.log(`\nBrayton: thrust=${(bray.thrust_N/1000).toFixed(1)} kN, BPR=${bray.cycle?.bypassRatio ?? bray.bypassRatio}, T4=${bray.cycle?.T4_K ?? bray.T4_K}`);
    expect(bray.cycle?.bypassRatio ?? bray.bypassRatio).toBeCloseTo(12, 1);

    // Combustor with T_t4=1900 K
    const comb = await page.evaluate(() => window.__lastCombustorResult);
    console.log(`Combustor: T_pz=${comb.primaryZone.flameTempK.toFixed(0)} K, NOx EI=${comb.emissions.EI_NOx_g_per_kgFuel.toFixed(1)} g/kg`);
    expect(comb.geometry.liner_length_m).toBeGreaterThan(0);

    // Blade Cooling with hotter gas
    const blade = await page.evaluate(() => window.__lastBladeCoolingResult);
    const blade_T_metal_C = blade.T_metal_max_K - 273.15;
    console.log(`Blade Cooling: T_metal_max=${blade_T_metal_C.toFixed(0)} °C @ T_gas=1900 K`);
    // T_metal climbs from 745 °C (default T_gas=1750 K) to ~780 °C
    // (override T_gas=1900 K) — 150 K gas rise → ~35 °C metal rise
    // through the cooling resistance network.
    expect(blade_T_metal_C).toBeGreaterThan(770);

    // The __archdiscPlanParams slot should be drained after use
    const leftover = await page.evaluate(() => window.__archdiscPlanParams);
    console.log(`Leftover plan params: ${JSON.stringify(leftover)}`);
    // Either the slot is empty {} or undefined — both mean drained
    expect(leftover && Object.keys(leftover).length ? leftover : null).toBe(null);
  });
});
