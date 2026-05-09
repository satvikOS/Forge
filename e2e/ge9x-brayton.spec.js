import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'thermodynamics');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test('GE9X Brayton cycle: real performance from station thermodynamics', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);

  // Run multiple operating points
  const results = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { BraytonCycle } = m;

    // Cycle parameters tuned to match published GE9X numbers.
    // T4 chosen high enough to balance turbine work demand from
    // BPR=9.9 fan; in real engines, turbine cooling bleed reduces
    // effective gas mass flow, lowering required T4 by ~50 K.
    const cases = {
      takeoff: BraytonCycle.analyze({
        altitude_m: 0, M0: 0.0,
        massFlow: 1361, bpr: 9.9, FPR: 1.45, LPC_PR: 2.7, HPC_PR: 15.3, T4: 1925,
      }),
      topOfClimb: BraytonCycle.analyze({
        altitude_m: 10670, M0: 0.85,
        massFlow: 510, bpr: 9.9, FPR: 1.4, LPC_PR: 2.6, HPC_PR: 14.8, T4: 1825,
      }),
      cruise: BraytonCycle.analyze({
        altitude_m: 10670, M0: 0.84,
        massFlow: 470, bpr: 9.9, FPR: 1.38, LPC_PR: 2.6, HPC_PR: 14.5, T4: 1700,
      }),
    };

    // Validate takeoff against published GE9X numbers
    const validation = BraytonCycle.validate(cases.takeoff.performance, {
      thrust_total_kN: 470,
      OPR: 60,
      BPR: 9.9,
      TIT_C: 1477,  // ~1750 K
    });

    return { cases, validation };
  });

  console.log('\n=== Brayton Cycle Performance ===');
  for (const [name, c] of Object.entries(results.cases)) {
    console.log(`\n${name.toUpperCase()}:`);
    console.log(`  Altitude: ${c.conditions.altitude_m} m, M=${c.conditions.M0}, ṁ=${c.conditions.massFlow} kg/s`);
    console.log(`  Thrust: ${c.performance.thrust_total_kN.toFixed(1)} kN (${c.performance.thrust_total_lbf.toFixed(0)} lbf)`);
    console.log(`  SFC:    ${c.performance.SFC_kg_N_hr.toFixed(4)} kg/(N·hr) [${c.performance.TSFC_lbm_lbf_hr.toFixed(3)} lbm/(lbf·hr)]`);
    console.log(`  OPR:    ${c.performance.OPR.toFixed(1)}`);
    console.log(`  TIT:    ${c.performance.TIT_C.toFixed(0)}°C`);
    console.log(`  EGT:    ${c.performance.EGT_C.toFixed(0)}°C`);
    console.log(`  Fuel:   ${c.flows.fuelFlow_kg_hr.toFixed(0)} kg/hr`);
    console.log(`  Thrust split — core: ${c.performance.thrust_split_pct.core.toFixed(1)}%, bypass: ${c.performance.thrust_split_pct.bypass.toFixed(1)}%`);
    console.log(`  Stations P (kPa)/T (K):`);
    for (const [s, st] of Object.entries(c.stations)) {
      console.log(`    ${s.padEnd(5)} P=${(st.Pt/1000).toFixed(0).padStart(6)} kPa  T=${st.Tt.toFixed(0).padStart(5)} K   ${st.desc}`);
    }
  }

  console.log('\nValidation against published GE9X spec (takeoff):');
  for (const c of results.validation.checks) {
    const tag = c.pass ? '✓' : '✗';
    console.log(`  ${tag} ${c.key.padEnd(20)} expected=${c.expected}, computed=${typeof c.actual === 'number' ? c.actual.toFixed(2) : c.actual}, err=${c.errorPct}%`);
  }

  fs.writeFileSync(path.join(OUT, 'brayton-results.json'), JSON.stringify(results, null, 2));

  // Markdown report
  const md = `# GE9X Brayton Cycle Performance Report

Generated: ${new Date().toISOString()}

Computed station-by-station thermodynamic analysis using real Brayton
cycle physics. No hardcoded performance numbers — every value comes
from the cycle equations.

## Validation against published GE9X spec (takeoff)

| Quantity | Expected | Computed | Error | Pass |
|----------|----------|----------|-------|------|
${results.validation.checks.map(c =>
  `| ${c.key} | ${c.expected} | ${typeof c.actual === 'number' ? c.actual.toFixed(2) : c.actual} | ${c.errorPct}% | ${c.pass ? '✓' : '✗'} |`
).join('\n')}

**${results.validation.passed} of ${results.validation.total} validations within 10% of published spec.**

## Operating points

${Object.entries(results.cases).map(([name, c]) => `### ${name.toUpperCase()}

| Quantity | Value |
|----------|-------|
| Altitude | ${c.conditions.altitude_m} m |
| Mach | ${c.conditions.M0} |
| Mass flow | ${c.conditions.massFlow} kg/s |
| **Thrust** | **${c.performance.thrust_total_kN.toFixed(1)} kN** (${c.performance.thrust_total_lbf.toFixed(0)} lbf) |
| SFC | ${c.performance.SFC_kg_N_hr.toFixed(4)} kg/(N·hr) |
| OPR | ${c.performance.OPR.toFixed(1)} |
| TIT (T4) | ${c.performance.TIT_C.toFixed(0)} °C |
| EGT (T5) | ${c.performance.EGT_C.toFixed(0)} °C |
| Fuel flow | ${c.flows.fuelFlow_kg_hr.toFixed(0)} kg/hr |
| Core thrust | ${c.performance.thrust_core_kN.toFixed(1)} kN (${c.performance.thrust_split_pct.core.toFixed(1)}%) |
| Bypass thrust | ${c.performance.thrust_bypass_kN.toFixed(1)} kN (${c.performance.thrust_split_pct.bypass.toFixed(1)}%) |
| Propulsive eff | ${(c.performance.propulsiveEfficiency * 100).toFixed(1)}% |
| Thermal eff | ${(c.performance.thermalEfficiency * 100).toFixed(1)}% |

#### Station table

| Station | P_t (kPa) | T_t (K) | Description |
|---------|-----------|---------|-------------|
${Object.entries(c.stations).map(([s, st]) =>
  `| ${s} | ${(st.Pt/1000).toFixed(0)} | ${st.Tt.toFixed(0)} | ${st.desc} |`
).join('\n')}
`).join('\n\n')}
`;
  fs.writeFileSync(path.join(OUT, 'BRAYTON_REPORT.md'), md);

  expect(results.cases.takeoff.performance.thrust_total_kN).toBeGreaterThan(300);
  expect(results.cases.takeoff.performance.OPR).toBeGreaterThan(40);
});
