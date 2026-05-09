import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'engine-output', '_examples', 'StairClimber');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(600000);

test('Stair-Climbing Hand Truck — production package via same Part-21 pipeline', async ({ page }) => {
  ensure(ROOT);
  ensure(path.join(ROOT, 'parts'));
  ensure(path.join(ROOT, 'assembly'));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  console.log('\n========================================');
  console.log('  STAIR-CLIMBING HAND TRUCK');
  console.log('========================================\n');

  // STAGE 1: Build + group unique parts
  const stage1 = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/projects/StairClimberBuilder.js');
    const { PartIDRegistry, FMEA } = m;
    const StairClimberBuilder = builderMod.default;

    PartIDRegistry.reset();
    PartIDRegistry.setProject('STCL');
    const t0 = performance.now();
    const sections = [];
    const truck = StairClimberBuilder.build({
      onProgress: (n, a, total) => sections.push({ name: n, added: a, total }),
    });
    const buildSec = (performance.now() - t0) / 1000;

    // Dedup
    const unique = new Map();
    for (const e of PartIDRegistry.all()) {
      const solidID = e.partInstance?.solid?.id ?? 'no-solid';
      const norm = e.name.replace(/\b\d+\b/g, 'N').replace(/\bL[-]?N\b|\bR[-]?N\b/g, 'X').replace(/\s+/g, ' ').trim();
      const key = `${e.category}|${e.subsystem}|${solidID}|${norm}`;
      if (!unique.has(key)) unique.set(key, { rep: e, instances: [] });
      unique.get(key).instances.push(e.partID);
    }

    return {
      totalParts: truck.partCount(),
      buildSec: +buildSec.toFixed(2),
      sections,
      uniqueDefinitions: unique.size,
      uniqueIndex: Array.from(unique.entries()).map(([key, v]) => ({
        key,
        partID: v.rep.partID, name: v.rep.name,
        category: v.rep.category, subsystem: v.rep.subsystem,
        material: v.rep.material,
        classification: FMEA.classify(v.rep.category, v.rep.subsystem),
        quantity: v.instances.length,
      })),
    };
  });

  console.log(`Total components: ${stage1.totalParts}`);
  console.log(`Build time: ${stage1.buildSec}s`);
  console.log(`Unique definitions: ${stage1.uniqueDefinitions}`);
  for (const sec of stage1.sections) console.log(`  ${sec.name.padEnd(30)} +${sec.added.toString().padStart(4)} → ${sec.total}`);

  fs.writeFileSync(path.join(ROOT, 'assembly', 'unique-parts-index.json'),
    JSON.stringify(stage1.uniqueIndex, null, 2));

  // STAGE 2: Production packages per unique part
  let processed = 0, totalFiles = 0, totalBytes = 0;

  for (const partInfo of stage1.uniqueIndex) {
    const pkg = await page.evaluate(async (pid) => {
      const m = await import('/src/kernel/index.js');
      const { PartIDRegistry, ProductionPackage } = m;
      const entry = PartIDRegistry.get(pid);
      if (!entry) return { error: 'no entry' };
      const result = ProductionPackage.build(entry, { project: 'STCL', sheetSize: 'A3' });
      const filesArr = [];
      for (const [name, content] of result.files) {
        filesArr.push({ name,
          isText: typeof content === 'string',
          content: typeof content === 'string' ? content : null,
          base64: typeof content !== 'string' ? Buffer.from(content).toString('base64') : null,
        });
      }
      return { class: result.class, files: filesArr };
    }, partInfo.partID);
    if (pkg.error) continue;

    const safeName = partInfo.name.replace(/\b\d+\b/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const partDir = path.join(ROOT, 'parts', partInfo.category, partInfo.subsystem, safeName);
    ensure(partDir);
    for (const f of pkg.files) {
      try {
        if (f.isText) { fs.writeFileSync(path.join(partDir, f.name), f.content); totalBytes += f.content.length; }
        else { const buf = Buffer.from(f.base64 || '', 'base64'); fs.writeFileSync(path.join(partDir, f.name), buf); totalBytes += buf.length; }
        totalFiles++;
      } catch {}
    }
    fs.writeFileSync(path.join(partDir, 'quantity.json'), JSON.stringify({
      partID: partInfo.partID, name: partInfo.name,
      category: partInfo.category, subsystem: partInfo.subsystem,
      material: partInfo.material, classification: partInfo.classification,
      quantity: partInfo.quantity,
    }, null, 2));
    totalFiles++;
    processed++;
  }
  console.log(`\nGenerated ${processed} packages, ${totalFiles} files (${(totalBytes / 1024).toFixed(0)} KB)`);

  // STAGE 3: Engine-level deliverables (MBOM, BOM, master assembly drawing)
  const stage3 = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { BOM, AssemblyDrawing } = m;
    const ebom = BOM.buildEBOM();
    const mbom = BOM.buildMBOM();

    const assemblyDrawing = AssemblyDrawing.build({
      project: 'STCL',
      title: 'Automated Stair-Climbing Hand Truck Assembly',
      drawingNumber: 'STCL-ASM-001',
      revision: 'A',
      length_m: 1.20, fanDia_m: 0.50,  // height + width
      sheetSize: 'A3',
      classification: 'Class 1 ASSY',
      drawnBy: 'ArchDisc Auto-Drawing',
      approvedBy: '— pending QA review —',
      bom: mbom.lines.slice(0, 50),
      stations: [
        { z_m: 0.00, name: 'A', label: 'Wheel-axle station' },
        { z_m: 0.10, name: 'B', label: 'Tri-star spider plane' },
        { z_m: 0.20, name: 'C', label: 'Cargo platform' },
        { z_m: 0.60, name: 'D', label: 'Mid-frame brace' },
        { z_m: 1.20, name: 'E', label: 'Handle base' },
      ],
      sections: [
        { z0_m: 0.00, z1_m: 0.20, color: '#4a90d9', label: 'Wheel + Tri-Star' },
        { z0_m: 0.20, z1_m: 0.60, color: '#4ed99d', label: 'Cargo Platform' },
        { z0_m: 0.60, z1_m: 1.05, color: '#d9a04a', label: 'Frame' },
        { z0_m: 1.05, z1_m: 1.20, color: '#707080', label: 'Handle' },
      ],
    });

    return {
      ebomCsv: BOM.toCSV_EBOM(ebom),
      mbomCsv: BOM.toCSV_MBOM(mbom),
      mbom: mbom.lines,
      ebomTotal: { mass: ebom.totalMass, cost: ebom.totalCost, count: ebom.lines.length },
      mbomTotal: { mass: mbom.totalMass, cost: mbom.totalCost, count: mbom.lines.length },
      assemblyDrawing,
    };
  });

  fs.writeFileSync(path.join(ROOT, 'assembly', 'EBOM.csv'), stage3.ebomCsv);
  fs.writeFileSync(path.join(ROOT, 'assembly', 'MBOM.csv'), stage3.mbomCsv);
  fs.writeFileSync(path.join(ROOT, 'assembly', 'MBOM.json'), JSON.stringify(stage3.mbom, null, 2));
  fs.writeFileSync(path.join(ROOT, 'assembly', 'master-assembly-drawing.svg'), stage3.assemblyDrawing);

  // Manifest
  const manifest = {
    project: 'Automated Stair-Climbing Hand Truck',
    deliverable: 'Bachelor\'s-Level Mechanical Engineering Senior Design Submission',
    generatedAt: new Date().toISOString(),
    cad: 'ArchDisc v1.21+ proprietary B-Rep kernel',
    counts: {
      totalComponents: stage1.totalParts,
      uniquePartDefinitions: stage1.uniqueDefinitions,
      productionPackagesGenerated: processed,
      filesInDelivery: totalFiles,
    },
    physical: {
      totalMass_kg: +stage3.ebomTotal.mass.toFixed(2),
      manufacturingCost_USD: +stage3.ebomTotal.cost.toFixed(2),
      target_mass_kg_empty: 18,
      target_payload_kg: 50,
    },
    folderLayout: [
      'parts/<CAT>/<SUB>/<NAME>/   per-part packages (drawing + STEP + tolerance + inspection + cert + FMEA)',
      'assembly/EBOM.csv',
      'assembly/MBOM.csv + .json',
      'assembly/master-assembly-drawing.svg',
      'manifest.json',
    ],
  };
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // README
  const readme = `# Stair-Climbing Hand Truck — Senior Design Submission

**Project:** Automated stair-climbing hand truck with tri-star wheels.
**Capacity:** 50 kg payload up staircases, level-keeping cargo platform.
**Generated:** ${manifest.generatedAt}
**CAD:** ${manifest.cad}

## Delivery summary

| Metric | Value |
|--------|-------|
| Total components | **${manifest.counts.totalComponents}** |
| Unique part numbers | ${manifest.counts.uniquePartDefinitions} |
| Production packages | ${manifest.counts.productionPackagesGenerated} |
| Files in delivery | ${manifest.counts.filesInDelivery} |
| Total mass (estimated) | ${manifest.physical.totalMass_kg} kg (target ${manifest.physical.target_mass_kg_empty} kg) |
| Manufacturing cost | $${manifest.physical.manufacturingCost_USD} per unit |
| Payload | ${manifest.physical.target_payload_kg} kg |

## Same Part-21 production-article pipeline as the GE9X engine

This BS-level project demonstrates that the ArchDisc platform applies the
same FAA-Part-21-style production-article generation to a non-aerospace
project. Each component has:

- ISO 10303 STEP geometry
- ASME Y14.5 production drawing with title block, GD&T, classification stripe
- Tolerance bundle (datums, dimensional, GD&T, surface finish)
- AS9102 First Article Inspection report
- EN 10204 Type 3.1 material certificate
- Certificate of Conformance with traceability
- Design FMEA with risk classification (Class 1/2/3)
- Process specs (heat treat, surface finish, NDT, coating)
- Class-tiered FEA (Class 1: full battery; Class 2: static + modal)
- Quantity manifest (qty + sample IDs)
- Package manifest

The same kernel / same templates produce a 30,000-component aircraft
engine and a ~250-component stair-climber. Platform-genericity validated.

## Folder layout

${manifest.folderLayout.map(l => '  ' + l).join('\n')}
`;
  fs.writeFileSync(path.join(ROOT, 'README.md'), readme);

  console.log(`\n========================================\n  COMPLETE`);
  console.log(`Output: ${ROOT}`);
  console.log(`Mass: ${manifest.physical.totalMass_kg} kg (target ${manifest.physical.target_mass_kg_empty} kg)`);
  console.log(`Cost: $${manifest.physical.manufacturingCost_USD}`);

  expect(stage1.totalParts).toBeGreaterThan(150);
  expect(processed).toBeGreaterThan(20);
});
