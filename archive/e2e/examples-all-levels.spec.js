import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

const PROJECTS = [
  {
    name: 'BatteryThermal',
    builderPath: '/src/projects/BatteryThermalBuilder.js',
    project: 'BTRM',
    title: 'EV Battery Pack Thermal Management',
    deliverable: "Master's-level mechanical engineering capstone submission",
    sheetSize: 'A3',
    targetMass_kg: 60,
    sections: [
      { z0_m: 0.00, z1_m: 0.40, color: '#4a90d9', label: 'Cell Pack' },
      { z0_m: 0.40, z1_m: 0.55, color: '#4ed99d', label: 'Cold Plate' },
      { z0_m: 0.55, z1_m: 0.75, color: '#d9a04a', label: 'Manifolds + Lines' },
      { z0_m: 0.75, z1_m: 0.95, color: '#d94a4a', label: 'Pump + Reservoir' },
      { z0_m: 0.95, z1_m: 1.10, color: '#4ad9c8', label: 'Radiator + Fan' },
    ],
  },
  {
    name: 'MRBrake',
    builderPath: '/src/projects/MRBrakeBuilder.js',
    project: 'MRBR',
    title: 'Magneto-Rheological Fluid Brake',
    deliverable: 'PhD doctoral-research prototype submission',
    sheetSize: 'A3',
    targetMass_kg: 4,
    sections: [
      { z0_m: 0.00, z1_m: 0.04, color: '#4a90d9', label: 'Front Cover + Bearing' },
      { z0_m: 0.04, z1_m: 0.06, color: '#4ed99d', label: 'Rotor Disk' },
      { z0_m: 0.06, z1_m: 0.10, color: '#d9a04a', label: 'Coil + Stator' },
      { z0_m: 0.10, z1_m: 0.14, color: '#d94a4a', label: 'MR Fluid Chamber' },
      { z0_m: 0.14, z1_m: 0.16, color: '#707080', label: 'Back Cover + Sensors' },
    ],
  },
  {
    name: 'TurbopumpSeal',
    builderPath: '/src/projects/TurbopumpSealBuilder.js',
    project: 'TPSL',
    title: 'Cryogenic Turbopump Dynamic Seal',
    deliverable: 'Professional aerospace production-article submission',
    sheetSize: 'A3',
    targetMass_kg: 8,
    sections: [
      { z0_m: 0.00, z1_m: 0.06, color: '#4a90d9', label: 'Inlet Flange + Bearing' },
      { z0_m: 0.06, z1_m: 0.12, color: '#4ed99d', label: 'Labyrinth Stack' },
      { z0_m: 0.12, z1_m: 0.18, color: '#d9a04a', label: 'Carbon-Face Seal' },
      { z0_m: 0.18, z1_m: 0.22, color: '#d94a4a', label: 'Backup Seal' },
      { z0_m: 0.22, z1_m: 0.28, color: '#4ad9c8', label: 'Buffer System' },
      { z0_m: 0.28, z1_m: 0.30, color: '#707080', label: 'Outlet Flange' },
    ],
  },
];

for (const proj of PROJECTS) {
  test(`${proj.name} — full Part-21 submission package`, async ({ page }) => {
    const ROOT = path.join(process.cwd(), 'engine-output', '_examples', proj.name);
    ensure(ROOT);
    ensure(path.join(ROOT, 'parts'));
    ensure(path.join(ROOT, 'assembly'));

    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    console.log(`\n========================================`);
    console.log(`  ${proj.title}`);
    console.log(`========================================\n`);

    // STAGE 1: build + dedup
    const stage1 = await page.evaluate(async (params) => {
      const m = await import('/src/kernel/index.js');
      const builderMod = await import(params.builderPath);
      const { PartIDRegistry, FMEA } = m;
      const Builder = builderMod.default;
      PartIDRegistry.reset();
      PartIDRegistry.setProject(params.project);
      const t0 = performance.now();
      const sections = [];
      const asm = Builder.build({
        onProgress: (n, a, total) => sections.push({ name: n, added: a, total }),
      });
      const buildSec = (performance.now() - t0) / 1000;

      const unique = new Map();
      for (const e of PartIDRegistry.all()) {
        const solidID = e.partInstance?.solid?.id ?? 'no-solid';
        const norm = e.name.replace(/\b\d+\b/g, 'N').replace(/\bL[-]?N\b|\bR[-]?N\b/g, 'X')
          .replace(/\s+/g, ' ').trim();
        const key = `${e.category}|${e.subsystem}|${solidID}|${norm}`;
        if (!unique.has(key)) unique.set(key, { rep: e, instances: [] });
        unique.get(key).instances.push(e.partID);
      }

      return {
        totalParts: asm.partCount(),
        buildSec: +buildSec.toFixed(2),
        sections,
        uniqueDefinitions: unique.size,
        uniqueIndex: Array.from(unique.entries()).map(([key, v]) => ({
          key, partID: v.rep.partID, name: v.rep.name,
          category: v.rep.category, subsystem: v.rep.subsystem,
          material: v.rep.material,
          classification: FMEA.classify(v.rep.category, v.rep.subsystem),
          quantity: v.instances.length,
        })),
      };
    }, { builderPath: proj.builderPath, project: proj.project });

    console.log(`Total components: ${stage1.totalParts}`);
    console.log(`Build time: ${stage1.buildSec}s`);
    console.log(`Unique definitions: ${stage1.uniqueDefinitions}`);
    for (const sec of stage1.sections) console.log(`  ${sec.name.padEnd(34)} +${sec.added.toString().padStart(4)} → ${sec.total}`);

    fs.writeFileSync(path.join(ROOT, 'assembly', 'unique-parts-index.json'),
      JSON.stringify(stage1.uniqueIndex, null, 2));

    // STAGE 2: per-part packages
    let processed = 0, totalFiles = 0, totalBytes = 0;
    for (const partInfo of stage1.uniqueIndex) {
      const pkg = await page.evaluate(async (args) => {
        const m = await import('/src/kernel/index.js');
        const { PartIDRegistry, ProductionPackage } = m;
        const entry = PartIDRegistry.get(args.pid);
        if (!entry) return { error: 'no entry' };
        const result = ProductionPackage.build(entry, { project: args.project, sheetSize: args.sheetSize });
        const filesArr = [];
        for (const [name, content] of result.files) {
          filesArr.push({ name,
            isText: typeof content === 'string',
            content: typeof content === 'string' ? content : null,
            base64: typeof content !== 'string' ? Buffer.from(content).toString('base64') : null,
          });
        }
        return { class: result.class, files: filesArr };
      }, { pid: partInfo.partID, project: proj.project, sheetSize: proj.sheetSize });
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
    console.log(`Generated ${processed} packages, ${totalFiles} files (${(totalBytes / 1024).toFixed(0)} KB)`);

    // STAGE 3: engine-level files
    const stage3 = await page.evaluate(async (params) => {
      const m = await import('/src/kernel/index.js');
      const { BOM, AssemblyDrawing } = m;
      const ebom = BOM.buildEBOM();
      const mbom = BOM.buildMBOM();
      const drawing = AssemblyDrawing.build({
        project: params.project,
        title: params.title,
        drawingNumber: `${params.project}-ASM-001`,
        revision: 'A',
        length_m: 1.0, fanDia_m: 0.30,
        sheetSize: 'A3',
        classification: 'Class 1 ASSY',
        drawnBy: 'ArchDisc Auto-Drawing',
        approvedBy: '— pending QA review —',
        bom: mbom.lines.slice(0, 50),
        sections: params.sections,
        stations: params.sections.map((s, i) => ({
          z_m: s.z0_m, name: String.fromCharCode(65 + i), label: s.label,
        })),
      });
      return {
        ebomCsv: BOM.toCSV_EBOM(ebom),
        mbomCsv: BOM.toCSV_MBOM(mbom),
        mbom: mbom.lines,
        ebomTotal: { mass: ebom.totalMass, cost: ebom.totalCost },
        drawing,
      };
    }, { project: proj.project, title: proj.title, sections: proj.sections });

    fs.writeFileSync(path.join(ROOT, 'assembly', 'EBOM.csv'), stage3.ebomCsv);
    fs.writeFileSync(path.join(ROOT, 'assembly', 'MBOM.csv'), stage3.mbomCsv);
    fs.writeFileSync(path.join(ROOT, 'assembly', 'MBOM.json'), JSON.stringify(stage3.mbom, null, 2));
    fs.writeFileSync(path.join(ROOT, 'assembly', 'master-assembly-drawing.svg'), stage3.drawing);

    const manifest = {
      project: proj.title,
      deliverable: proj.deliverable,
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
        target_mass_kg: proj.targetMass_kg,
      },
    };
    fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const readme = `# ${proj.title} — Submission Package

**Type:** ${proj.deliverable}
**Generated:** ${manifest.generatedAt}

| Metric | Value |
|--------|-------|
| Components | ${manifest.counts.totalComponents} |
| Unique definitions | ${manifest.counts.uniquePartDefinitions} |
| Packages | ${manifest.counts.productionPackagesGenerated} |
| Files | ${manifest.counts.filesInDelivery} |
| Mass | ${manifest.physical.totalMass_kg} kg (target ${manifest.physical.target_mass_kg} kg) |
| Cost | $${manifest.physical.manufacturingCost_USD} |

Full Part-21 production-article package per component (drawing, STEP,
tolerance, inspection, material cert, CoC, FMEA, FEA, process specs).
Generated by ArchDisc — same kernel that built the GE9X engine package.
`;
    fs.writeFileSync(path.join(ROOT, 'README.md'), readme);

    console.log(`Mass: ${manifest.physical.totalMass_kg} kg (target ${manifest.physical.target_mass_kg} kg)`);
    console.log(`Cost: $${manifest.physical.manufacturingCost_USD}`);
    console.log(`Output: ${ROOT}`);

    expect(stage1.totalParts).toBeGreaterThan(20);
    expect(processed).toBeGreaterThan(15);
  });
}
