import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'platform-tests', 'production-smoke');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test('production package: full Part-21 bundle for a single test part', async ({ page }) => {
  ensure(OUT);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const {
      Assembly, PrimitiveBuilder, PartIDRegistry, ProductionPackage, ProductionTolerance, BOM,
    } = m;

    PartIDRegistry.reset();
    PartIDRegistry.setProject('TEST');
    ProductionTolerance.reset();

    // Build a sample disk
    const asm = new Assembly('Production Smoke');
    const disk = asm.addPart(
      PrimitiveBuilder.cylinderShell(0.40, 0.30, 0.080, 64),
      'HPT Stage-1 Disk',
      {
        category: 'HPT', subsystem: 'DSK',
        material: 'Single-Crystal Nickel CMSX-4',
      }
    );

    // Build a fastener
    const bolt = asm.addPart(
      PrimitiveBuilder.cylinder(0.005, 0.030, 12),
      'M10 Bolt',
      { category: 'FAS', subsystem: 'BLT', material: 'Steel AISI 4340' }
    );

    // Build a non-LLP casing
    const casing = asm.addPart(
      PrimitiveBuilder.cylinderShell(0.42, 0.412, 0.45, 64),
      'HPT Casing',
      { category: 'HPT', subsystem: 'CSG', material: 'Inconel 718' }
    );

    // Build packages for each
    const packages = {};
    for (const e of PartIDRegistry.all()) {
      const pkg = ProductionPackage.build(e, { project: 'TEST' });
      packages[e.partID] = {
        class: pkg.class,
        files: Array.from(pkg.files.entries()).map(([name, content]) => ({
          name, size: typeof content === 'string' ? content.length : content.byteLength,
          textPreview: typeof content === 'string' ? content.slice(0, 200) : null,
          content,
        })),
      };
    }

    // BOMs
    const ebom = BOM.buildEBOM();
    const mbom = BOM.buildMBOM();

    return {
      partCount: PartIDRegistry.size(),
      packages,
      ebom: { lineCount: ebom.lines.length, totalCost: ebom.totalCost, totalMass: ebom.totalMass },
      mbom: { lineCount: mbom.lines.length, totalCost: mbom.totalCost, totalMass: mbom.totalMass },
    };
  });

  console.log('\n=== Production Package Smoke Test ===');
  console.log(`Parts in registry: ${result.partCount}`);

  for (const [partID, pkg] of Object.entries(result.packages)) {
    console.log(`\n${partID} — ${pkg.class}`);
    console.log(`  Package files (${pkg.files.length}):`);
    const partDir = path.join(OUT, partID);
    ensure(partDir);
    for (const f of pkg.files) {
      const sz = (f.size / 1024).toFixed(1);
      console.log(`    ${f.name.padEnd(20)} ${sz.padStart(8)} KB`);
      if (typeof f.content === 'string') {
        fs.writeFileSync(path.join(partDir, f.name), f.content);
      } else if (f.content?.byteLength) {
        fs.writeFileSync(path.join(partDir, f.name), Buffer.from(f.content));
      }
    }
  }

  console.log(`\nEBOM: ${result.ebom.lineCount} lines, ${result.ebom.totalMass.toFixed(2)} kg, $${result.ebom.totalCost}`);
  console.log(`MBOM: ${result.mbom.lineCount} unique parts, ${result.mbom.totalMass.toFixed(2)} kg, $${result.mbom.totalCost}`);

  // Verify each class got the right files
  for (const [, pkg] of Object.entries(result.packages)) {
    const fileNames = pkg.files.map(f => f.name);
    expect(fileNames).toContain('part.step');
    expect(fileNames).toContain('drawing.svg');
    expect(fileNames).toContain('inspection.md');
    expect(fileNames).toContain('material-cert.md');
    expect(fileNames).toContain('coc.md');
    expect(fileNames).toContain('fmea.md');
    expect(fileNames).toContain('process-specs.md');
    expect(fileNames).toContain('manifest.json');
    if (pkg.class === 'Class 1' || pkg.class === 'Class 2') {
      expect(fileNames).toContain('fea.json');
    }
  }
});
