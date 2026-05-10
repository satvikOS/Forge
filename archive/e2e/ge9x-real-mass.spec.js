import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X', 'lifecycle');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('GE9X real mass: derived from solid.massProperties() per part', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const { PartIDRegistry } = m;
    const GE9XBuilder = builderMod.default;

    // Material density lookup (kg/m³)
    const DENSITY = {
      'Aluminum 6061-T6': 2700,
      'Steel AISI 1020': 7870,
      'Steel AISI 4340': 7850,
      'Stainless Steel 316': 8000,
      'Titanium Ti-6Al-4V': 4430,
      'Copper C11000': 8940,
      'Inconel 718': 8190,
      'Single-Crystal Nickel CMSX-4': 8700,
      'Composite Carbon-Epoxy': 1600,
      'Carbon Fiber Composite': 1600,
      'CMC SiC/SiC': 2700,
      'TBC YSZ': 6000,
      'ABS Plastic': 1040,
      'Nylon 6/6': 1140,
      'Air': 1.225,
    };

    PartIDRegistry.reset();
    const ge9x = GE9XBuilder.build();
    const entries = PartIDRegistry.all();

    let totalMass = 0;
    let totalVol = 0;
    let computed = 0, failed = 0;
    const byCat = {};
    const byMat = {};
    const top10 = [];

    for (const e of entries) {
      const solid = e.partInstance?.solid;
      if (!solid) { failed++; continue; }
      const density = DENSITY[e.material] || 2700;
      try {
        const props = solid.massProperties(density);
        const mass = props.mass || 0;
        const vol = props.volume || 0;
        totalMass += mass;
        totalVol += vol;
        computed++;

        if (!byCat[e.category]) byCat[e.category] = { count: 0, mass: 0, volume: 0 };
        byCat[e.category].count++;
        byCat[e.category].mass += mass;
        byCat[e.category].volume += vol;

        if (!byMat[e.material]) byMat[e.material] = { count: 0, mass: 0 };
        byMat[e.material].count++;
        byMat[e.material].mass += mass;

        top10.push({ partID: e.partID, name: e.name, material: e.material, mass });
      } catch (err) {
        failed++;
      }
    }

    top10.sort((a, b) => b.mass - a.mass);

    return {
      totalComponents: entries.length,
      computed, failed,
      totalMassKg: +totalMass.toFixed(1),
      totalVolM3: +totalVol.toFixed(3),
      specMassKg: 10012,
      ratio: +(totalMass / 10012).toFixed(3),
      byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) =>
        [k, { count: v.count, mass: +v.mass.toFixed(1), volume: +v.volume.toFixed(4) }]
      )),
      byMaterial: Object.fromEntries(Object.entries(byMat).map(([k, v]) =>
        [k, { count: v.count, mass: +v.mass.toFixed(1) }]
      )),
      top10: top10.slice(0, 20).map(t => ({ ...t, mass: +t.mass.toFixed(1) })),
    };
  });

  console.log('\n=== Real Mass from B-Rep Geometry ===');
  console.log(`Computed mass for ${result.computed} of ${result.totalComponents} parts (${result.failed} failed)`);
  console.log(`Total mass: ${result.totalMassKg.toLocaleString()} kg`);
  console.log(`Spec mass: ${result.specMassKg.toLocaleString()} kg`);
  console.log(`Ratio: ${result.ratio}× spec (${(result.ratio * 100).toFixed(0)}%)`);
  console.log(`Total volume: ${result.totalVolM3} m³`);

  console.log('\nBy category (top 10):');
  const sortedCats = Object.entries(result.byCategory).sort((a, b) => b[1].mass - a[1].mass);
  for (const [cat, v] of sortedCats.slice(0, 10)) {
    console.log(`  ${cat.padEnd(8)} ${v.count.toString().padStart(6)} parts  ${v.mass.toString().padStart(9)} kg  ${v.volume} m³`);
  }

  console.log('\nTop 10 heaviest parts:');
  for (const t of result.top10.slice(0, 10)) {
    console.log(`  ${t.partID}  ${t.name.substring(0, 30).padEnd(32)} ${t.mass.toString().padStart(8)} kg  ${t.material}`);
  }

  fs.writeFileSync(path.join(OUT, 'real-mass.json'), JSON.stringify(result, null, 2));

  // Update markdown report
  const md = `# GE9X Real Mass Audit (from B-Rep geometry)

Generated: ${new Date().toISOString()}

## Summary

| Metric | Value |
|--------|-------|
| Components with valid solids | ${result.computed.toLocaleString()} / ${result.totalComponents.toLocaleString()} |
| **Computed total mass** | **${result.totalMassKg.toLocaleString()} kg** |
| Published GE9X dry mass | 10,012 kg |
| Ratio | ${result.ratio}× spec |
| Total volume | ${result.totalVolM3} m³ |

This number comes from \`solid.massProperties(material_density).mass\` for
every registered component, summed. Replaces the previous hardcoded
per-category mass estimates.

## By category

| Category | Count | Mass (kg) | Volume (m³) |
|----------|-------|-----------|-------------|
${sortedCats.map(([cat, v]) =>
  `| ${cat} | ${v.count} | ${v.mass.toLocaleString()} | ${v.volume} |`
).join('\n')}

## By material

| Material | Count | Mass (kg) |
|----------|-------|-----------|
${Object.entries(result.byMaterial).sort((a,b)=>b[1].mass-a[1].mass).map(([mat, v]) =>
  `| ${mat} | ${v.count} | ${v.mass.toLocaleString()} |`
).join('\n')}

## Top 20 heaviest single components

| Part ID | Name | Mass (kg) | Material |
|---------|------|-----------|----------|
${result.top10.map(t =>
  `| ${t.partID} | ${t.name} | ${t.mass} | ${t.material} |`
).join('\n')}
`;
  fs.writeFileSync(path.join(OUT, 'REAL_MASS_REPORT.md'), md);

  expect(result.computed).toBeGreaterThan(20000);
  expect(result.totalMassKg).toBeGreaterThan(0);
});
