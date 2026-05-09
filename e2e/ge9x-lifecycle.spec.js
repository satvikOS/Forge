import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'lifecycle');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(600000);

test('GE9X lifecycle: cost + sustainability across all 29K components', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const { PartIDRegistry, CostingEngine, Sustainability } = m;
    const GE9XBuilder = builderMod.default;

    PartIDRegistry.reset();
    const ge9x = GE9XBuilder.build();
    const entries = PartIDRegistry.all();

    // Per-part mass estimates by category — realistic kg per part
    const massByCat = {
      FAN: { BLD: 11, DSK: 60, DVT: 0.5, RNG: 4, CSG: 180, OGV: 0.6, STR: 1.8, ABR: 1.0, PIN: 0.05 },
      LPC: { BLD: 0.4, DSK: 25, STA: 0.2, CSG: 90 },
      HPC: { BLD: 0.18, DSK: 18, STA: 0.12, CSG: 22 },
      COMB: { CSG: 35, LIN: 12, DOM: 6, SWR: 0.2, INJ: 0.05, IGN: 0.4, CHL: 0.0001 },
      HPT: { BLD: 0.7, DSK: 40, NGV: 0.4, FIR: 0.05, CSG: 28, CHL: 0.0001 },
      LPT: { BLD: 0.45, DSK: 22, STA: 0.25, CSG: 30 },
      BRG: { HSG: 6, RAC: 1.6, BAL: 0.04, ROL: 0.05, SEL: 0.15 },
      SHFT: { LP: 200, HP: 90, CPL: 4 },
      AGB: { HSG: 80, DRV: 3, GER: 1.2, PAD: 0.4 },
      FUEL: { COM: 8, TUB: 0.15 },
      OIL: { COM: 6, TUB: 0.10 },
      AIR: { VLV: 1.4, TUB: 0.20 },
      IGN: { EXC: 1.5, LED: 0.25 },
      FADEC: { CTL: 4, SNS: 0.15 },
      ELEC: { HRN: 0.7, SPL: 0.05, CNN: 0.07 },
      HYD: { LIN: 0.18 },
      NAC: { COW: 25, FCW: 30 },
      MNT: { FWD: 8, AFT: 12, STR: 2.0, TAG: 0.005 },
      TRV: { CAS: 4, ACT: 1.4 },
      EXH: { NOZ: 90, CHV: 0.7, TLC: 35 },
      FAS: { BLT: 0.012, WSH: 0.001, NUT: 0.005 },
      STR: { BKT: 0.10 },
      PIP: { FTG: 0.040 },
      DRN: { TUB: 0.030, VNT: 0.040 },
      FIRE: { DET: 0.025, BTL: 4.5 },
      INLE: { SPN: 12, CAP: 0.6, BLT: 0.020 },
    };

    function massOf(entry) {
      return massByCat[entry.category]?.[entry.subsystem] ?? 0.1;
    }

    // Aggregate totals by category
    const byCat = {};
    let totalMass = 0;
    let totalCO2 = 0;
    let totalCost = 0;
    let totalEnergy = 0;
    let totalRecyclable = 0;

    const samplePerCat = {};

    for (const e of entries) {
      const massKg = massOf(e);
      if (massKg <= 0) continue;
      totalMass += massKg;

      // Sustainability per part
      let cost = 0, co2 = 0, energy = 0, recyc = 0, score = 0;
      try {
        const sust = Sustainability.analyze({
          massKg,
          material: e.material,
          process: massKg > 5 ? 'cnc_5axis' : 'cnc_3axis',
          transportKm: 500,
          region: 'global_avg',
        });
        co2 = parseFloat(sust.total.co2eKg) || 0;
        energy = parseFloat(sust.total.energyKWh) || 0;
        recyc = parseFloat(sust.recyclability.recyclablePercent) || 0;
        score = parseInt(sust.total.score) || 0;
      } catch (err) {}

      try {
        const costAna = CostingEngine.analyze({
          massKg,
          material: e.material,
          machineTimeMin: Math.max(2, massKg * 8),
          process: massKg > 5 ? 'cnc_5axis' : 'cnc_3axis',
          batchSize: 50,
          marginPercent: 35,
        });
        cost = parseFloat(costAna.perPart.totalCost) || 0;
      } catch (err) {}

      totalCO2 += co2;
      totalCost += cost;
      totalEnergy += energy;
      totalRecyclable += massKg * (recyc / 100);

      if (!byCat[e.category]) byCat[e.category] = { count: 0, mass: 0, cost: 0, co2: 0, energy: 0 };
      byCat[e.category].count++;
      byCat[e.category].mass += massKg;
      byCat[e.category].cost += cost;
      byCat[e.category].co2 += co2;
      byCat[e.category].energy += energy;

      // Save one sample per category
      if (!samplePerCat[e.category]) {
        samplePerCat[e.category] = {
          partID: e.partID, name: e.name, material: e.material,
          massKg, costUSD: cost.toFixed(2), co2Kg: co2.toFixed(3),
          sustainabilityScore: score,
        };
      }
    }

    const recyclablePct = totalMass > 0 ? (totalRecyclable / totalMass) * 100 : 0;

    return {
      totalComponents: entries.length,
      totalMassKg: +totalMass.toFixed(1),
      totalCostUSD: +totalCost.toFixed(0),
      totalCO2Kg: +totalCO2.toFixed(0),
      totalEnergyKWh: +totalEnergy.toFixed(0),
      recyclablePercent: +recyclablePct.toFixed(1),
      byCategory: Object.fromEntries(
        Object.entries(byCat).map(([cat, v]) => [cat, {
          count: v.count, mass: +v.mass.toFixed(1),
          cost: +v.cost.toFixed(0), co2: +v.co2.toFixed(0),
          energy: +v.energy.toFixed(0),
        }])
      ),
      samplePerCat,
    };
  });

  console.log('\n=== GE9X Lifecycle Analysis ===');
  console.log(`Total components: ${result.totalComponents.toLocaleString()}`);
  console.log(`Total mass: ${result.totalMassKg.toLocaleString()} kg (spec ~10,012 kg)`);
  console.log(`Manufacturing cost (per engine, batch 50): $${result.totalCostUSD.toLocaleString()}`);
  console.log(`Cradle-to-gate CO2: ${result.totalCO2Kg.toLocaleString()} kg CO2eq`);
  console.log(`Embodied energy: ${result.totalEnergyKWh.toLocaleString()} kWh`);
  console.log(`Recyclable mass: ${result.recyclablePercent}%`);

  console.log('\nTop 10 categories by cost:');
  const sortedCats = Object.entries(result.byCategory).sort((a, b) => b[1].cost - a[1].cost);
  for (const [cat, v] of sortedCats.slice(0, 10)) {
    console.log(`  ${cat.padEnd(8)} ${v.count.toString().padStart(6)} parts  ${v.mass.toString().padStart(7)} kg  $${v.cost.toLocaleString().padStart(10)}  ${v.co2.toLocaleString()} kg CO2`);
  }

  fs.writeFileSync(path.join(OUT, 'lifecycle-summary.json'), JSON.stringify(result, null, 2));

  // CSV
  const csvLines = ['Category,Count,Mass_kg,Cost_USD,CO2_kg,Energy_kWh'];
  for (const [cat, v] of sortedCats) {
    csvLines.push(`${cat},${v.count},${v.mass},${v.cost},${v.co2},${v.energy}`);
  }
  csvLines.push(`TOTAL,${result.totalComponents},${result.totalMassKg},${result.totalCostUSD},${result.totalCO2Kg},${result.totalEnergyKWh}`);
  fs.writeFileSync(path.join(OUT, 'lifecycle-by-category.csv'), csvLines.join('\n'));

  // Markdown report
  const md = `# GE9X Lifecycle Assessment

Generated: ${new Date().toISOString()}
Engine: GE Aviation GE9X-105B1A

## Summary

| Metric                  | Value                              |
|-------------------------|------------------------------------|
| Total components        | ${result.totalComponents.toLocaleString()} |
| Total mass              | ${result.totalMassKg.toLocaleString()} kg (spec ~10,012 kg) |
| Manufacturing cost      | $${result.totalCostUSD.toLocaleString()} (batch of 50) |
| Cradle-to-gate CO2eq    | ${result.totalCO2Kg.toLocaleString()} kg |
| Embodied energy         | ${result.totalEnergyKWh.toLocaleString()} kWh |
| Recyclable mass         | ${result.recyclablePercent}% |

## By Category

| Category | Parts  | Mass (kg) | Cost (USD) | CO2 (kg) | Energy (kWh) |
|----------|--------|-----------|------------|----------|--------------|
${sortedCats.map(([cat, v]) =>
  `| ${cat.padEnd(8)} | ${v.count.toString().padStart(6)} | ${v.mass.toString().padStart(9)} | $${v.cost.toLocaleString().padStart(10)} | ${v.co2.toLocaleString().padStart(8)} | ${v.energy.toLocaleString().padStart(12)} |`
).join('\n')}
`;
  fs.writeFileSync(path.join(OUT, 'LIFECYCLE_REPORT.md'), md);

  expect(result.totalComponents).toBeGreaterThan(20000);
  expect(result.totalMassKg).toBeGreaterThan(1000);
});
